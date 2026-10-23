"""AI09 (CLAUDE.md rule 13): missing evidence never passes.

For every enabled rule and every source it requires, removing that source must never yield
`no_issue_detected`. The post-evaluation guard must never fire in normal operation.
"""

from __future__ import annotations

from typing import Any

import pytest
from helpers import claim
from hypothesis import given, settings
from hypothesis import strategies as st
from sahamati_core.engine import Engine
from sahamati_core.ontology import load_ontology
from sahamati_core.pipeline import analyse_inputs
from sahamati_core.rules import Evaluation, Evaluator, load_registry
from sahamati_core.rules.models import GUARD_REASON

REG = load_registry()
ONTO = load_ontology()
EV = Evaluator(REG, ONTO)
NON_OK = ["unavailable", "unreachable", "unparseable", "obfuscated"]
ALL_OK = {"policy": "ok", "data_safety": "ok", "apk": "ok"}

# A scenario in which many rules would match if their evidence were usable.
RICH: list[dict[str, Any]] = [
    {"src": "policy", "actor": "third_party", "action": "share", "pol": "deny", "dt": "device_id", "s": 1,
     "neg": "adjacent", "conf": 0.98},
    {"src": "policy", "actor": "first_party", "action": "collect", "pol": "deny", "dt": "camera_media", "s": 2},
    {"src": "policy", "actor": "first_party", "action": "collect", "pol": "deny", "dt": "location", "s": 3},
    {"src": "policy", "actor": "first_party", "action": "collect", "pol": "affirm", "dt": "precise_location", "s": 4},
    {"src": "data_safety", "actor": "third_party", "action": "share", "pol": "affirm", "dt": "device_id"},
    {"src": "data_safety", "actor": "first_party", "action": "collect", "pol": "deny", "dt": "contacts"},
    {"src": "data_safety", "actor": "first_party", "action": "collect", "pol": "deny", "dt": "app_interactions"},
    {"src": "apk_permission", "actor": "first_party", "action": "collect", "pol": "affirm", "dt": "precise_location",
     "text": "android.permission.ACCESS_FINE_LOCATION"},
    {"src": "apk_permission", "actor": "first_party", "action": "collect", "pol": "affirm", "dt": "contacts",
     "text": "android.permission.READ_CONTACTS"},
    {"src": "apk_permission", "actor": "first_party", "action": "collect", "pol": "affirm", "dt": "camera_media",
     "text": "android.permission.CAMERA"},
    {"src": "apk_permission", "actor": "first_party", "action": "collect", "pol": "affirm", "dt": "advertising_id",
     "text": "com.google.android.gms.permission.AD_ID"},
    {"src": "apk_sdk", "actor": "first_party", "action": "collect", "pol": "affirm", "dt": "app_interactions",
     "text": "com.google.firebase.analytics"},
    {"src": "apk_sdk", "actor": "ad_network", "action": "share", "pol": "affirm", "dt": "advertising_id",
     "text": "com.google.android.gms.ads"},
]


def run(cov: dict[str, str], specs: list[dict[str, Any]] | None = None, *, sdk_scan: bool = True) -> Evaluation:
    claims = [claim(s, i) for i, s in enumerate(RICH if specs is None else specs)]
    coverage = {**ALL_OK, **cov}
    res = Engine().run(claims, apk_ok=coverage["apk"] == "ok")
    return EV.evaluate(EV.context(coverage=coverage, claims=claims, result=res, sdk_scan=sdk_scan))


def status_of(ev: Evaluation, rid: str) -> tuple[str, str | None]:
    r = next(x for x in ev.runs if x.rule.id == rid)
    return r.status, r.reason


def test_the_rich_scenario_actually_exercises_the_rules() -> None:
    ev = run({})
    got = {r.rule.id: r.status for r in ev.runs}
    for rid in ("P05", "P06", "P07", "P12", "D01", "D03", "T01", "T02", "T08", "A01"):
        assert got[rid] not in ("no_issue_detected", "inconclusive"), (rid, got[rid])
    assert ev.guard_events == []


def _required_cases() -> list[tuple[str, str, str]]:
    out = []
    for r in REG.runnable():
        for src in r.evidence_sources.required:
            for st_ in (NON_OK if src in ALL_OK else ["unavailable"]):
                out.append((r.id, src, st_))
    return out


