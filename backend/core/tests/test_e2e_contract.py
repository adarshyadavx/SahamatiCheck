"""End to end: demo fixtures -> real pipeline -> Report, validated against the TS contract."""

from __future__ import annotations

import json

import pytest
from sahamati_core.pipeline import run_pipeline
from sahamati_core.schema import Job, JobStatus, Ontology, OntologyNode, PolicySegmentsResponse, Report
from ts_contract import TS_PATH, Contract

SAMPLE = TS_PATH.parents[1] / "fixtures" / "report.sample.json"
CONTRACT = Contract()
BANNED = ["violat", "lie", "lies", "illegal", "fraudulent", "non-compliant", "noncompliant", "cheat", "scam"]


@pytest.fixture(scope="module")
def chai() -> dict:
    return run_pipeline("in.example.chaiwallet")["report"]


@pytest.fixture(scope="module")
def dosa() -> dict:
    return run_pipeline("in.example.dosanotes")["report"]


def test_contract_parser_sees_the_interfaces() -> None:
    assert {"Report", "Finding", "Evidence", "ClaimMatrixRow", "Job", "Ontology"} <= set(CONTRACT.interfaces)
    assert CONTRACT.literals("Coverage") == {"ok", "unavailable", "unreachable", "obfuscated", "unparseable"}


def test_sample_matches_contract_and_round_trips() -> None:
    sample = json.loads(SAMPLE.read_text())
    assert CONTRACT.check("Report", sample) == []
    assert Report.model_validate(sample).model_dump(mode="json") == sample


def test_enums_match_contract() -> None:
    from sahamati_core.schema import Action, Coverage, Polarity

    assert {a.value for a in Action} == CONTRACT.literals("Action")
    assert {p.value for p in Polarity} == CONTRACT.literals("Polarity")
    assert {c.value for c in Coverage} == CONTRACT.literals("Coverage")
    assert {s.value for s in JobStatus} == CONTRACT.literals("JobStatus")


def test_chaiwallet_report_matches_contract(chai: dict) -> None:
    assert CONTRACT.check("Report", chai) == []
    Report.model_validate(chai)


def test_chaiwallet_reproduces_sample_findings(chai: dict) -> None:
    classes = {f["class"] for f in chai["findings"]}
    assert {"internal_contradiction", "declaration_mismatch", "behavioural_mismatch"} <= classes
    assert all(f["tier"] == ("indicative" if f["class"] == "behavioural_mismatch" else "strong") for f in chai["findings"])
    assert [g["data_type"] for g in chai["disclosure_gaps"]] == ["camera_media"]
    # gaps never appear in findings[]
    assert all(f["class"] != "disclosure_gap" for f in chai["findings"])

    ic = next(f for f in chai["findings"] if f["class"] == "internal_contradiction")
    assert ic["ontology_path"] == ["personal_info", "location", "precise_location"]
    assert ic["sides"][0]["evidence"]["quote"] == "We do not collect your location."
    assert ic["sides"][1]["evidence"]["quote"] == "We collect your precise GPS location to help prevent fraud."

    dm = next(f for f in chai["findings"] if f["class"] == "declaration_mismatch")
    assert dm["sides"][0]["source"] == "policy" and dm["sides"][1]["source"] == "data_safety"
    assert dm["sides"][0]["evidence"]["quote"] == "We never share your personal information with third parties."
    assert dm["sides"][1]["evidence"]["label"].startswith("Device or other IDs")

    bm = next(f for f in chai["findings"] if f["class"] == "behavioural_mismatch")
    assert bm["sides"][1]["evidence"]["permission"] == "android.permission.READ_CONTACTS"
    assert bm["sides"][0]["evidence"]["label"] == "Contacts — Not collected"


def test_chaiwallet_summary_and_matrix_match_sample(chai: dict) -> None:
    sample = json.loads(SAMPLE.read_text())
    assert chai["summary"] == sample["summary"]
    assert chai["coverage"] == sample["coverage"]
    ours = {r["data_type"]: (r["policy"], r["data_safety"], r["apk"], r.get("conflict_class")) for r in chai["matrix"]}
    theirs = {r["data_type"]: (r["policy"], r["data_safety"], r["apk"], r.get("conflict_class")) for r in sample["matrix"]}
    assert ours == theirs
    assert chai["report_id"] == sample["report_id"]
    assert chai["app"] == sample["app"]


def test_evidence_offsets_point_at_the_quote() -> None:
    state = run_pipeline("in.example.chaiwallet")
    text = state["policy"]["text"]
    for f in state["report"]["findings"]:
        for side in f["sides"]:
            ev = side["evidence"]
            if "quote" in ev:
                assert text[ev["char_start"]:ev["char_end"]] == ev["quote"]
                assert ev["text_fragment"].startswith("#:~:text=")


def test_dosanotes_has_no_strong_findings(dosa: dict) -> None:
    assert CONTRACT.check("Report", dosa) == []
    assert dosa["summary"]["strong"] == 0
    assert not [f for f in dosa["findings"] if f["tier"] == "strong"]
    assert dosa["summary"]["agree_types"] >= 3


