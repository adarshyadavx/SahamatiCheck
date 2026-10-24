"""Unit tests: APK analysis edge cases, repo helpers on an isolated database, and the command-line checks."""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
import sys
import types
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from sahamati_core.apk import analyzer
from sahamati_core.apk.analyzer import (
    _obfuscation_ratio,
    facts_from_apk,
    facts_from_fallback,
    parse_classes_txt,
    parse_manifest_xml,
)
from sahamati_core.db import models, repo
from sahamati_core.db.repo import K_ANON, _aware, _now, audit_aggregates, etag_for
from sahamati_core.rules import load_registry
from sahamati_core.rules.registry import load_registry_uncached
from sahamati_core.schema import Coverage
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

REPO = Path(__file__).resolve().parents[3]
SAMPLE = json.loads((REPO / "packages/contracts/fixtures/report.sample.json").read_text("utf-8"))
NS = 'xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools"'


# ------------------------------------------------------------------ manifest and class-list parsing


def test_manifest_parsing_edge_cases() -> None:
    xml = f"""<manifest {NS} package="in.example.t" android:versionCode="12">
      <uses-permission android:name="android.permission.CAMERA"/>
      <uses-permission android:name="android.permission.CAMERA"/>
      <uses-permission-sdk-23 android:name="android.permission.READ_CONTACTS"/>
      <uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove"/>
      <application android:label="Tee"/></manifest>"""
    pkg, vc, label, perms = parse_manifest_xml(xml)
    assert (pkg, vc, label) == ("in.example.t", 12, "Tee")
    assert perms == ["android.permission.CAMERA", "android.permission.READ_CONTACTS"]  # de-duplicated; removed one dropped


def test_manifest_without_version_or_application() -> None:
    pkg, vc, label, perms = parse_manifest_xml('<manifest package="a.b"/>')
    assert (pkg, vc, label, perms) == ("a.b", None, None, [])
    assert parse_manifest_xml(f'<manifest {NS} package="a.b" android:versionCode="x1"/>')[1] is None


def test_class_list_accepts_smali_descriptors_comments_and_blanks() -> None:
    assert parse_classes_txt("# comment\n\nLcom/foo/Bar;\ncom.baz.Qux\n") == ["com.foo.Bar", "com.baz.Qux"]


def test_a_broken_manifest_is_unparseable_not_an_exception() -> None:
    facts = facts_from_fallback("<manifest><oops", "com.a.B")
    assert facts.coverage == Coverage.UNPARSEABLE and "parse error" in facts.notes[0]


def test_obfuscation_heuristic() -> None:
    assert _obfuscation_ratio([]) == 0.0
    assert _obfuscation_ratio(["a.b.c", "a.b.d", "x.y.z"]) == 1.0
    assert _obfuscation_ratio(["com.example.shop.CartActivity", "com.example.shop.Main"]) == 0.0
    facts = facts_from_fallback('<manifest package="a.b"/>', "a.b.c\na.b.d\nb.a.c")
    assert facts.coverage == Coverage.OBFUSCATED and any("obfuscated" in n for n in facts.notes)
    assert "no class list" in " ".join(facts_from_fallback('<manifest package="a.b"/>', None).notes)


# ------------------------------------------------------------------ androguard path (faked)


def _fake_androguard(monkeypatch: pytest.MonkeyPatch, *, apk_cls: Any, dex_cls: Any) -> None:
    monkeypatch.setitem(sys.modules, "androguard", types.ModuleType("androguard"))
    monkeypatch.setitem(sys.modules, "androguard.core", types.ModuleType("androguard.core"))
    monkeypatch.setitem(sys.modules, "androguard.core.apk", types.SimpleNamespace(APK=apk_cls))
    monkeypatch.setitem(sys.modules, "androguard.core.dex", types.SimpleNamespace(DEX=dex_cls))


class GoodApk:
    def __init__(self, _path: str) -> None: ...
    def get_permissions(self) -> list[str]:
        return ["android.permission.CAMERA", "android.permission.CAMERA", "android.permission.INTERNET"]

    def get_all_dex(self) -> list[bytes]:
        return [b"dex1", b"dex2"]

    def get_androidversion_code(self) -> str:
        return "77"

    def get_package(self) -> str:
        return "in.example.real"

    def get_app_name(self) -> str:
        return "Real"


