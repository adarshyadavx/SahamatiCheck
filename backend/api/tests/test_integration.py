"""Integration tests: HTTP API -> pipeline -> engine -> database -> report, with nothing mocked inside the system.

Only the outside world is faked (the network is blocked by conftest; the Play scraper is absent).
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sahamati_api.main import app
from sahamati_core.db import DisputeRow, FeedbackRow, JobRow, ReportRow, repo, session_scope
from sahamati_core.db.repo import _now

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "tests"))
from ts_contract import Contract  # noqa: E402

CONTRACT = Contract()
SHOP = "in.example.shopkart"

POLICY = """<html><body><h1>Privacy policy</h1>
<p>We never collect your precise location.</p>
<p>We do not share your personal information with third parties.</p></body></html>"""
DECLARATION = {
    "schema": "sahamati.data_safety/v1", "package": "in.example.integ", "captured_at": "2026-10-19", "source": "upload",
    "no_data_collected": False, "no_data_shared": False,
    "data_types": [
        {"category": "Location", "type": "Precise location", "collected": True, "shared": False,
         "purposes_collected": ["App functionality"], "purposes_shared": []},
        {"category": "Device or other IDs", "type": "Device or other IDs", "collected": True, "shared": True,
         "purposes_collected": ["Advertising or marketing"], "purposes_shared": ["Advertising or marketing"]},
    ],
}
MANIFEST = """<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="in.example.integ"
  android:versionCode="3"><uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
  <uses-permission android:name="android.permission.CAMERA"/><application android:label="Integ"/></manifest>"""
CLASSES = "com.google.android.gms.ads.AdView\nin.example.integ.MainActivity\n"


@pytest.fixture(scope="module")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


def _self_check(client: TestClient, **over: Any) -> Any:
    data = {"package_name": "in.example.integ", "policy_text": POLICY, "data_safety": json.dumps(DECLARATION),
            "manifest": MANIFEST, "classes": CLASSES}
    data.update(over)
    return client.post("/v1/self-check", data={k: v for k, v in data.items() if v is not None})


# ------------------------------------------------------------------ a developer self-check, end to end


def test_self_check_finds_the_planted_contradictions_and_nothing_leaks(client: TestClient) -> None:
    r = _self_check(client)
    assert r.status_code == 200, r.text
    body = r.json()
    rep = body["report"]
    assert CONTRACT.check("Report", body["report"]) == []  # (the TS checker has no boolean literals, so `private: true` is asserted below)
    assert body["private"] is True and body["kind"] == "report"
    assert rep["coverage"] == {"policy": "ok", "data_safety": "ok", "apk": "ok"}
    pairs = {(f["class"], f["rule_id"]) for f in rep["findings"]}
    assert ("declaration_mismatch", "DM-01") in pairs  # "no precise location" vs the declared collection; and the sharing denial
    # evidence from both sides, verbatim, with a locator for the policy side
    f = rep["findings"][0]
    quotes = [s["evidence"].get("quote") or s["evidence"].get("label") or s["evidence"].get("permission") for s in f["sides"]]
    assert all(quotes)
    # status is set by the registry, red only for a confirmed conflict, and the card agrees
    for fin in rep["findings"]:
        assert fin["status"] in {"confirmed_conflict", "potential_conflict", "needs_review"}
    reds = [c for c in rep["card"]["categories"] if c["color"] == "red"]
    assert all(any(fid in [x["id"] for x in rep["findings"] if x["status"] == "confirmed_conflict"] for fid in c["finding_ids"])
               for c in reds)
    # private: not public, not in the audit, not indexable; fetchable only by its unguessable id
    rid = rep["report_id"]
    assert client.get("/v1/apps/in.example.integ/report").status_code == 404
    again = client.get(f"/v1/reports/{rid}")
    assert again.status_code == 200 and again.headers["x-robots-tag"].startswith("noindex")
    assert again.json()["report_id"] == rid


def test_self_check_persists_one_private_row_with_an_expiry_and_it_is_purged_when_old(client: TestClient) -> None:
    rid = _self_check(client, package_name="in.example.integ2").json()["report"]["report_id"]
    with session_scope() as s:
        row = s.get(ReportRow, rid)
        assert row is not None and row.private is True and row.is_demo is False and row.expires_at is not None
        assert repo._aware(row.expires_at) - _now() > timedelta(days=29)
        row.expires_at = _now() - timedelta(minutes=1)
    with session_scope() as s:
        assert repo.purge_expired(s) >= 1
    assert client.get(f"/v1/reports/{rid}").status_code == 404


def test_apk_without_a_class_list_means_sdk_rules_cannot_pass(client: TestClient) -> None:
    """AI09 end to end: a manifest alone cannot show that an SDK is absent."""
    rep = _self_check(client, package_name="in.example.integ3", classes=None).json()["report"]
    runs = {r["rule_id"]: r for r in rep["rule_runs"]}
    assert runs["T01"]["status"] == "inconclusive" and runs["T01"]["reason"] == "apk_partial_coverage"
    assert all(r["status"] != "no_issue_detected" for r in rep["rule_runs"] if r["rule_id"] in {"T01", "T02"})


def test_a_garbage_apk_is_unparseable_and_the_file_is_not_kept(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    made: list[str] = []
    real = tempfile.mkstemp

    def spy(*a: Any, **k: Any) -> tuple[int, str]:
        fd, path = real(*a, **k)
        made.append(path)
        return fd, path

    monkeypatch.setattr(tempfile, "mkstemp", spy)
    r = client.post("/v1/self-check", data={"package_name": "in.example.integ4", "policy_text": POLICY},
                    files={"apk": ("app.apk", b"PK\x03\x04 not really an apk", "application/vnd.android.package-archive")})
    assert r.status_code == 200, r.text
    rep = r.json()["report"]
    assert rep["coverage"]["apk"] == "unparseable"
    runs = {x["rule_id"]: x for x in rep["rule_runs"]}
    assert runs["D01"]["status"] == "inconclusive" and runs["D01"]["reason"] in {"apk_unparseable", "apk_unavailable"}
    assert made and not any(Path(p).exists() for p in made)  # CLAUDE.md rule 8: the APK is never stored


@pytest.mark.parametrize(("over", "code"), [
    ({"data_safety": "{not json"}, 422),
    ({"data_safety": "[1, 2]"}, 422),
    ({"policy_text": None, "data_safety": None, "manifest": None, "classes": None}, 422),
    ({"package_name": "not a package"}, 422),
])
def test_self_check_rejects_bad_input(client: TestClient, over: dict[str, Any], code: int) -> None:
    assert _self_check(client, **over).status_code == code


def test_self_check_rejects_a_non_multipart_body(client: TestClient) -> None:
    assert client.post("/v1/self-check", json={"package_name": "in.example.x"}).status_code == 422


def test_self_check_limits_upload_size(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SAHAMATI_MAX_UPLOAD_MB", "1")
    r = client.post("/v1/self-check", data={"package_name": "in.example.big"},
                    files={"apk": ("big.apk", b"0" * (1024 * 1024 + 10), "application/octet-stream")})
    assert r.status_code in (413, 422), r.text


# ------------------------------------------------------------------ checks, jobs, events


def test_unknown_job_is_404_everywhere(client: TestClient) -> None:
    assert client.get("/v1/jobs/nope").status_code == 404
    assert client.get("/v1/jobs/nope/events").status_code == 404


def test_a_failed_job_streams_an_error_event(client: TestClient) -> None:
    with session_scope() as s:
        s.add(JobRow(id="j_failed_it", package="in.example.gone", status="error", stage="ingest_listing",
                     progress=0.1, error="Play listing unavailable"))
    with client.stream("GET", "/v1/jobs/j_failed_it/events") as r:
        text = "".join(r.iter_text())
    assert "event: progress" in text and "event: error" in text and "Play listing unavailable" in text
    assert "event: done" not in text


def test_a_stuck_job_times_out_instead_of_hanging(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SAHAMATI_SSE_TIMEOUT_S", "1")
    with session_scope() as s:
        s.add(JobRow(id="j_stuck_it", package="in.example.stuck", status="running", stage="fetch_policy", progress=0.2))
    t0 = time.time()
    with client.stream("GET", "/v1/jobs/j_stuck_it/events") as r:
        text = "".join(r.iter_text())
    assert time.time() - t0 < 10 and '"error": "timeout"' in text


def test_a_package_that_cannot_be_ingested_is_a_clear_422(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "google_play_scraper", None)
    r = client.post("/v1/checks", params={"wait": "true"}, json={"package_name": "com.real.app"})
    assert r.status_code == 422 and "play" in r.json()["detail"].lower()
    assert client.post("/v1/checks", json={"package_name": "///"}).status_code == 422
    assert client.post("/v1/checks", json={}).status_code == 422


def test_play_url_is_accepted_in_place_of_a_package(client: TestClient) -> None:
    r = client.post("/v1/checks", params={"wait": "true"},
                    json={"play_url": f"https://play.google.com/store/apps/details?id={SHOP}&hl=en"})
    assert r.status_code == 200 and r.json()["report"]["app"]["package"] == SHOP


# ------------------------------------------------------------------ report caching and language


def test_etag_round_trip_per_language(client: TestClient) -> None:
    en = client.get("/v1/reports/r_demo_shopkart")
    hi = client.get("/v1/reports/r_demo_shopkart", params={"hl": "hi"})
    assert en.headers["etag"] != hi.headers["etag"]
    for resp, params in ((en, {}), (hi, {"hl": "hi"})):
        again = client.get("/v1/reports/r_demo_shopkart", params=params, headers={"If-None-Match": resp.headers["etag"]})
        assert again.status_code == 304 and not again.content
    assert client.get("/v1/reports/r_demo_shopkart", headers={"If-None-Match": hi.headers["etag"]}).status_code == 200


def test_the_database_and_the_api_serve_the_same_report(client: TestClient) -> None:
    served = client.get("/v1/reports/r_demo_shopkart").json()
    with session_scope() as s:
        row = s.get(ReportRow, "r_demo_shopkart")
        assert row is not None
        stored = row.payload
    assert stored == served  # nothing is rewritten on the way out when no dispute is open
    assert CONTRACT.check("Report", served) == []


def test_policy_history(client: TestClient) -> None:
    assert client.get("/v1/apps/not-a-package/policy-history").status_code == 422
    empty = client.get("/v1/apps/in.example.nohistory/policy-history").json()
    assert empty == {"package": "in.example.nohistory", "snapshots": [], "diffs": []}
    assert CONTRACT.check("PolicyHistory", client.get("/v1/apps/in.example.chaiwallet/policy-history").json()) == []


# ------------------------------------------------------------------ feedback and disputes


def test_feedback_is_stored_and_validated(client: TestClient) -> None:
    r = client.post("/v1/findings/f_integ_1/feedback", json={"report_id": "r_demo_shopkart", "verdict": "looks_wrong",
                                                              "comment": "this is not what the policy says"})
    assert r.status_code == 202
    with session_scope() as s:
        rows = s.query(FeedbackRow).filter(FeedbackRow.finding_id == "f_integ_1").all()
        assert len(rows) == 1 and rows[0].comment and rows[0].report_id == "r_demo_shopkart"
    assert client.post("/v1/findings/" + "x" * 65 + "/feedback", json={"verdict": "looks_wrong"}).status_code == 422


def test_dispute_validation_and_the_hide_after_review_flow(client: TestClient) -> None:
    bad = {"report_id": "r_demo_shopkart", "contact_email": "not-an-email", "message": "x"}
    assert client.post("/v1/disputes", json=bad).status_code == 422
    ok = client.post("/v1/disputes", json={**bad, "contact_email": "dev@example.com", "finding_id": "f_dm_01",
                                           "message": "We fixed the policy."})
    assert ok.status_code == 201 and ok.json()["status"] == "pending_verification"
    did = ok.json()["dispute_id"]
    # a pending dispute does not hide anything; only a verified one (under_review) does
    assert "f_dm_01" in [f["id"] for f in client.get("/v1/reports/r_demo_shopkart").json()["findings"]]
    with session_scope() as s:
        s.get(DisputeRow, did).status = "under_review"  # type: ignore[union-attr]
    hidden = client.get("/v1/reports/r_demo_shopkart").json()
    assert "f_dm_01" not in [f["id"] for f in hidden["findings"]]
    assert CONTRACT.check("Report", hidden) == []
    with session_scope() as s:
        s.get(DisputeRow, did).status = "resolved_response_attached"  # type: ignore[union-attr]
    assert "f_dm_01" in [f["id"] for f in client.get("/v1/reports/r_demo_shopkart").json()["findings"]]
    with session_scope() as s:
        s.delete(s.get(DisputeRow, did))