@pytest.mark.parametrize("rid,src,state", _required_cases())
def test_removing_a_required_source_never_passes(rid: str, src: str, state: str) -> None:
    for specs in (RICH, []):  # with evidence from the other sources, and with none at all
        ev = run({src: state} if src in ALL_OK else {}, specs)
        status, reason = status_of(ev, rid)
        assert status == "inconclusive" and reason, (rid, src, state, specs and "rich")
        assert ev.guard_events == []


@pytest.mark.parametrize("rid", [r.id for r in REG.runnable() if r.evidence_sources.any_of])
def test_losing_every_any_of_source_never_passes(rid: str) -> None:
    rule = REG.by_id[rid]
    for specs in (RICH, []):
        ev = run({s: "unavailable" for s in rule.evidence_sources.any_of if s in ALL_OK}, specs)
        status, reason = status_of(ev, rid)
        assert status == "inconclusive" and reason, rid
        assert ev.guard_events == []


def test_obfuscated_apk_makes_sdk_absence_rules_inconclusive_not_a_pass() -> None:
    for specs in (RICH, []):
        ev = run({"apk": "obfuscated"}, specs)
        for rid in ("T01", "T02"):
            assert status_of(ev, rid) == ("inconclusive", "apk_partial_coverage")
        assert ev.guard_events == []
    assert status_of(run({}, [], sdk_scan=False), "T01") == ("inconclusive", "apk_partial_coverage")
    assert status_of(run({}, []), "T01")[0] == "no_issue_detected"  # the full scan found nothing: a real pass


def test_runtime_rules_are_inconclusive_statically() -> None:
    ev = run({})
    assert status_of(ev, "C03") == ("inconclusive", "runtime_evidence_unavailable")
    assert status_of(ev, "T05") == ("inconclusive", "runtime_evidence_unavailable")
    assert status_of(ev, "S06") == ("inconclusive", "runtime_evidence_unavailable")
    assert status_of(ev, "C07") == ("inconclusive", "test_account_unavailable")


def test_guard_rewrites_an_illegal_pass() -> None:
    """If the pre-check is ever broken, the post-evaluation guard still prevents a false pass."""
    ev = Evaluator(REG, ONTO)
    ev._precheck = lambda rule, ctx: None  # type: ignore[method-assign,assignment]
    claims: list = []
    cov = {**ALL_OK, "apk": "unavailable", "runtime": "unavailable", "test_account": "unavailable"}
    out = ev.evaluate(ev.context(coverage=cov, claims=claims, result=Engine().run(claims, apk_ok=False)))
    assert "D01" in out.guard_events and "C03" in out.guard_events
    for r in out.runs:
        assert r.status != "no_issue_detected" or Evaluator(REG, ONTO).source_gap(r.rule, ev.context(
            coverage=cov, claims=claims, result=Engine().run(claims, apk_ok=False))) is None
        if r.rule.id in out.guard_events:
            assert (r.status, r.reason) == ("inconclusive", GUARD_REASON)


cov_state = st.sampled_from(["ok", "ok", "ok", *NON_OK])
specs_strategy = st.lists(st.sampled_from(RICH), max_size=len(RICH), unique_by=lambda d: id(d))


@settings(max_examples=120, deadline=None)
@given(policy=cov_state, ds=cov_state, apk=cov_state, sdk_scan=st.booleans(), specs=specs_strategy)
def test_invariant_no_pass_without_usable_evidence(policy: str, ds: str, apk: str, sdk_scan: bool,
                                                    specs: list[dict[str, Any]]) -> None:
    ev = run({"policy": policy, "data_safety": ds, "apk": apk}, specs, sdk_scan=sdk_scan)
    cov = {"policy": policy, "data_safety": ds, "apk": apk, "runtime": "unavailable", "test_account": "unavailable"}
    assert ev.guard_events == [], "the AI09 guard fired: a rule's own pre-check let a false pass through"
    for r in ev.runs:
        rule = r.rule
        if r.status == "no_issue_detected":
            assert all(cov[s] == "ok" for s in rule.evidence_sources.required), rule.id
            if rule.evidence_sources.any_of:
                assert any(cov[s] == "ok" for s in rule.evidence_sources.any_of), rule.id
            if any(q.predicate == "sdk_scan_complete" for q in rule.requires):
                assert apk == "ok" and sdk_scan, rule.id
        if r.status == "inconclusive":
            assert r.reason
        if r.status in ("confirmed_conflict", "potential_conflict", "needs_review"):
            assert r.matches or r.rule.investigation is False


