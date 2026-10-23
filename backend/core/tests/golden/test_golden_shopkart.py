"""Golden test: the full ShopKart report (fabricated app, PLAN.md §4.9) against shopkart_report.json.

Compared ignoring only the values that change per run: report_id, generated_at and captured_at
(plus card.checked_at, which is defined to equal generated_at and is asserted equal below).

Regenerate after an intentional change, then review the diff:

    cd backend && UPDATE_GOLDEN=1 .venv/bin/pytest core/tests/golden -q
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from sahamati_core.pipeline import run_pipeline
from sahamati_core.schema import Report

GOLDEN = Path(__file__).with_name("shopkart_report.json")
VOLATILE = {"report_id", "generated_at", "captured_at", "checked_at"}


def _strip(node: Any) -> Any:
    if isinstance(node, dict):
        return {k: _strip(v) for k, v in node.items() if k not in VOLATILE}
    if isinstance(node, list):
        return [_strip(x) for x in node]
    return node


@pytest.fixture(scope="module")
def report() -> dict[str, Any]:
    r: dict[str, Any] = run_pipeline("in.example.shopkart")["report"]
    return r


def test_shopkart_report_matches_golden(report: dict[str, Any]) -> None:
    assert report["report_id"] == "r_demo_shopkart"
    assert report["card"]["checked_at"] == report["generated_at"]
    Report.model_validate(report)
    if os.environ.get("UPDATE_GOLDEN") == "1":
        GOLDEN.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert _strip(report) == _strip(golden)


def test_shopkart_outcome_is_the_documented_one(report: dict[str, Any]) -> None:
    """PLAN.md §4.9: ads red, location orange, camera yellow, account grey, no green, no overall colour."""
    cats = {c["id"]: c for c in report["card"]["categories"]}
    assert [c["id"] for c in report["card"]["categories"]] == [
        "location", "contacts", "photos_files", "camera_mic", "messages_calls", "money_payments", "identity",
        "health", "ads_tracking", "account_profile"]
    assert cats["ads_tracking"]["color"] == "red"
    assert cats["location"]["color"] == "orange"
    assert cats["camera_mic"]["color"] == "yellow"
    assert cats["account_profile"]["color"] == "grey"
    assert all(c["color"] == "grey" for k, c in cats.items()
               if k not in ("ads_tracking", "location", "camera_mic"))
    assert not [c for c in cats.values() if c["color"] == "green"]
    runs = {r["rule_id"]: r["status"] for r in report["rule_runs"]}
    assert runs["P06"] == "confirmed_conflict"  # ads: the policy denies sharing device IDs, the declaration shares them
    assert runs["P05"] == "potential_conflict"  # location: permission only
    assert runs["P07"] == "potential_conflict"
    assert {"D01", "D03", "T02", "T08", "A01"} <= {i["rule_id"] for i in report["indicators"]}
    assert runs["T01"] == "no_issue_detected"
    # only the confirmed finding turns a category red
    red = [c for c in cats.values() if c["color"] == "red"]
    assert len(red) == 1
    f = next(f for f in report["findings"] if f["status"] == "confirmed_conflict")
    assert f["tier"] == "strong" and f["evidence_strength"] == "declaration" and f["confidence"] >= 0.85
    # grouping (AI11): the two ads findings and the two location findings reference each other
    by_id = {x["id"]: x for x in report["findings"]}
    for fi in report["findings"]:
        for rid in fi.get("related_finding_ids", []):
            assert by_id[rid]["group_id"] == fi["group_id"]
            assert fi["id"] in by_id[rid]["related_finding_ids"]
    ads_ind = [i for i in report["indicators"] if i["user_category"] == "ads_tracking"]
    assert ads_ind and all(i["group_id"] == f["group_id"] for i in ads_ind)
