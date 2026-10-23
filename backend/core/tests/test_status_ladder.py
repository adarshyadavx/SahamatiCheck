"""Statuses, ceilings and the confirm gate (CLAUDE.md rule 12), grouping (AI11) and the report card (rule 15)."""

from __future__ import annotations

from typing import Any

from helpers import claim
from hypothesis import given, settings
from hypothesis import strategies as st
from sahamati_core.engine import Engine, load_config
from sahamati_core.ontology import load_ontology
from sahamati_core.pipeline import run_pipeline
from sahamati_core.report import ReportInputs, build_report_full, hide_findings, relocalise
from sahamati_core.report_card import ReportFacts
from sahamati_core.rules import Evaluator, load_registry
from sahamati_core.schema import Coverage, CoverageMap, Report

REG = load_registry()
ONTO = load_ontology()
EV = Evaluator(REG, ONTO)
CFG = REG.status
OK = CoverageMap(policy=Coverage.OK, data_safety=Coverage.OK, apk=Coverage.OK)


def report_for(specs: list[dict[str, Any]], cov: CoverageMap = OK, sdk_scan: bool = True) -> Report:
    claims = [claim(s, i) for i, s in enumerate(specs)]
    res = Engine().run(claims, apk_ok=cov.apk == Coverage.OK)
    return build_report_full(ReportInputs(
        report_id="r_t", package="in.example.t", title="T", version_code=1, developer=None, is_demo=False,
        generated_at="2026-10-19T10:00:00Z", coverage=cov, claims=claims, engine_result=res, vague_claim_ratio=0.0,
        sdk_scan=sdk_scan, facts=ReportFacts())).report


def test_thresholds_are_the_documented_numbers() -> None:
    assert CFG.confirm_threshold == 0.85 and CFG.min_claim_confidence == 0.70
    assert CFG.evidence_strength_weights["declaration"] > CFG.evidence_strength_weights["code_path"] \
        > CFG.evidence_strength_weights["presence"] > CFG.evidence_strength_weights["capability"]
    assert load_config().s_neg_adjacent == 1.0 and load_config().s_neg_heuristic == 0.8


def test_declaration_pair_read_with_certainty_is_confirmed() -> None:
    rep = report_for([
        {"src": "policy", "actor": "third_party", "action": "share", "pol": "deny", "dt": "device_id", "s": 1,
         "neg": "adjacent", "conf": 0.98},
        {"src": "data_safety", "actor": "third_party", "action": "share", "pol": "affirm", "dt": "device_id"}])
    f = rep.findings[0]
    assert (f.status, f.evidence_strength, f.limitations) == ("confirmed_conflict", "declaration", [])
    assert next(c for c in rep.card.categories if c.id == "ads_tracking").color == "red"
    assert {r.rule_id: r.status for r in rep.rule_runs}["P06"] == "confirmed_conflict"


def test_confidence_below_the_gate_is_potential_with_a_limitation() -> None:
    rep = report_for([
        {"src": "policy", "actor": "third_party", "action": "share", "pol": "deny", "dt": "device_id", "s": 1},
        {"src": "data_safety", "actor": "third_party", "action": "share", "pol": "affirm", "dt": "device_id"}])
    f = rep.findings[0]
    assert f.confidence < CFG.confirm_threshold
    assert (f.status, f.limitations) == ("potential_conflict", ["confidence_below_confirm_threshold"])
    assert next(c for c in rep.card.categories if c.id == "ads_tracking").color == "orange"


def test_permission_only_and_sdk_only_evidence_are_capped_at_potential() -> None:
    for text, actor, action, dt, strength, limit in (
        ("android.permission.READ_CONTACTS", "first_party", "collect", "contacts", "capability", "permission_only"),
        ("com.google.android.gms.ads", "ad_network", "share", "advertising_id", "presence", "sdk_presence_only"),
    ):
        src = "apk_permission" if strength == "capability" else "apk_sdk"
        deny_actor = "first_party" if action == "collect" else "third_party"
        rep = report_for([
            {"src": "policy", "actor": deny_actor, "action": action, "pol": "deny", "dt": dt, "s": 1,
             "neg": "adjacent", "conf": 0.98},
            {"src": src, "actor": actor, "action": action, "pol": "affirm", "dt": dt, "text": text, "conf": 0.98}])
        f = rep.findings[0]
        assert f.status == "potential_conflict" and f.evidence_strength == strength
        assert limit in f.limitations and "runtime_not_observed" in f.limitations
        assert all(c.color != "red" for c in rep.card.categories)