def test_summaries_use_neutral_wording(chai: dict) -> None:
    for f in chai["findings"]:
        words = f["summary"].lower().replace(",", " ").replace(".", " ").split()
        for b in BANNED:
            assert not any(w.startswith(b) for w in words), (b, f["summary"])
        assert "appear" in f["summary"] or "while" in f["summary"]


# --------------------------------------------------------------------------- the extended contract (PLAN.md §4.9)
#
# report.sample.json is hand-written. The backend reproduces its structure (ids, categories, groups,
# strengths, limitations, rule runs, indicators) and differs in these documented places only:
#   * f_dm_01 is `potential_conflict` (0.69), not `confirmed_conflict` (0.91). The policy denies sharing
#     "personal information" (the root of the hierarchy) and the declaration shares "Device or other IDs",
#     two levels down. The engine's specificity penalty s_spec = 1/(1+0.15*gap) and the heuristic-free
#     claim confidence (0.9) cap that pair at 0.69, under confirm_threshold (0.85). So P06 and the
#     ads_tracking category are potential_conflict / orange. The ShopKart golden shows a confirmed case.
#   * T02 is `no_issue_detected`: Chai Wallet ships no advertising SDK (the sample lists T02 as
#     needs_review without an indicator behind it).
#   * A01 runs and adds two indicators (contacts, camera): neither the policy nor the declaration states
#     a purpose for them. The sample does not list A01.
#   * D03 is phase 1 (PLAN.md §4.9 lists it among the enabled Phase 1 rules); the sample says 2.
#   * card notes and answer texts are generated from templates; the sample's are hand-written.
DOCUMENTED_STATUS_DIFFS = {"P06": ("confirmed_conflict", "potential_conflict"),
                           "T02": ("needs_review", "no_issue_detected")}


def test_chaiwallet_findings_match_the_extended_sample(chai: dict) -> None:
    sample = json.loads(SAMPLE.read_text())
    ours = {f["id"]: f for f in chai["findings"]}
    assert set(ours) == {f["id"] for f in sample["findings"]}
    for want in sample["findings"]:
        got = ours[want["id"]]
        for key in ("class", "tier", "rule_id", "evidence_strength", "user_category", "group_id"):
            assert got[key] == want[key], (want["id"], key)
        if want["id"] == "f_dm_01":
            assert (want["status"], got["status"]) == ("confirmed_conflict", "potential_conflict")
            assert got["limitations"] == ["confidence_below_confirm_threshold"] and got["confidence"] < 0.85
        else:
            assert got["status"] == want["status"], want["id"]
            assert got["limitations"] == want["limitations"], want["id"]
    assert all(set(f) >= {"status", "evidence_strength", "limitations", "user_category"} for f in chai["findings"])


def test_chaiwallet_indicators_and_rule_runs_cover_the_sample(chai: dict) -> None:
    sample = json.loads(SAMPLE.read_text())
    ind = {i["id"]: i for i in chai["indicators"]}
    for want in sample["indicators"]:
        got = ind[want["id"]]
        for key in ("rule_id", "status", "user_category", "data_type", "ontology_path", "source", "evidence", "group_id"):
            assert got.get(key) == want.get(key), (want["id"], key)
    assert {i["id"] for i in chai["indicators"]} - set(ind) == set()
    assert {"i_a01", "i_a01_2"} <= set(ind)  # the documented superset
    runs = {r["rule_id"]: r for r in chai["rule_runs"]}
    for want in sample["rule_runs"]:
        got = runs[want["rule_id"]]
        assert got["name"] == want["name"] and got["family"] == want["family"], want["rule_id"]
        if want["rule_id"] in DOCUMENTED_STATUS_DIFFS:
            assert (want["status"], got["status"]) == DOCUMENTED_STATUS_DIFFS[want["rule_id"]]
        else:
            assert got["status"] == want["status"], want["rule_id"]
            assert got.get("reason") == want.get("reason"), want["rule_id"]
    assert set(runs) - {r["rule_id"] for r in sample["rule_runs"]} == {"A01"}
    assert "AI09" not in runs  # a guard, not a rule run
    counts = {k: sum(1 for r in chai["rule_runs"] if r["status"] == k) for k in chai["status_counts"]}
    assert chai["status_counts"] == counts and sum(counts.values()) == len(chai["rule_runs"])


