from __future__ import annotations

import hashlib
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "tests"))
from sahamati_api.main import app  # noqa: E402
from sahamati_core import demo_fixtures_dir  # noqa: E402
from ts_contract import Contract  # noqa: E402

CONTRACT = Contract()
CHAI = "in.example.chaiwallet"


@pytest.fixture(scope="module")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


def _wait_job(client: TestClient, job_id: str, timeout: float = 20) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = client.get(f"/v1/jobs/{job_id}").json()
        assert CONTRACT.check("Job", j) == []
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_healthz(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_check_flow_job_then_cached(client: TestClient) -> None:
    r = client.post("/v1/checks", json={"package_name": "in.example.dosanotes"})
    assert r.status_code in (200, 202)
    if r.status_code == 202:
        body = r.json()
        assert CONTRACT.check("CheckResponse", body) == []
        assert body["kind"] == "job"
        job = _wait_job(client, body["job_id"])
        assert job["status"] == "done" and job["progress"] == 1.0
        # second call is served from cache as 200 {kind: report}
        r = client.post("/v1/checks", json={"play_url": "https://play.google.com/store/apps/details?id=in.example.dosanotes"})
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "report" and CONTRACT.check("CheckResponse", body) == []
    assert body["report"]["summary"]["strong"] == 0


def test_check_wait_returns_full_chaiwallet_report(client: TestClient) -> None:
    r = client.post("/v1/checks?wait=true", json={"package_name": CHAI})
    assert r.status_code == 200
    rep = r.json()["report"]
    assert CONTRACT.check("Report", rep) == []
    classes = {f["class"] for f in rep["findings"]}
    assert {"internal_contradiction", "declaration_mismatch", "behavioural_mismatch"} <= classes
    assert len(rep["disclosure_gaps"]) >= 1


def test_sse_events(client: TestClient) -> None:
    # force a fresh job by checking a demo package through the job path
    from sahamati_worker import submit_check

    job_id = submit_check(CHAI)
    with client.stream("GET", f"/v1/jobs/{job_id}/events") as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        body = "".join(r.iter_text())
    assert "event: progress" in body and "event: done" in body


def test_app_report_etag_and_hindi(client: TestClient) -> None:
    r = client.get(f"/v1/apps/{CHAI}/report")
    assert r.status_code == 200
    assert CONTRACT.check("Report", r.json()) == []
    assert r.headers["x-robots-tag"].startswith("noindex")
    etag = r.headers["etag"]
    r2 = client.get(f"/v1/apps/{CHAI}/report", headers={"If-None-Match": etag})
    assert r2.status_code == 304
    hi = client.get(f"/v1/apps/{CHAI}/report?hl=hi").json()
    assert CONTRACT.check("Report", hi) == []
    assert any("ऀ" <= ch <= "ॿ" for ch in hi["findings"][0]["summary"])


def test_report_by_id_including_demo_id(client: TestClient) -> None:
    r = client.get("/v1/reports/r_demo_chaiwallet")
    assert r.status_code == 200 and r.json()["app"]["package"] == CHAI
    assert client.get("/v1/reports/r_nope").status_code == 404


def test_unknown_package_without_play_extra(client: TestClient) -> None:
    r = client.post("/v1/checks?wait=true", json={"package_name": "in.example.notademo"})
    assert r.status_code == 422
    assert client.get("/v1/apps/in.example.notademo/report").status_code == 404
    assert client.post("/v1/checks", json={"package_name": "not a package"}).status_code == 422


def test_policy_history_shows_drift(client: TestClient) -> None:
    r = client.get(f"/v1/apps/{CHAI}/policy-history")
    assert r.status_code == 200
    h = r.json()
    assert len(h["snapshots"]) >= 2
    kinds = {c["kind"] for d in h["diffs"] for c in d["changes"]}
    assert "added" in kinds


def test_policy_segments(client: TestClient) -> None:
    text = "We do not collect your location. We may share some information with partners. Hello."
    r = client.post("/v1/policy/segments", json={
        "url": "https://chaiwallet.example/privacy", "text": text,
        "text_sha256": hashlib.sha256(text.encode()).hexdigest(), "lang": "en"})
    assert r.status_code == 200
    body = r.json()
    assert CONTRACT.check("PolicySegmentsResponse", body) == []
    assert len(body["segments"]) == 2
    s0 = body["segments"][0]
    assert text[s0["char_start"]:s0["char_end"]] == s0["text"]
    assert s0["tuples"][0]["polarity"] == "deny"
    assert body["segments"][1]["vague"] is True
    assert body["vague_claim_ratio"] == 0.5


def test_ontology(client: TestClient) -> None:
    r = client.get("/v1/ontology")
    assert r.status_code == 200
    body = r.json()
    assert CONTRACT.check("Ontology", body) == []
    kinds = {n["kind"] for n in body["nodes"]}
    assert kinds == {"data_type", "actor", "purpose"}
    assert client.get(f"/v1/ontology/{body['version']}").status_code == 200
    assert client.get("/v1/ontology/1999.1.1").status_code == 404


def test_audit_aggregates_demo_when_empty(client: TestClient) -> None:
    r = client.get("/v1/audit/aggregates")
    assert r.status_code == 200
    body = r.json()
    assert body["is_demo"] is True  # only fabricated demo apps exist in the test DB
    body.pop("is_demo")
    assert CONTRACT.check("AuditAggregate", body) == []
    assert all(c["apps"] >= 5 for c in body["by_category"])


def test_feedback_and_dispute(client: TestClient) -> None:
    r = client.post("/v1/findings/f_dm_01/feedback", json={"report_id": "r_demo_chaiwallet", "verdict": "looks_wrong"})
    assert r.status_code == 202
    r = client.post("/v1/disputes", json={"report_id": "r_demo_chaiwallet", "finding_id": "f_dm_01",
                                          "contact_email": "dev@example.com", "message": "We updated the policy."})
    assert r.status_code == 201 and r.json()["acknowledge_within_hours"] == 72
    assert client.post("/v1/disputes", json={"report_id": "r_missing", "contact_email": "a@b.c",
                                             "message": "x"}).status_code == 404


def test_self_check_multipart(client: TestClient) -> None:
    d = demo_fixtures_dir() / CHAI
    files = {
        "policy": ("policy.html", (d / "policy.html").read_bytes(), "text/html"),
        "data_safety": ("ds.json", (d / "data_safety.json").read_bytes(), "application/json"),
        "manifest": ("AndroidManifest.xml", (d / "AndroidManifest.xml").read_bytes(), "text/xml"),
        "classes": ("classes.txt", (d / "classes.txt").read_bytes(), "text/plain"),
    }
    r = client.post("/v1/self-check", data={"package_name": "in.example.mydraftapp", "app_title": "Draft"}, files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["private"] is True and body["expires_at"]
    rep = body["report"]
    assert CONTRACT.check("Report", rep) == []
    assert rep["report_id"].startswith("r_sc_") and rep["app"]["is_demo"] is False
    assert rep["summary"]["strong"] == 2
    for f in body["suppressed_findings"]:
        assert CONTRACT.check("Finding", f) == []
    # private: not served as the package's public report
    assert client.get("/v1/apps/in.example.mydraftapp/report").status_code == 404
    assert body["kind"] == "report" and CONTRACT.check("CheckResponse", {"kind": "report", "report": rep}) == []
    assert client.post("/v1/self-check", data={"package_name": "in.example.x"}).status_code == 422


def test_self_check_accepts_data_safety_as_text_field(client: TestClient) -> None:
    d = demo_fixtures_dir() / "in.example.dosanotes"
    r = client.post("/v1/self-check", data={
        "package_name": "in.example.mynotes", "owner_confirmed": "true",
        "policy_text": (d / "policy.html").read_text(), "data_safety": (d / "data_safety.json").read_text()})
    assert r.status_code == 200, r.text
    rep = r.json()["report"]
    assert rep["coverage"] == {"policy": "ok", "data_safety": "ok", "apk": "unavailable"}
    assert rep["summary"]["strong"] == 0


def test_cors_for_web_and_extension(client: TestClient) -> None:
    for origin in ("http://localhost:3000", "chrome-extension://" + "a" * 32):
        r = client.options("/v1/ontology", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
        assert r.headers.get("access-control-allow-origin") == origin
    r = client.options("/v1/ontology", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers


def test_rate_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from sahamati_api import ratelimit

    monkeypatch.setenv("SAHAMATI_RATE_LIMIT_DISABLED", "0")
    monkeypatch.setenv("SAHAMATI_RATE_READS_PER_MIN", "3")
    ratelimit.limiter.reset()
    codes = [client.get("/v1/audit/aggregates").status_code for _ in range(5)]
    assert codes[:3] == [200, 200, 200] and codes[3] == 429
    ratelimit.limiter.reset()


def test_rules_listing(client: TestClient) -> None:
    r = client.get("/v1/rules")
    assert r.status_code == 200
    rules = r.json()
    ids = [x["id"] for x in rules]
    assert len(ids) == 86 and len(set(ids)) == 86  # the whole catalogue, enabled or not
    enabled = {x["id"] for x in rules if x["enabled"]}
    assert {"P05", "P06", "P07", "P12", "D01", "D03", "T01", "T02", "T08", "A01", "C03", "T05", "C07", "S06",
            "AI09"} == enabled
    assert all(x["catalogue"]["evidence"] and "phase_note" in x["catalogue"] for x in rules)
    p06 = next(x for x in rules if x["id"] == "P06")
    assert p06["engine_rules"] == ["DM-01", "BM-03", "BM-04"] and p06["required_sources"] == ["policy"]
    assert p06["name_hi"] and p06["plain_language_hi"] and p06["enabled"] is True
    only_d = client.get("/v1/rules", params={"family": "D"}).json()
    assert [x["id"] for x in only_d] == [f"D{i:02d}" for i in range(1, 13)] and all(x["investigation"] for x in only_d)
    assert [x["id"] for x in only_d if x["enabled"]] == ["D01", "D03"]
    ai = client.get("/v1/rules", params={"family": "AI"}).json()
    assert [x["id"] for x in ai] == [f"AI{i:02d}" for i in range(1, 13)]
    assert [x["id"] for x in ai if x["enabled"]] == ["AI09"]
    assert client.get("/v1/rules", params={"family": "Z"}).status_code == 422
    assert "/v1/rules" in client.get("/openapi.json").json()["paths"]


def test_new_report_fields_over_the_api(client: TestClient) -> None:
    r = client.get("/v1/reports/r_demo_shopkart")
    assert r.status_code == 200
    rep = r.json()
    assert CONTRACT.check("Report", rep) == []
    assert rep["app"]["package"] == "in.example.shopkart" and rep["app"]["is_demo"] is True
    assert {c["id"]: c["color"] for c in rep["card"]["categories"]}["ads_tracking"] == "red"
    hi = client.get("/v1/reports/r_demo_shopkart", params={"hl": "hi"}).json()
    assert CONTRACT.check("Report", hi) == []
    assert hi["card"]["answers"][0]["text"] != rep["card"]["answers"][0]["text"]
    assert [c["color"] for c in hi["card"]["categories"]] == [c["color"] for c in rep["card"]["categories"]]
    assert hi["indicators"][0]["summary"] != rep["indicators"][0]["summary"]
    assert hi["card"]["answers"][1]["text"].startswith("सुरक्षा अनुभाग")  # facts persisted with the report
    assert client.get("/v1/apps/in.example.shopkart/report").json()["report_id"] == "r_demo_shopkart"


def test_a_finding_under_review_is_hidden_with_its_card_and_summary(client: TestClient) -> None:
    from sahamati_core.db import DisputeRow, session_scope

    before = client.get("/v1/reports/r_demo_shopkart").json()
    assert before["summary"]["strong"] == 1
    with session_scope() as s:
        s.add(DisputeRow(report_id="r_demo_shopkart", finding_id="f_dm_01", contact_email="dev@example.com",
                         message="x", status="under_review"))
    after = client.get("/v1/reports/r_demo_shopkart").json()
    assert CONTRACT.check("Report", after) == []
    assert "f_dm_01" not in [f["id"] for f in after["findings"]]
    assert after["summary"]["strong"] == 0
    ads = next(c for c in after["card"]["categories"] if c["id"] == "ads_tracking")
    assert ads["color"] == "orange" and "f_dm_01" not in ads["finding_ids"]
    assert all("f_dm_01" not in a["finding_ids"] for a in after["card"]["answers"])
    hi = client.get("/v1/reports/r_demo_shopkart", params={"hl": "hi"}).json()
    assert "f_dm_01" not in [f["id"] for f in hi["findings"]]
    with session_scope() as s:
        for d in s.query(DisputeRow).filter(DisputeRow.report_id == "r_demo_shopkart"):
            s.delete(d)


def test_rules_listing_matches_ts_contract(client: TestClient) -> None:
    rules = client.get("/v1/rules").json()
    assert rules
    for i, rule in enumerate(rules):
        assert CONTRACT.check("RuleInfo", rule, f"$.rules[{i}]") == []


def test_ts_confidence_bands_match_engine_thresholds() -> None:
    import re
    from pathlib import Path

    import sahamati_core.engine as eng
    import yaml
    from sahamati_core.engine import load_config  # noqa: F401  (config import proves the package is installed)

    cfg = yaml.safe_load((Path(eng.__file__).parent / "thresholds.yaml").read_text(encoding="utf-8"))["status"]
    src = (Path(__file__).resolve().parents[3] / "packages" / "contracts" / "src" / "index.ts").read_text(encoding="utf-8")
    m = re.search(r"CONFIDENCE_BANDS = \{ strong_min: ([0-9.]+), moderate_min: ([0-9.]+) \}", src)
    assert m
    assert float(m.group(1)) == cfg["confirm_threshold"]
    assert float(m.group(2)) == cfg["min_claim_confidence"]


def test_version_endpoint_matches_ts_contract(client: TestClient) -> None:
    body = client.get("/version").json()
    assert CONTRACT.check("VersionInfo", body) == []
    assert body["api_schema"] == "1" and body["rule_count"] >= 15 and len(body["registry_digest"]) == 12
    assert client.get("/v1/version").json() == body
