"""Hindi must be Hindi, and every code the backend emits must have a string in both clients (contract E4/R3, BL-3)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from sahamati_api.main import app
from sahamati_core import demo_fixtures_dir
from sahamati_core.rules import load_registry

ROOT = Path(__file__).resolve().parents[2]
WEB = {loc: json.loads((ROOT.parent / "packages" / "i18n" / f"{loc}.json").read_text("utf-8")) for loc in ("en", "hi")}
EXT = {loc: json.loads((ROOT.parent / "apps" / "extension" / "locales" / f"{loc}.json").read_text("utf-8"))
       for loc in ("en", "hi")}
DEMOS = ["r_demo_shopkart", "r_demo_chaiwallet", "r_demo_dosanotes"]
# Names, identifiers and technical terms that stay in Latin script inside Hindi sentences.
ALLOWED = {"SDK", "Android", "Google", "Mobile", "Ads", "APK", "ID", "IDs", "AppsFlyer", "Facebook", "Firebase",
           "Crashlytics", "Meta", "CleverTap", "MoEngage", "ShopKart", "Chai", "Wallet", "Dosa", "Notes", "demo",
           "Example", "Labs", "UPI", "OTP", "GPS", "Analytics"}


@pytest.fixture(scope="module")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


def _emitted_limitations() -> set[str]:
    cfg = yaml.safe_load((ROOT / "core" / "sahamati_core" / "engine" / "thresholds.yaml").read_text("utf-8"))["status"]
    out = {c["limitation"] for c in cfg["ceilings"]}
    out |= {x for xs in cfg["class_limitations"].values() for x in xs}
    out |= {"tier_not_strong", "evidence_strength_insufficient", "no_registry_rule", "below_class_threshold",
            "confidence_below_confirm_threshold"}  # literals in rules/evaluator.py and report.py
    reg = load_registry()
    out |= {f"excluded_{c.predicate}" for r in reg.rules for c in r.exclude_if}
    return out


def _emitted_reasons() -> set[str]:
    reg = load_registry()
    out = {v for table in reg.reasons.values() for v in table.values()}
    return out | {"not_enabled_in_this_version", "missing_source_false_pass_prevented"}


@pytest.mark.parametrize("loc", ["en", "hi"])
def test_every_limitation_and_reason_code_has_a_string_in_both_clients(loc: str) -> None:
    for code in sorted(_emitted_limitations()):
        assert f"limitation.{code}" in EXT[loc], f"extension/{loc}: limitation.{code}"
        assert code in WEB[loc]["limitation"], f"web/{loc}: limitation.{code}"
    for code in sorted(_emitted_reasons()):
        assert f"reason.{code}" in EXT[loc], f"extension/{loc}: reason.{code}"
        assert code in WEB[loc]["reason"], f"web/{loc}: reason.{code}"


def test_codes_seen_in_real_reports_are_all_known(client: TestClient) -> None:
    known_l, known_r = _emitted_limitations(), _emitted_reasons()
    for rid in DEMOS:
        rep = client.get(f"/v1/reports/{rid}").json()
        seen = {x for f in rep["findings"] for x in f["limitations"]}
        assert seen <= known_l, (rid, seen - known_l)
        assert {r["reason"] for r in rep["rule_runs"] if r.get("reason")} <= known_r


def _texts(rep: dict) -> list[tuple[str, str]]:
    out = [(f"finding {f['id']} summary", f["summary"]) for f in rep["findings"]]
    out += [(f"finding {f['id']} benign", b) for f in rep["findings"] for b in f["benign_explanations"]]
    out += [(f"indicator {i['id']}", i["summary"]) for i in rep["indicators"]]
    out += [(f"card {c['id']} note", c["note"]) for c in rep["card"]["categories"]]
    out += [(f"card answer {a['id']}", a["text"]) for a in rep["card"]["answers"]]
    out += [(f"rule_run {r['rule_id']} name", r["name"]) for r in rep["rule_runs"]]
    return out


@pytest.mark.parametrize("rid", DEMOS)
def test_hindi_report_has_no_english_sentences(client: TestClient, rid: str) -> None:
    rep = client.get(f"/v1/reports/{rid}", params={"hl": "hi"}).json()
    texts = _texts(rep)
    assert len(texts) >= 25
    leaks = {where: words for where, s in texts if (words := [w for w in re.findall(r"[A-Za-z]{2,}", s) if w not in ALLOWED])}
    assert not leaks, leaks
    # and the Hindi text really is Devanagari, not a silently reused English sentence
    assert all(re.search(r"[ऀ-ॿ]", s) for _, s in texts), [w for w, s in texts if not re.search(r"[ऀ-ॿ]", s)]


def test_hindi_and_english_card_differ_only_in_text_not_in_decisions(client: TestClient) -> None:
    en = client.get("/v1/reports/r_demo_shopkart").json()
    hi = client.get("/v1/reports/r_demo_shopkart", params={"hl": "hi"}).json()
    assert [(c["id"], c["color"], c["status"]) for c in en["card"]["categories"]] == [
        (c["id"], c["color"], c["status"]) for c in hi["card"]["categories"]]
    assert [(f["id"], f["status"], f["confidence"]) for f in en["findings"]] == [
        (f["id"], f["status"], f["confidence"]) for f in hi["findings"]]


def test_demo_fixtures_exist() -> None:
    assert demo_fixtures_dir().is_dir()