# ------------------------------------------------------------------ through the real pipeline


POLICY = "We collect your email address to create your account."
DS = {"schema": "sahamati.data_safety/v1", "package": "in.example.t", "captured_at": "2026-10-19",
      "no_data_collected": False, "no_data_shared": False,
      "data_types": [{"category": "Personal info", "type": "Email address", "collected": True, "shared": False,
                      "purposes_collected": ["Account management"], "purposes_shared": []}]}
MANIFEST = ('<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="in.example.t" '
            'android:versionCode="1"><uses-permission android:name="android.permission.CAMERA"/></manifest>')


def _statuses(**kw: Any) -> dict[str, str]:
    res = analyse_inputs(package="in.example.t", report_id="r_sc_test", **kw)
    assert res.state["ai09_guard_events"] == []
    return {r.rule_id: r.status for r in res.report.rule_runs}


def test_pipeline_without_an_apk_has_no_apk_passes() -> None:
    s = _statuses(policy_content=POLICY, data_safety=DS)
    for rid in ("D01", "D03", "T01", "T02", "T08", "A01"):
        assert s[rid] == "inconclusive", rid


def test_pipeline_with_an_obfuscated_apk() -> None:
    classes = "\n".join(f"a.b.c{i}.d" for i in range(20)) + "\n"
    res = analyse_inputs(package="in.example.t", report_id="r_sc_test", policy_content=POLICY, data_safety=DS,
                         manifest_xml=MANIFEST, classes_txt=classes)
    assert res.report.coverage.apk.value == "obfuscated"
    runs = {r.rule_id: r for r in res.report.rule_runs}
    assert runs["T01"].status == "inconclusive" and runs["T01"].reason == "apk_partial_coverage"
    assert runs["T02"].status == "inconclusive"
    assert not [c for c in res.report.card.categories if c.color == "green"]


def test_pipeline_manifest_without_class_list_cannot_pass_sdk_rules() -> None:
    res = analyse_inputs(package="in.example.t", report_id="r_sc_test", policy_content=POLICY, data_safety=DS,
                         manifest_xml=MANIFEST)
    runs = {r.rule_id: r for r in res.report.rule_runs}
    assert runs["T01"].status == "inconclusive" and runs["T01"].reason == "apk_partial_coverage"
    assert runs["D03"].status == "needs_review"  # the permission list itself was readable


def test_pipeline_with_only_an_apk_runs_what_it_can() -> None:
    s = _statuses(manifest_xml=MANIFEST, classes_txt="in.example.t.Main\n")
    assert s["P12"] == "inconclusive" and s["P07"] == "inconclusive" and s["P05"] == "inconclusive"
    assert s["A01"] == "inconclusive"  # no policy and no declaration: "no stated purpose" is unknowable
    assert s["D03"] == "needs_review" and s["T01"] == "inconclusive"
    assert not [c for c in analyse_inputs(package="in.example.t", report_id="r_sc_test", manifest_xml=MANIFEST,
                                          classes_txt="in.example.t.Main\n").report.card.categories
                if c.color in ("green", "red")]


def test_a_category_is_green_only_when_everything_it_needs_ran() -> None:
    full = analyse_inputs(package="in.example.t", report_id="r_sc_test", policy_content=POLICY, data_safety=DS,
                          manifest_xml=MANIFEST.replace("CAMERA", "INTERNET"), classes_txt="in.example.t.Main\n")
    cats = {c.id: c for c in full.report.card.categories}
    assert cats["location"].color == "green" and cats["camera_mic"].color == "green"
    assert cats["ads_tracking"].color == "grey"  # C03/T05 need runtime evidence
    assert cats["location"].note == "No issue found in what we could check."
    no_policy = analyse_inputs(package="in.example.t", report_id="r_sc_test", data_safety=DS,
                               manifest_xml=MANIFEST.replace("CAMERA", "INTERNET"), classes_txt="in.example.t.Main\n")
    assert {c.id: c.color for c in no_policy.report.card.categories}["location"] == "grey"