def test_conditional_denial_and_low_claim_confidence_fall_to_needs_review() -> None:
    rep = report_for([  # a purpose-limited denial that still overlaps the affirmation's purpose
        {"src": "policy", "actor": "third_party", "action": "share", "pol": "deny", "dt": "device_id", "s": 1,
         "neg": "adjacent", "conf": 0.98, "cond": "advertising"},
        {"src": "data_safety", "actor": "third_party", "action": "share", "pol": "affirm", "dt": "device_id",
         "cond": "advertising"}])
    assert [(f.status, f.limitations) for f in rep.findings] == [("needs_review", ["conditional_denial"])]
    rep = report_for([
        {"src": "policy", "actor": "third_party", "action": "share", "pol": "deny", "dt": "device_id", "s": 1,
         "neg": "adjacent", "conf": 0.6},
        {"src": "data_safety", "actor": "third_party", "action": "share", "pol": "affirm", "dt": "device_id"}])
    assert rep.findings and rep.findings[0].status == "needs_review"
    assert "low_claim_confidence" in rep.findings[0].limitations


def test_exclude_if_steps_one_level_down() -> None:
    # sharing with a service provider is not counted as "sharing" by Play: P06 steps down one rung
    rep = report_for([
        {"src": "policy", "actor": "third_party", "action": "share", "pol": "deny", "dt": "device_id", "s": 1,
         "neg": "adjacent", "conf": 0.98},
        {"src": "policy", "actor": "service_provider", "action": "share", "pol": "affirm", "dt": "device_id", "s": 2,
         "conf": 0.98}])
    assert [f.rule_id for f in rep.findings] == ["IC-01"]  # an internal contradiction, owned by P12
    assert rep.findings[0].status == "confirmed_conflict"


@settings(max_examples=150, deadline=None)
@given(st.lists(st.fixed_dictionaries({
    "src": st.sampled_from(["policy", "policy", "data_safety", "apk_permission", "apk_sdk"]),
    "actor": st.sampled_from(["first_party", "third_party", "ad_network", "service_provider"]),
    "action": st.sampled_from(["collect", "share"]),
    "pol": st.sampled_from(["affirm", "deny"]),
    "dt": st.sampled_from(["personal_info", "location", "precise_location", "contacts", "device_id",
                           "advertising_id", "email", "camera_media"]),
    "neg": st.sampled_from(["heuristic", "adjacent", "dependency"]),
    "conf": st.sampled_from([0.6, 0.75, 0.9, 0.98]),
}), min_size=2, max_size=8))
def test_status_properties(specs: list[dict[str, Any]]) -> None:
    for i, s in enumerate(specs):
        s["s"] = i
        if s["src"].startswith("apk"):
            s["pol"] = "affirm"
        if s["src"] == "apk_permission":
            s["text"] = "android.permission.X"
    rep = report_for(specs)
    for f in rep.findings:
        # the confirm gate (rule 12)
        if f.status == "confirmed_conflict":
            assert f.tier == "strong" and f.confidence >= CFG.confirm_threshold
            assert f.evidence_strength in ("declaration", "code_path")
        if f.evidence_strength in ("capability", "presence"):
            assert f.status != "confirmed_conflict"
        assert f.user_category and f.group_id
    # red only for a confirmed conflict, and a confirmed conflict always shows red
    for c in rep.card.categories:
        confirmed = any(f.status == "confirmed_conflict" for f in rep.findings if f.user_category == c.id)
        assert (c.color == "red") == confirmed
        assert c.color != "green" or (not c.finding_ids and not c.indicator_ids)
    # investigation rules never produce findings or summary counts (rule 14)
    assert {f.rule_id for f in rep.findings} <= {"IC-01", "DM-01", "DM-02", "DM-03", "BM-01", "BM-02", "BM-03", "BM-04"}
    assert rep.summary.strong + rep.summary.indicative == len(rep.findings)
    assert all(i.status == "needs_review" for i in rep.indicators)
    assert sum(rep.status_counts.model_dump().values()) == len(rep.rule_runs)


# ------------------------------------------------------------------ grouping (AI11)


def test_findings_and_indicators_in_one_category_share_a_group() -> None:
    rep = run_pipeline("in.example.shopkart")["report"]
    by_id = {f["id"]: f for f in rep["findings"]}
    ads = [f for f in rep["findings"] if f["user_category"] == "ads_tracking"]
    assert len(ads) == 2 and len({f["group_id"] for f in ads}) == 1
    for f in ads:
        assert f["related_finding_ids"] == [x["id"] for x in ads if x is not f]
    for f in rep["findings"]:
        for rid in f.get("related_finding_ids", []):
            assert by_id[rid]["group_id"] == f["group_id"]
    gid = ads[0]["group_id"]
    assert {i["id"] for i in rep["indicators"] if i.get("group_id") == gid} == {"i_t02", "i_t08"}
    # the camera indicators have no finding to join: no group id
    assert all("group_id" not in i for i in rep["indicators"] if i["user_category"] == "camera_mic")
    # a lone finding has a group id but no related ids
    chai = run_pipeline("in.example.chaiwallet")["report"]
    assert all("related_finding_ids" not in f for f in chai["findings"])


