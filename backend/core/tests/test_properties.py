"""Hypothesis property tests for the engine and the ontology."""

from __future__ import annotations

from helpers import claim
from hypothesis import given, settings
from hypothesis import strategies as st
from sahamati_core.engine import Engine
from sahamati_core.ontology import load_ontology

ONTO = load_ontology()
DTS = ["personal_info", "location", "precise_location", "approximate_location", "contacts", "identifiers",
       "device_id", "advertising_id", "email", "contact_info", "crash_logs", "app_activity"]
ACTORS = ["any_party", "first_party", "third_party", "ad_network", "service_provider"]
ACTIONS = ["collect", "share", "sell"]
PURPOSES = [None, None, "advertising", "fraud_prevention", "analytics"]
EXC = DTS + ACTORS

spec = st.fixed_dictionaries({
    "src": st.sampled_from(["policy", "policy", "data_safety", "apk_permission", "apk_sdk"]),
    "actor": st.sampled_from(ACTORS),
    "action": st.sampled_from(ACTIONS),
    "pol": st.sampled_from(["affirm", "deny", "vague"]),
    "dt": st.sampled_from(DTS),
    "cond": st.sampled_from(PURPOSES),
})
policy_spec = spec.map(lambda d: {**d, "src": "policy"})


def _normalise(d: dict) -> dict:
    if d["src"].startswith("apk"):
        d = {**d, "pol": "affirm"}
    return d


def _keyset(findings) -> set:  # type: ignore[no-untyped-def]
    # The engine collapses several APK claims for one denial into a single behavioural finding
    # (_dedupe), so which APK claim represents it can change when an exception reconciles another.
    # The identity of a behavioural finding is therefore its denial, not the APK evidence.
    return {(f.cls.value, f.overlap,
             frozenset([f.a.evidence_key()] if f.cls.value == "behavioural_mismatch"
                       else [f.a.evidence_key(), f.b.evidence_key()]))
            for f in findings}


@settings(max_examples=150, deadline=None)
@given(st.lists(policy_spec, min_size=2, max_size=7))
def test_c1_symmetry(specs: list[dict]) -> None:
    eng = Engine()
    claims = [claim(s, i) for i, s in enumerate(specs)]
    fwd = eng.internal_contradictions(claims)
    rev = eng.internal_contradictions(list(reversed(claims)))
    assert _keyset(fwd) == _keyset(rev)


@settings(max_examples=150, deadline=None)
@given(st.lists(spec.map(_normalise), min_size=2, max_size=8), st.data())
def test_exceptions_never_add_findings(specs: list[dict], data: st.DataObject) -> None:
    eng = Engine()
    base = [claim(s, i) for i, s in enumerate(specs)]
    with_exc_specs = []
    for s in specs:
        extra = data.draw(st.lists(st.sampled_from(EXC), max_size=2))
        with_exc_specs.append({**s, "exc": extra})
    more = [claim(s, i) for i, s in enumerate(with_exc_specs)]
    r0, r1 = eng.run(base), eng.run(more)
    assert len(r1.findings) <= len(r0.findings)
    assert _keyset(r1.findings) <= _keyset(r0.findings)
    assert len(r1.public_findings) <= len(r0.public_findings)


@given(st.sampled_from(sorted(ONTO.data_types.nodes)), st.sampled_from(sorted(ONTO.data_types.nodes)))
def test_overlap_monotone_in_ancestry(a: str, b: str) -> None:
    dt = ONTO.data_types
    if dt.overlaps(a, b) is not None and dt.subsumes(a, b):
        for anc in dt.ancestors_or_self(a):
            assert dt.overlaps(anc, b) is not None


@given(st.sampled_from(sorted(ONTO.data_types.nodes)), st.sampled_from(sorted(ONTO.data_types.nodes)))
def test_overlap_symmetric(a: str, b: str) -> None:
    assert ONTO.data_types.overlaps(a, b) == ONTO.data_types.overlaps(b, a)
