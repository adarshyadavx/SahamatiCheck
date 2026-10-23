from __future__ import annotations

from typing import Any

from sahamati_core.schema import Action, ClaimTuple, EvidenceSpan, NegationMethod, Polarity, SourceKind

DEFAULT_CONF = {"policy": 0.9, "data_safety": 0.98, "apk_permission": 0.98, "apk_sdk": 0.85}


def claim(spec: dict[str, Any], idx: int = 0) -> ClaimTuple:
    src = SourceKind(spec["src"])
    pol = Polarity(spec["pol"])
    s = spec.get("s")
    if src == SourceKind.POLICY:
        neg = (NegationMethod(spec["neg"]) if spec.get("neg") else
               NegationMethod.HEURISTIC) if pol == Polarity.DENY else None
        start = (s if s is not None else idx) * 100
        ev = EvidenceSpan(char_start=start, char_end=start + 50, text=f"sentence {s if s is not None else idx}",
                          captured_at="2026-10-19")
    else:
        neg = NegationMethod.MAPPING if pol == Polarity.DENY else None
        ev = EvidenceSpan(text=spec.get("text", f"{src.value}:{spec['dt']}:{idx}"), locator=spec.get("locator", f"x[{idx}]"),
                          captured_at="2026-10-19")
    cond = spec.get("cond")
    return ClaimTuple(
        actor=spec["actor"], action=Action(spec["action"]), data_type=spec["dt"], condition=cond,
        purposes=[cond] if cond else [], polarity=pol, exceptions=list(spec.get("exc") or []),
        source_kind=src, evidence=ev, confidence=float(spec.get("conf", DEFAULT_CONF[src.value])),
        extractor="rule" if src == SourceKind.POLICY else "mapping", extractor_version="test",
        ontology_version="test", negation_method=neg, synthetic=bool(spec.get("synthetic", False)),
    )