class GoodDex:
    def __init__(self, data: bytes) -> None:
        self.data = data

    def get_classes_names(self) -> list[str]:
        return ["Lcom/google/android/gms/ads/AdView;", "Lin/example/real/Main;"] if self.data == b"dex1" else ["Lio/x/Y;"]


def test_real_apk_facts_via_androguard(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_androguard(monkeypatch, apk_cls=GoodApk, dex_cls=GoodDex)
    f = facts_from_apk("whatever.apk")
    assert f.coverage == Coverage.OK and f.method == "androguard"
    assert (f.package, f.version_code, f.label) == ("in.example.real", 77, "Real")
    assert f.permissions == ["android.permission.CAMERA", "android.permission.INTERNET"]
    assert f.class_names == ["com.google.android.gms.ads.AdView", "in.example.real.Main", "io.x.Y"]


def test_real_apk_with_short_class_names_is_flagged_obfuscated(monkeypatch: pytest.MonkeyPatch) -> None:
    class ObfDex(GoodDex):
        def get_classes_names(self) -> list[str]:
            return [f"La/b/{c};" for c in "cdefgh"]

    _fake_androguard(monkeypatch, apk_cls=GoodApk, dex_cls=ObfDex)
    assert facts_from_apk("x.apk").coverage == Coverage.OBFUSCATED


def test_real_apk_that_androguard_cannot_read_is_unparseable(monkeypatch: pytest.MonkeyPatch) -> None:
    class BadApk(GoodApk):
        def __init__(self, _path: str) -> None:
            raise ValueError("not a zip file")

    _fake_androguard(monkeypatch, apk_cls=BadApk, dex_cls=GoodDex)
    f = facts_from_apk("x.apk")
    assert f.coverage == Coverage.UNPARSEABLE and "not a zip file" in f.notes[0]


def test_without_androguard_a_real_apk_is_unparseable_with_advice(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("androguard", "androguard.core", "androguard.core.apk", "androguard.core.dex",
                 "androguard.core.bytecodes", "androguard.core.bytecodes.apk", "androguard.core.bytecodes.dvm"):
        monkeypatch.setitem(sys.modules, name, None)
    f = facts_from_apk("x.apk")
    assert f.coverage == Coverage.UNPARSEABLE and "classes.txt" in f.notes[0]
    assert analyzer._apkid_packed("x.apk") is False


# ------------------------------------------------------------------ repo helpers on an isolated database


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite://")
    models.Base.metadata.create_all(engine)
    try:
        with Session(engine) as s:
            yield s
    finally:
        engine.dispose()


def _row(rid: str, package: str, category: str, *, strong: int = 0, policy: str = "ok", apk: str = "ok",
         private: bool = False, demo: bool = False) -> models.ReportRow:
    payload = copy.deepcopy(SAMPLE)
    payload.update(report_id=rid)
    payload["summary"].update(strong=strong, indicative=0, not_mentioned=0, vague_claim_ratio=0.2)
    payload["coverage"].update(policy=policy, apk=apk)
    return models.ReportRow(id=rid, package=package, engine_version="x", ontology_version="y", payload=payload,
                            etag="e", category=category, private=private, is_demo=demo)


def test_etag_ignores_the_generation_time_only() -> None:
    a = {"report_id": "r", "generated_at": "2026-01-01T00:00:00Z", "x": 1}
    assert etag_for(a) == etag_for({**a, "generated_at": "2030-01-01T00:00:00Z"})
    assert etag_for(a) != etag_for({**a, "x": 2})


def test_naive_datetimes_are_treated_as_utc() -> None:
    assert _aware(None) is None
    naive = _now().replace(tzinfo=None)
    assert _aware(naive).tzinfo is not None  # type: ignore[union-attr]
    assert _aware(_now()) is not None


def test_job_helpers(db: Session) -> None:
    job = repo.create_job(db, "in.example.x")
    assert job.status == "queued" and job.progress == 0.0
    repo.update_job(db, job.id, status="running", stage="fetch_policy", progress=0.4)
    repo.update_job(db, "j_missing", status="done")  # a missing job is ignored, not an error
    view = repo.job_view(db.get(models.JobRow, job.id))  # type: ignore[arg-type]
    assert (view.status.value, view.stage, view.progress) == ("running", "fetch_policy", 0.4)


def test_audit_returns_the_demo_aggregates_when_the_corpus_is_empty(db: Session) -> None:
    agg = audit_aggregates(db)
    assert agg.is_demo is True and agg.corpus_size == 500


def test_audit_never_publishes_a_cell_smaller_than_k(db: Session) -> None:
    for i in range(K_ANON):  # a full "Finance" cell
        db.add(_row(f"r_f{i}", f"in.example.fin{i}", "Finance", strong=1 if i == 0 else 0))
    for i in range(2):  # two "Travel" apps merge into "Other", which is still too small -> dropped
        db.add(_row(f"r_t{i}", f"in.example.trv{i}", "Travel"))
    db.add(_row("r_priv", "in.example.private1", "Finance", strong=1, private=True))  # private: never counted
    db.add(_row("r_demo", "in.example.demo1", "Finance", strong=1, demo=True))  # demo: never counted
    db.commit()
    agg = audit_aggregates(db)
    assert agg.is_demo is False and agg.corpus_size == K_ANON + 2
    assert [c.category for c in agg.by_category] == ["Finance"]
    fin = agg.by_category[0]
    assert fin.apps == K_ANON and fin.strong_rate == round(1 / K_ANON, 3)
    assert all(c.apps >= K_ANON for c in agg.by_category)


def test_audit_uses_only_the_latest_report_per_app_and_counts_failures(db: Session) -> None:
    for i in range(K_ANON):
        db.add(_row(f"r_old{i}", f"in.example.a{i}", "Tools", strong=1, policy="unreachable" if i == 0 else "ok"))
    db.commit()
    for i in range(K_ANON):  # newer reports supersede the old ones for the same package
        row = _row(f"r_new{i}", f"in.example.a{i}", "Tools", strong=0, apk="unparseable" if i < 2 else "ok")
        row.created_at = _now() + timedelta(seconds=5)
        db.add(row)
    db.commit()
    agg = audit_aggregates(db)
    assert agg.corpus_size == K_ANON
    assert agg.by_category[0].strong_rate == 0.0
    assert agg.failure_rates.apk_unparseable == round(2 / K_ANON, 3)
    assert agg.failure_rates.policy_unreachable == 0.0  # the unreachable policy was in the superseded report


def test_hidden_findings_are_only_those_under_review(db: Session) -> None:
    for fid, status in (("f1", "under_review"), ("f2", "pending_verification"), ("f3", "resolved_ruleset_fixed")):
        db.add(models.DisputeRow(report_id="r1", finding_id=fid, contact_email="a@b.c", message="m", status=status))
    db.add(models.DisputeRow(report_id="r1", finding_id=None, contact_email="a@b.c", message="m", status="under_review"))
    db.add(models.DisputeRow(report_id="r2", finding_id="f9", contact_email="a@b.c", message="m", status="under_review"))
    db.commit()
    assert repo.hidden_finding_ids(db, "r1") == {"f1"}


# ------------------------------------------------------------------ command-line checks (what CI runs)


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "-m", *args], capture_output=True, text=True, check=False, cwd=REPO / "backend")


def test_ontology_validator_cli() -> None:
    out = _run("sahamati_core.ontology")
    assert out.returncode == 0 and "OK" in out.stdout


def test_registry_cli_lint_and_catalogue() -> None:
    out = _run("sahamati_core.rules")
    assert out.returncode == 0 and "86 rules (15 enabled)" in out.stdout
    md = _run("sahamati_core.rules", "--catalogue-md")
    assert md.returncode == 0 and md.stdout.startswith("# Rule catalogue") and md.stdout.count("\n| P05 |") == 1
    stale = _run("sahamati_core.rules", "--check-catalogue-md", "/nonexistent/RULE_CATALOGUE.md")
    assert stale.returncode == 1 and "stale" in stale.stdout


def test_registry_loader_names_the_broken_rule(tmp_path: Path) -> None:
    src = load_registry().directory
    shutil.copytree(src, tmp_path / "registry")
    bad = tmp_path / "registry" / "T.yaml"
    bad.write_text(bad.read_text("utf-8").replace("predicate: sdk_scan_complete", "predicate: no_such_predicate", 1), "utf-8")
    reg, errors = load_registry_uncached(tmp_path / "registry")
    assert reg is None and any("T.yaml" in e for e in errors) and any("no_such_predicate" in e for e in errors)
