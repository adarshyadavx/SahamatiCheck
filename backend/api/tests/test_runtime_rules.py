"""G7: C03, T05, C07 and S06 need runtime traffic or a test account that this version does not collect.
They must always say "couldn't check" with the reason, and never `no_issue_detected` (AI09)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sahamati_api.main import app
from sahamati_core.rules import load_registry

STUBS = {
    "C03": "runtime_evidence_unavailable",
    "T05": "runtime_evidence_unavailable",
    "C07": "test_account_unavailable",
    "S06": "runtime_evidence_unavailable",
}
DEMOS = ["r_demo_shopkart", "r_demo_chaiwallet", "r_demo_dosanotes"]


@pytest.fixture(scope="module")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize("rid", DEMOS)
@pytest.mark.parametrize("rule_id", sorted(STUBS))
def test_runtime_rules_never_pass_without_runtime(client: TestClient, rid: str, rule_id: str) -> None:
    run = next(r for r in client.get(f"/v1/reports/{rid}").json()["rule_runs"] if r["rule_id"] == rule_id)
    assert run["status"] == "inconclusive"
    assert run["status"] != "no_issue_detected"
    assert run["reason"] == STUBS[rule_id]


@pytest.mark.parametrize("rid", DEMOS)
def test_report_card_lists_the_four_with_a_reason(client: TestClient, rid: str) -> None:
    rep = client.get(f"/v1/reports/{rid}").json()
    listed = {r["rule_id"]: r["reason"] for r in rep["rule_runs"] if r["status"] == "inconclusive"}
    assert {k: listed[k] for k in STUBS} == STUBS
    # ads_tracking can never be green statically: C03/T05 (runtime) cover it and cannot run
    ads = next(c for c in rep["card"]["categories"] if c["id"] == "ads_tracking")
    assert ads["color"] != "green"


def test_registry_marks_them_as_runtime_stubs() -> None:
    reg = load_registry()
    for rule_id in STUBS:
        r = reg.by_id[rule_id]
        assert r.enabled and r.engine_rules == []
        assert set(r.evidence_sources.required) <= {"runtime", "test_account"}
        assert r.catalogue.static_check in {"no_inconclusive", "partial"}
