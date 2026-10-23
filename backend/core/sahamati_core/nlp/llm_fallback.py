"""Optional LLM fallback for hard policy sentences (PLAN.md §4.4 step 4).

* Default model `claude-haiku-5-5`; escalates to `claude-sonnet-5-5` when the
  first answer is unusable or the caller marks the sentence as hard.
* Structured JSON output (output_config.format = json_schema) whose enums are
  the ontology ids, so the model can only answer with known nodes.
* Every call (request, response, latency, error) is passed to `log_call`, which
  the worker wires to the `llm_calls` table.
* With no ANTHROPIC_API_KEY, or without the `anthropic` package, it is a no-op.
  Tests never reach the network.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from typing import Any

from sahamati_core.ontology import Ontology, load_ontology
from sahamati_core.schema import Action, ClaimTuple, EvidenceSpan, NegationMethod, Polarity, SourceKind

DEFAULT_MODEL = "claude-haiku-5-5"
ESCALATION_MODEL = "claude-sonnet-5-5"
LLM_EXTRACTOR_VERSION = "llm-fallback@0.1.0"

LogFn = Callable[[dict[str, Any]], None]

_SYSTEM = (
    "You extract data-practice claims from one sentence of a mobile app privacy policy. "
    "Return every (actor, action, data_type, polarity) the sentence states. Use only the ids in the schema. "
    "polarity is 'deny' when the sentence says the practice does NOT happen, 'affirm' when it says it does, "
    "and 'vague' when it hedges and names no specific data type. Put carve-outs introduced by "
    "'except', 'unless' or 'other than' in exceptions. If the sentence states no data practice, return an "
    "empty claims list. Never infer practices the sentence does not state."
)


def _schema(onto: Ontology) -> dict[str, Any]:
    dt = sorted(onto.data_types.nodes)
    actors = sorted(onto.actors.nodes)
    purposes = sorted(onto.purposes.nodes)
    return {
        "type": "object",
        "properties": {
            "claims": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "actor": {"type": "string", "enum": actors},
                        "action": {"type": "string", "enum": [a.value for a in Action]},
                        "data_type": {"type": "string", "enum": dt},
                        "polarity": {"type": "string", "enum": [p.value for p in Polarity]},
                        "purpose": {"anyOf": [{"type": "string", "enum": purposes}, {"type": "null"}]},
                        "exceptions": {"type": "array", "items": {"type": "string", "enum": actors + dt}},
                    },
                    "required": ["actor", "action", "data_type", "polarity", "purpose", "exceptions"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["claims"],
        "additionalProperties": False,
    }


class LLMFallback:
    def __init__(
        self,
        *,
        ontology: Ontology | None = None,
        log_call: LogFn | None = None,
        api_key: str | None = None,
        client: Any = None,
    ) -> None:
        self.onto = ontology or load_ontology()
        self.log_call = log_call or (lambda _rec: None)
        self._api_key = api_key if api_key is not None else os.environ.get("ANTHROPIC_API_KEY")
        self._client = client

    @property
    def enabled(self) -> bool:
        if self._client is not None:
            return True
        if not self._api_key:
            return False
        try:
            import anthropic  # type: ignore[import-not-found]  # noqa: F401
        except ImportError:
            return False
        return True

    def _get_client(self) -> Any:
        if self._client is None:
            import anthropic  # type: ignore[import-not-found]

            self._client = anthropic.Anthropic(api_key=self._api_key)
        return self._client

    def _call(self, model: str, sentence: str) -> dict[str, Any] | None:
        request = {
            "model": model,
            "max_tokens": 2048,
            "system": _SYSTEM,
            "messages": [{"role": "user", "content": f"Sentence:\n{sentence}"}],
            "output_config": {"format": {"type": "json_schema", "schema": _schema(self.onto)}},
        }
        t0 = time.monotonic()
        record: dict[str, Any] = {"model": model, "request": {**request, "output_config": "json_schema(ontology)"}}
        try:
            resp = self._get_client().messages.create(**request)
            record["latency_ms"] = int((time.monotonic() - t0) * 1000)
            if getattr(resp, "stop_reason", None) == "refusal":
                record["response"] = {"stop_reason": "refusal"}
                record["error"] = "refusal"
                return None
            text = next((b.text for b in resp.content if getattr(b, "type", "") == "text"), "")
            record["response"] = {"text": text, "stop_reason": getattr(resp, "stop_reason", None)}
            data = json.loads(text)
            return data if isinstance(data, dict) else None
        except Exception as exc:  # noqa: BLE001 - logged, never fatal
            record["latency_ms"] = int((time.monotonic() - t0) * 1000)
            record["error"] = f"{type(exc).__name__}: {exc}"
            return None
        finally:
            try:
                self.log_call(record)
            except Exception:  # noqa: BLE001
                pass

    def extract(
        self,
        sentence: str,
        *,
        char_start: int,
        char_end: int,
        url: str | None = None,
        captured_at: str = "",
        source_id: str = "",
        hard: bool = False,
    ) -> list[ClaimTuple] | None:
        """Return tuples, or None when disabled / unusable (caller keeps the rule result)."""
        if not self.enabled:
            return None
        models = [ESCALATION_MODEL] if hard else [DEFAULT_MODEL, ESCALATION_MODEL]
        for model in models:
            data = self._call(model, sentence)
            if data is None or "claims" not in data:
                continue
            out: list[ClaimTuple] = []
            for c in data["claims"]:
                try:
                    pol = Polarity(c["polarity"])
                    out.append(
                        ClaimTuple(
                            actor=c["actor"],
                            action=Action(c["action"]),
                            data_type=c["data_type"],
                            condition=c.get("purpose"),
                            purposes=[c["purpose"]] if c.get("purpose") else [],
                            polarity=pol,
                            exceptions=list(c.get("exceptions") or []),
                            source_kind=SourceKind.POLICY,
                            evidence=EvidenceSpan(
                                source_id=source_id, char_start=char_start, char_end=char_end,
                                text=sentence[:600], locator="sentence", url=url, captured_at=captured_at,
                            ),
                            confidence=0.8 if model == DEFAULT_MODEL else 0.85,
                            extractor="llm",
                            extractor_version=f"{LLM_EXTRACTOR_VERSION}:{model}",
                            ontology_version=self.onto.version,
                            negation_method=NegationMethod.LLM if pol == Polarity.DENY else None,
                        )
                    )
                except (KeyError, ValueError):
                    continue
            return out
        return None