def test_parent_order_ranks_related_findings() -> None:
    """P12 outranks P06, which outranks P05 and P07 (group_parent_order in thresholds.yaml)."""
    assert CFG.group_parent_order == ["P12", "P06", "P05", "P07", "T01"]
    rep = run_pipeline("in.example.shopkart")["report"]
    loc = [f for f in rep["findings"] if f["user_category"] == "location"]
    assert {f["rule_id"] for f in loc} == {"BM-01", "BM-03"}  # P07 and P05
    bm3 = next(f for f in loc if f["rule_id"] == "BM-03")
    bm1 = next(f for f in loc if f["rule_id"] == "BM-01")
    assert bm3["related_finding_ids"] == [bm1["id"]]


# ------------------------------------------------------------------ report card


def test_card_shape_is_fixed() -> None:
    rep = run_pipeline("in.example.dosanotes")["report"]
    assert [c["id"] for c in rep["card"]["categories"]] == [
        "location", "contacts", "photos_files", "camera_mic", "messages_calls", "money_payments", "identity",
        "health", "ads_tracking", "account_profile"]
    assert [a["id"] for a in rep["card"]["answers"]] == ["location", "sharing", "ads", "deletion", "grievance"]
    assert all(c["color"] in ("red", "orange", "yellow", "grey", "green") for c in rep["card"]["categories"])
    colour_of_status = {"confirmed_conflict": "red", "potential_conflict": "orange", "needs_review": "yellow",
                        "inconclusive": "grey", "no_issue_detected": "green"}
    assert all(colour_of_status[c["status"]] == c["color"] for c in rep["card"]["categories"])


def test_dosa_notes_has_green_only_where_every_rule_ran() -> None:
    rep = run_pipeline("in.example.dosanotes")["report"]
    cats = {c["id"]: c for c in rep["card"]["categories"]}
    assert cats["location"]["color"] == "green" and cats["location"]["note"] == "No issue found in what we could check."
    assert cats["camera_mic"]["color"] == "green"
    assert cats["ads_tracking"]["color"] == "grey"  # C03/T05 need runtime evidence
    assert cats["contacts"]["color"] == "grey" and cats["contacts"]["note"] == "Not checked in this version."
    assert not [c for c in cats.values() if c["color"] == "red"]
    assert rep["card"]["answers"][0]["text"] == "We found no location permission in the app."


def test_card_notes_never_say_safe_or_compliant() -> None:
    for pkg in ("in.example.chaiwallet", "in.example.dosanotes", "in.example.shopkart"):
        rep = run_pipeline(pkg)["report"]
        for c in rep["card"]["categories"]:
            assert "safe" not in c["note"].lower().replace("safety", "") and "compliant" not in c["note"].lower()


# ------------------------------------------------------------------ disputes: hiding a finding hides what it caused


def test_hiding_a_finding_recomputes_card_summary_and_rules() -> None:
    rep = Report.model_validate(run_pipeline("in.example.shopkart")["report"])
    out = hide_findings(rep, {"f_dm_01"})
    assert [f.id for f in out.findings] == ["f_bm_01", "f_bm_02", "f_bm_03"]
    assert out.summary.strong == 0 and out.summary.indicative == 3
    ads = next(c for c in out.card.categories if c.id == "ads_tracking")
    assert ads.color == "orange" and ads.finding_ids == ["f_bm_03"]
    runs = {r.rule_id: r.status for r in out.rule_runs}
    assert runs["P06"] == "potential_conflict"  # only lowered to what remains
    assert out.findings[2].related_finding_ids is None
    assert sum(out.status_counts.model_dump().values()) == len(out.rule_runs)
    out2 = hide_findings(rep, {"f_dm_01", "f_bm_03"})
    assert next(c for c in out2.card.categories if c.id == "ads_tracking").color == "yellow"  # indicators remain
    assert {r.rule_id: r.status for r in out2.rule_runs}["P06"] == "no_issue_detected"
    assert hide_findings(rep, set()) is rep
    hi = relocalise(out, "hi")
    assert [c.id for c in hi.card.categories] == [c.id for c in out.card.categories]
