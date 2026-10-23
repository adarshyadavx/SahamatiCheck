"""Declaration mapper, APK analysis, Policy Drift diff, LLM fallback, ingest helpers."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest
from sahamati_core.apk import evidence_from_facts, facts_from_fallback, parse_classes_txt
from sahamati_core.declaration import from_play_scraper, map_declaration
from sahamati_core.diff import diff_claims
from sahamati_core.ingest import IngestError, TokenBucket, normalise_package
from sahamati_core.nlp.llm_fallback import DEFAULT_MODEL, ESCALATION_MODEL, LLMFallback
from sahamati_core.pipeline import extract_policy_claims
from sahamati_core.schema import Coverage

MANIFEST = """<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="in.example.t"
  android:versionCode="7"><uses-permission android:name="android.permission.READ_CONTACTS"/>
  <uses-permission android:name="android.permission.INTERNET"/><application android:label="T"/></manifest>"""


def test_declaration_mapping() -> None:
    ds = {"captured_at": "2026-10-19", "no_data_shared": False, "data_types": [
        {"category": "Device or other IDs", "type": "Device or other IDs", "collected": True, "shared": True,
         "purposes_collected": ["Analytics"], "purposes_shared": ["Advertising or marketing"]},
        {"category": "Contacts", "type": "Contacts", "collected": False, "shared": False},
        {"type": "Teleportation logs", "collected": True},
    ]}
    res = map_declaration(ds)
    got = {(t.actor, t.action.value, t.polarity.value, t.data_type, t.condition) for t in res.tuples}
    assert ("third_party", "share", "affirm", "device_id", "advertising") in got
    assert ("first_party", "collect", "affirm", "device_id", "analytics") in got
    assert ("first_party", "collect", "deny", "contacts", None) in got
    assert res.unmapped == ["Teleportation logs"]
    labels = {t.evidence.text for t in res.tuples}
    assert "Device or other IDs — Shared — Advertising or marketing" in labels


def test_no_data_shared_carries_play_exemptions() -> None:
    res = map_declaration({"no_data_shared": True, "data_types": []})
    denials = [t for t in res.tuples if t.polarity.value == "deny"]
    assert {t.data_type for t in denials} == {"personal_info", "app_activity"}
    assert all(set(t.exceptions) == {"service_provider", "government"} for t in denials)


def test_from_play_scraper_shape() -> None:
    raw = {"sharedData": [{"data": "Device or other IDs", "optional": False,
                           "purpose": "Advertising or marketing", "type": "Device or other IDs"}],
           "collectedData": [{"data": "Precise location", "optional": False,
                              "purpose": "Fraud prevention, security, and compliance, Analytics", "type": "Location"}]}
    ds = from_play_scraper(raw, package="in.example.x", captured_at="2026-10-19")
    loc = next(e for e in ds["data_types"] if e["type"] == "Precise location")
    assert loc["purposes_collected"] == ["Fraud prevention, security, and compliance", "Analytics"]
    assert map_declaration(ds).tuples


def test_apk_fallback() -> None:
    facts = facts_from_fallback(MANIFEST, "com.google.firebase.crashlytics.FirebaseCrashlytics\ncom.appsflyer.AppsFlyerLib\n")
    assert facts.package == "in.example.t" and facts.version_code == 7
    res = evidence_from_facts(facts)
    assert res.coverage == Coverage.OK
    kinds = {(t.source_kind.value, t.action.value, t.data_type, t.actor) for t in res.tuples}
    assert ("apk_permission", "collect", "contacts", "first_party") in kinds
    assert ("apk_sdk", "share", "advertising_id", "analytics_provider") in kinds
    assert ("apk_sdk", "collect", "crash_logs", "first_party") in kinds
    assert set(res.sdks_found) == {"com.google.firebase.crashlytics", "com.appsflyer"}
    # INTERNET is not a data permission
    assert not any(t.evidence.text == "android.permission.INTERNET" for t in res.tuples)


def test_apk_obfuscation_and_unparseable() -> None:
    obf = "\n".join(f"a.b.{chr(97 + i % 26)}{i % 7}" for i in range(50))
    assert facts_from_fallback(MANIFEST, obf).coverage == Coverage.OBFUSCATED
    assert facts_from_fallback("<manifest", None).coverage == Coverage.UNPARSEABLE
    assert parse_classes_txt("Lcom/foo/Bar;\n# c\n\ncom.x.Y") == ["com.foo.Bar", "com.x.Y"]


def test_policy_drift_diff() -> None:
    old, _, _ = extract_policy_claims(
        "We do not collect your contacts. We do not share your device identifiers with advertisers. "
        "We do not collect your location.", url=None, captured_at="2026-07-01")
    new, _, _ = extract_policy_claims(
        "We collect your contacts. We do not share your personal information with advertisers. "
        "We collect your email address.", url=None, captured_at="2026-10-01")
    d = diff_claims(old, new, old_last_updated="1 July 2026", new_last_updated="1 July 2026")
    kinds = {(c.kind, c.data_type) for c in d.changes}
    assert ("polarity_flipped", "contacts") in kinds
    assert ("broadened", "personal_info") in kinds
    assert ("added", "email") in kinds
    assert ("removed", "location") in kinds
    assert d.silent  # claims changed but the "last updated" date did not


def test_llm_fallback_is_noop_without_key() -> None:
    fb = LLMFallback(api_key="")
    assert not fb.enabled
    assert fb.extract("We do not share data except with partners.", char_start=0, char_end=10) is None


class _FakeMessages:
    def __init__(self, replies: list[Any]) -> None:
        self.replies = replies
        self.calls: list[dict[str, Any]] = []

    def create(self, **kw: Any) -> Any:
        self.calls.append(kw)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=json.dumps(r))])


def test_llm_fallback_structured_output_and_escalation() -> None:
    msgs = _FakeMessages([RuntimeError("overloaded"), {"claims": [
        {"actor": "third_party", "action": "share", "data_type": "contacts", "polarity": "deny", "purpose": None,
         "exceptions": ["service_provider"]}]}])
    logged: list[dict[str, Any]] = []
    fb = LLMFallback(client=SimpleNamespace(messages=msgs), log_call=logged.append)
    out = fb.extract("We do not share contacts except with service providers.", char_start=5, char_end=60)
    assert out is not None and out[0].data_type == "contacts" and out[0].exceptions == ["service_provider"]
    assert [c["model"] for c in msgs.calls] == [DEFAULT_MODEL, ESCALATION_MODEL]
    schema = msgs.calls[0]["output_config"]["format"]["schema"]
    assert "advertising_id" in schema["properties"]["claims"]["items"]["properties"]["data_type"]["enum"]
    assert len(logged) == 2 and "error" in logged[0]


def test_normalise_package() -> None:
    assert normalise_package(None, "https://play.google.com/store/apps/details?id=in.example.chaiwallet&hl=en") \
        == "in.example.chaiwallet"
    for bad in ("", "nodots", "in.example.x; rm -rf", "https://evil.example/?id=a.b"):
        with pytest.raises(IngestError):
            normalise_package(bad if not bad.startswith("http") else None, bad if bad.startswith("http") else None)


def test_token_bucket() -> None:
    b = TokenBucket(rate_per_s=0.5, capacity=1)
    assert b.acquire(block=False)
    assert not b.acquire(block=False)  # 1 request per 2 s


def test_old_databases_get_the_facts_column(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """create_all() never alters a table, so a database from before the report card is upgraded in place."""
    import sqlalchemy as sa
    from sahamati_core.db.session import get_engine, reset_engines

    url = f"sqlite:///{tmp_path / 'old.db'}"
    old = sa.create_engine(url)
    with old.begin() as conn:
        conn.execute(sa.text("CREATE TABLE reports (id VARCHAR(64) PRIMARY KEY, package VARCHAR(255))"))
    old.dispose()
    eng = get_engine(url)
    cols = {c["name"] for c in sa.inspect(eng).get_columns("reports")}
    assert "facts" in cols
    reset_engines()