def test_chaiwallet_card_matches_the_sample(chai: dict) -> None:
    sample = json.loads(SAMPLE.read_text())
    assert [c["id"] for c in chai["card"]["categories"]] == [c["id"] for c in sample["card"]["categories"]]
    assert [a["id"] for a in chai["card"]["answers"]] == [a["id"] for a in sample["card"]["answers"]]
    ours = {c["id"]: c for c in chai["card"]["categories"]}
    for want in sample["card"]["categories"]:
        got = ours[want["id"]]
        if want["id"] == "ads_tracking":
            assert (want["color"], got["color"]) == ("red", "orange")  # see f_dm_01 above
            assert got["status"] == "potential_conflict"
        else:
            assert (got["color"], got["status"]) == (want["color"], want["status"]), want["id"]
        assert got["finding_ids"] == want["finding_ids"], want["id"]
        assert set(want["indicator_ids"]) <= set(got["indicator_ids"]), want["id"]
    for want in sample["card"]["answers"]:
        got = next(a for a in chai["card"]["answers"] if a["id"] == want["id"])
        assert got["finding_ids"] == want["finding_ids"], want["id"]
    # red only for a confirmed conflict; there is no overall colour, score or grade (CLAUDE.md rule 3)
    assert not [c for c in ours.values() if c["color"] == "red"]
    assert set(chai["card"]) == {"categories", "answers", "checked_at"}
    assert not {k for k in chai if "score" in k or "grade" in k}


def test_other_demo_apps_have_the_new_fields() -> None:
    for pkg in ("in.example.dosanotes", "in.example.shopkart"):
        rep = run_pipeline(pkg)["report"]
        assert CONTRACT.check("Report", rep) == [], pkg
        assert len(rep["card"]["categories"]) == 10 and len(rep["card"]["answers"]) == 5
        assert sum(rep["status_counts"].values()) == len(rep["rule_runs"])


def test_api_models_match_contract() -> None:
    job = Job(job_id="j_1", status=JobStatus.RUNNING, stage="fetch_policy", progress=0.3)
    assert CONTRACT.check("Job", job.model_dump(mode="json")) == []
    onto = Ontology(version="v", nodes=[OntologyNode(id="a", label_en="A", label_hi="ए", parents=[], kind="actor")])
    assert CONTRACT.check("Ontology", onto.model_dump(mode="json")) == []
    seg = PolicySegmentsResponse(segments=[], vague_claim_ratio=0.0)
    assert CONTRACT.check("PolicySegmentsResponse", seg.model_dump(mode="json")) == []


def _deva(s: str) -> bool:
    return any("ऀ" <= ch <= "ॿ" for ch in s)


def test_hindi_relocalisation(chai: dict) -> None:
    from sahamati_core.report import relocalise

    hi = relocalise(Report.model_validate(chai), "hi").model_dump(mode="json")
    assert CONTRACT.check("Report", hi) == []
    assert all(_deva(f["summary"]) for f in hi["findings"])
    assert all(_deva(i["summary"]) for i in hi["indicators"])
    assert all(_deva(c["note"]) for c in hi["card"]["categories"])
    assert all(_deva(a["text"]) for a in hi["card"]["answers"])
    assert all(_deva(r["name"]) for r in hi["rule_runs"])
    # only text changes: structure, ids, statuses and colours are identical
    assert [(f["id"], f["status"], f["group_id"]) for f in hi["findings"]] == [
        (f["id"], f["status"], f["group_id"]) for f in chai["findings"]]
    assert [(c["id"], c["color"], c["status"], c["finding_ids"], c["indicator_ids"]) for c in hi["card"]["categories"]] == [
        (c["id"], c["color"], c["status"], c["finding_ids"], c["indicator_ids"]) for c in chai["card"]["categories"]]
    assert [(r["rule_id"], r["status"], r.get("reason")) for r in hi["rule_runs"]] == [
        (r["rule_id"], r["status"], r.get("reason")) for r in chai["rule_runs"]]
    assert hi["status_counts"] == chai["status_counts"] and hi["summary"] == chai["summary"]


def test_every_emitted_string_is_free_of_banned_wording(chai: dict, dosa: dict) -> None:
    """The wording lint (check-wording.mjs) scans the templates; this scans what the backend actually emits."""
    from sahamati_core.report import relocalise
    from test_registry import banned_hits

    shop = run_pipeline("in.example.shopkart")["report"]

    def strings(node, path=""):  # type: ignore[no-untyped-def]
        if isinstance(node, str):
            yield path, node
        elif isinstance(node, dict):
            for k, v in node.items():
                if k in ("evidence", "sides"):
                    continue  # verbatim quotes from the app's own policy and declaration
                yield from strings(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                yield from strings(v, f"{path}[{i}]")

    for rep in (chai, dosa, shop):
        for variant in (rep, relocalise(Report.model_validate(rep), "hi").model_dump(mode="json")):
            for where, s in strings(variant):
                assert not banned_hits(s), (where, s)


def test_contract_checker_catches_drift(chai: dict) -> None:
    bad = json.loads(json.dumps(chai))
    bad["findings"][0]["extra"] = 1
    del bad["summary"]["agree_types"]
    bad["coverage"]["apk"] = "maybe"
    errs = CONTRACT.check("Report", bad)
    assert any("extra field extra" in e for e in errs)
    assert any("agree_types" in e for e in errs)
    assert any("coverage.apk" in e for e in errs)
