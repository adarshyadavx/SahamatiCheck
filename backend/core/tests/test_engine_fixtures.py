from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml
from helpers import claim
from sahamati_core.engine import Engine

CASES: list[dict[str, Any]] = yaml.safe_load((Path(__file__).parent / "fixtures" / "engine_cases.yaml").read_text())


def _keys(fs: list[Any]) -> set[tuple[str, str, str]]:
    return {(f.cls.value, f.rule_id, f.overlap) for f in fs}


def _expected(items: list[dict[str, str]] | None) -> set[tuple[str, str, str]]:
    return {(i["class"], i["rule"], i["overlap"]) for i in items or []}


def test_fixture_count() -> None:
    assert len(CASES) >= 20


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_engine_case(case: dict[str, Any]) -> None:
    claims = [claim(spec, i) for i, spec in enumerate(case["claims"])]
    res = Engine().run(claims, apk_ok=case.get("apk_ok", True))
    exp = case["expect"]
    if "findings" in exp:
        assert _keys(res.public_findings) == _expected(exp["findings"])
    if "suppressed" in exp:
        assert _keys([f for f in res.findings if f.suppressed]) == _expected(exp["suppressed"])
    if "gaps" in exp:
        assert {g.data_type for g in res.public_gaps} == set(exp["gaps"])
    for f in res.findings:
        assert 0 <= f.confidence <= 1
        assert f.a.evidence.text and f.b.evidence.text  # evidence from both sides


def test_confidence_formula() -> None:
    # 1.0 x min(0.9, 0.98) x 1/(1+0.15*3) x 0.8
    claims = [claim(s, i) for i, s in enumerate(CASES[0]["claims"])]
    f = Engine().run(claims).findings[0]
    assert f.confidence == round(0.9 / 1.45 * 0.8, 2)


def test_negation_certainty_factor() -> None:
    """s_neg: heuristic 0.8; an adjacent cue is as certain as a dependency arc (thresholds.yaml)."""
    base = {"src": "policy", "actor": "third_party", "action": "share", "pol": "deny", "dt": "device_id", "s": 1}
    ds = {"src": "data_safety", "actor": "third_party", "action": "share", "pol": "affirm", "dt": "device_id"}
    got = {}
    for neg in ("heuristic", "adjacent", "dependency"):
        claims = [claim({**base, "neg": neg}, 0), claim(ds, 1)]
        got[neg] = Engine().run(claims).findings[0].confidence
    assert got == {"heuristic": 0.72, "adjacent": 0.9, "dependency": 0.9}
