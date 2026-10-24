"""LLM fallback edge cases (CLAUDE.md rule 11): every call is logged, nothing is fatal, no key means no calls."""

from __future__ import annotations

import json
import sys
from types import SimpleNamespace
from typing import Any

import pytest
from sahamati_core.nlp.llm_fallback import DEFAULT_MODEL, ESCALATION_MODEL, LLMFallback

CLAIM = {"actor": "third_party", "action": "share", "data_type": "contacts", "polarity": "deny", "purpose": None,
         "exceptions": []}
SENTENCE = "We do not share contacts."


class Messages:
    def __init__(self, replies: list[Any]) -> None:
        self.replies, self.calls = replies, []

    def create(self, **kw: Any) -> Any:
        self.calls.append(kw)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        if isinstance(r, SimpleNamespace):
            return r
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=r if isinstance(r, str) else json.dumps(r))])


def fb(replies: list[Any], log: list[dict[str, Any]] | None = None) -> tuple[LLMFallback, Messages]:
    m = Messages(replies)
    return LLMFallback(client=SimpleNamespace(messages=m), log_call=(log.append if log is not None else None)), m


def run(f: LLMFallback, **kw: Any) -> Any:
    return f.extract(SENTENCE, char_start=3, char_end=3 + len(SENTENCE), url="https://x.test/p", captured_at="2026-10-19", **kw)


def test_a_good_reply_becomes_a_policy_claim_with_provenance() -> None:
    f, m = fb([{"claims": [CLAIM]}])
    out = run(f)
    assert len(out) == 1 and [c["model"] for c in m.calls] == [DEFAULT_MODEL]  # no escalation when the first call works
    t = out[0]
    assert (t.extractor, t.confidence, t.polarity.value, t.negation_method.value) == ("llm", 0.8, "deny", "llm")
    assert t.extractor_version.endswith(DEFAULT_MODEL) and t.evidence.text == SENTENCE
    assert (t.evidence.char_start, t.evidence.char_end, t.evidence.url) == (3, 3 + len(SENTENCE), "https://x.test/p")


def test_hard_sentences_go_straight_to_the_stronger_model() -> None:
    f, m = fb([{"claims": [CLAIM]}])
    out = run(f, hard=True)
    assert [c["model"] for c in m.calls] == [ESCALATION_MODEL] and out[0].confidence == 0.85


@pytest.mark.parametrize("reply", [
    "this is not json",
    "[1, 2, 3]",  # valid JSON but not an object
    {"unexpected": []},  # no `claims`
])
def test_unusable_replies_are_logged_and_escalated_then_give_up(reply: Any) -> None:
    log: list[dict[str, Any]] = []
    f, m = fb([reply, reply], log)
    assert run(f) is None
    assert [c["model"] for c in m.calls] == [DEFAULT_MODEL, ESCALATION_MODEL]
    assert len(log) == 2 and all(r["latency_ms"] >= 0 for r in log)


def test_a_refusal_is_logged_and_never_turned_into_claims() -> None:
    log: list[dict[str, Any]] = []
    refusal = SimpleNamespace(stop_reason="refusal", content=[])
    f, _ = fb([refusal, refusal], log)
    assert run(f) is None
    assert [r["error"] for r in log] == ["refusal", "refusal"] and log[0]["response"] == {"stop_reason": "refusal"}


def test_claims_outside_the_ontology_vocabulary_are_dropped_individually() -> None:
    bad_polarity = {**CLAIM, "polarity": "maybe"}
    bad_action = {**CLAIM, "action": "teleport"}
    missing_key = {k: v for k, v in CLAIM.items() if k != "actor"}
    f, _ = fb([{"claims": [bad_polarity, bad_action, missing_key, CLAIM]}])
    out = run(f)
    assert [t.data_type for t in out] == ["contacts"]  # only the valid claim survives


def test_an_empty_claim_list_is_a_valid_answer_not_an_error() -> None:
    f, m = fb([{"claims": []}])
    assert run(f) == [] and len(m.calls) == 1


def test_a_failing_logger_never_breaks_extraction() -> None:
    def broken(_rec: dict[str, Any]) -> None:
        raise OSError("disk full")

    m = Messages([{"claims": [CLAIM]}])
    f = LLMFallback(client=SimpleNamespace(messages=m), log_call=broken)
    assert len(run(f)) == 1


def test_every_call_is_logged_with_the_schema_not_the_secret_key() -> None:
    log: list[dict[str, Any]] = []
    f, _ = fb([{"claims": [CLAIM]}], log)
    run(f)
    rec = log[0]
    assert rec["model"] == DEFAULT_MODEL and rec["request"]["output_config"] == "json_schema(ontology)"
    assert "api_key" not in json.dumps(rec)


def test_a_key_without_the_sdk_installed_disables_the_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "anthropic", None)
    f = LLMFallback(api_key="test-key-not-real")
    assert f.enabled is False and run(f) is None


def test_the_sdk_client_is_built_lazily_with_the_key(monkeypatch: pytest.MonkeyPatch) -> None:
    built: list[str] = []

    class Anthropic:
        def __init__(self, api_key: str) -> None:
            built.append(api_key)
            self.messages = Messages([{"claims": [CLAIM]}])

    monkeypatch.setitem(sys.modules, "anthropic", SimpleNamespace(Anthropic=Anthropic))
    f = LLMFallback(api_key="test-key-not-real")
    assert built == [] and f.enabled  # nothing constructed (and no call) until a sentence needs it
    assert len(run(f)) == 1 and built == ["test-key-not-real"]
