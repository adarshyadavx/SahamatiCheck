"""The rule registry: it loads, it is strict, it is locked, and no code branches on a rule id."""

from __future__ import annotations

import ast
import json
import shutil
from pathlib import Path
from typing import Any

import pytest
import yaml
from sahamati_core import package_dir, registry_dir
from sahamati_core.engine.templates import has_text
from sahamati_core.ontology import load_ontology
from sahamati_core.rules import check_lock, load_registry, load_registry_uncached
from sahamati_core.rules.models import ENGINE_IDS
from sahamati_core.rules.registry import LOCK_NAME, write_lock

REG = load_registry()
ONTO = load_ontology()
BANNED = json.loads((Path(__file__).parents[3] / "packages" / "i18n" / "banned-words.json").read_text(encoding="utf-8"))
PHASE1 = {"P05", "P06", "P07", "P12", "D01", "D03", "T01", "T02", "T05", "T08", "A01", "C03", "C07", "S06"}


def test_phase1_registry_content() -> None:
    assert {r.id for r in REG.enabled()} == PHASE1 | {"AI09"}
    assert {r.id for r in REG.runnable()} == PHASE1  # AI09 is a guard: not a rule run
    assert all(r.phase == 1 for r in REG.enabled())  # every enabled rule ships in phase 1
    assert len(REG.rules) == 86
    assert [r.family for r in REG.rules] == sorted((r.family for r in REG.rules), key=["P", "D", "T", "A", "C", "S", "AI"].index)
    # investigation rules (CLAUDE.md rule 14)
    assert {r.id for r in REG.enabled() if r.investigation} == {"D01", "D03", "T02", "T08", "A01"}
    # runtime stubs read nothing
    for rid in ("C03", "T05", "C07", "S06"):
        assert REG.by_id[rid].engine_rules == []
        assert set(REG.by_id[rid].evidence_sources.required) <= {"runtime", "test_account"}


def test_every_rule_has_the_required_test_cases() -> None:
    for r in REG.enabled():  # disabled catalogue entries have no behaviour to test
        kinds = {t.case for t in r.tests}
        if r.kind == "guard":
            assert "guard" in kinds
        elif set(r.evidence_sources.required) & {"runtime", "test_account"}:
            assert "inconclusive" in kinds
        else:
            assert {"positive", "negative", "inconclusive"} <= kinds, r.id


def test_engine_ids_are_all_claimed() -> None:
    """Every engine finding id is read by some enabled rule, so no finding is left without a status owner."""
    read = {e for r in REG.runnable() for e in r.engine_rules}
    assert {"IC-01", "DM-01", "DM-02", "DM-03", "BM-01", "BM-02", "BM-03", "BM-04"} <= read
    assert read <= ENGINE_IDS


def test_reasons_are_the_documented_codes() -> None:
    allowed = {"policy_unavailable", "data_safety_unavailable", "apk_unavailable", "apk_unparseable",
               "apk_partial_coverage", "runtime_evidence_unavailable", "test_account_unavailable",
               "missing_source_false_pass_prevented"}
    for r in REG.rules:
        assert set(r.inconclusive_reasons) <= allowed, r.id
        for t in r.tests:
            if t.expect.reason:
                assert t.expect.reason in allowed


# ------------------------------------------------------------------ strictness


def _copy_registry(tmp_path: Path) -> Path:
    d = tmp_path / "registry"
    shutil.copytree(registry_dir(), d)
    return d


def _edit(d: Path, fam: str, fn: Any) -> None:
    p = d / f"{fam}.yaml"
    doc = yaml.safe_load(p.read_text(encoding="utf-8"))
    fn(doc["rules"])
    p.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")


def _errors(d: Path) -> str:
    reg, errs = load_registry_uncached(d)
    assert reg is None or errs == [], "expected the registry to be rejected"
    return "\n".join(errs)


def test_copy_of_the_registry_is_valid(tmp_path: Path) -> None:
    reg, errs = load_registry_uncached(_copy_registry(tmp_path))
    assert errs == [] and reg is not None


@pytest.mark.parametrize("name,mutate,needle", [
    ("unknown predicate", lambda rs: rs[0]["conditions"].append({"predicate": "if_rule_is_p06"}), "unknown predicate"),
    ("unknown predicate argument",
     lambda rs: rs[0]["conditions"].append({"predicate": "action_in", "args": {"actions": ["share"], "bogus": 1}}),
     "unknown argument"),
    ("missing predicate argument", lambda rs: rs[0]["conditions"].append({"predicate": "action_in"}), "missing argument"),
    ("ceiling above result_on_match",
     lambda rs: rs[0].update(result_on_match="needs_review", status_ceiling="confirmed_conflict"),
     "status_ceiling confirmed_conflict is above result_on_match"),
    ("no tests", lambda rs: rs[0].update(tests=[]), "without tests"),
    ("no positive case", lambda rs: rs[0].update(tests=[t for t in rs[0]["tests"] if t["case"] != "positive"]),
     "missing a `positive`"),
    ("no inconclusive case", lambda rs: rs[0].update(tests=[t for t in rs[0]["tests"] if t["case"] != "inconclusive"]),
     "missing a `inconclusive`"),
    ("unknown key", lambda rs: rs[0].update(surprise=1), "surprise"),
    ("unknown engine id", lambda rs: rs[0].update(engine_rules=["XX-99"]), "unknown engine rule id"),
    ("unknown category", lambda rs: rs[0].update(categories=["weather"]), "unknown report category"),
    ("duplicate id", lambda rs: rs.append(json.loads(json.dumps(rs[0]))), "duplicate rule id"),
    ("family mismatch", lambda rs: rs[0].update(id="D09"), "does not belong to family"),
    ("reasons not covering sources", lambda rs: rs[0].update(inconclusive_reasons=[]), "inconclusive_reasons is missing"),
    ("requires without a reason",
     lambda rs: rs[0].update(requires=[{"predicate": "sdk_scan_complete"}]), "`reason` is mandatory"),
    ("candidate predicate used as a requirement",
     lambda rs: rs[0].update(requires=[{"predicate": "action_in", "args": {"actions": ["share"]}, "reason": "x"}]),
     "has candidate scope"),
])
def test_loader_rejects(tmp_path: Path, name: str, mutate: Any, needle: str) -> None:
    d = _copy_registry(tmp_path)
    _edit(d, "P", mutate)
    assert needle in _errors(d), name


def test_loader_rejects_investigation_rule_that_can_confirm(tmp_path: Path) -> None:
    d = _copy_registry(tmp_path)
    _edit(d, "D", lambda rs: rs[0].update(result_on_match="confirmed_conflict"))
    assert "investigation rule can only ever be needs_review" in _errors(d)


def test_loader_rejects_missing_family_file(tmp_path: Path) -> None:
    d = _copy_registry(tmp_path)
    (d / "S.yaml").unlink()
    assert "missing registry file S.yaml" in _errors(d)


# ------------------------------------------------------------------ lock (version bump on change)


def test_committed_lock_is_current() -> None:
    assert check_lock(REG) == []


def test_content_change_needs_a_version_bump(tmp_path: Path) -> None:
    d = _copy_registry(tmp_path)
    reg, _ = load_registry_uncached(d)
    assert reg is not None and check_lock(reg) == []
    _edit(d, "P", lambda rs: rs[0].update(severity="low"))
    reg2, errs = load_registry_uncached(d)
    assert reg2 is not None and errs == []
    assert any("content changed but `version` is still 1" in e for e in check_lock(reg2))
    _edit(d, "P", lambda rs: rs[0].update(version=2))
    reg3, _ = load_registry_uncached(d)
    assert reg3 is not None
    assert any("version bumped; run --update-lock" in e for e in check_lock(reg3))
    write_lock(reg3)
    assert check_lock(reg3) == []
    assert (d / LOCK_NAME).is_file()


def test_new_rule_must_be_added_to_the_lock(tmp_path: Path) -> None:
    d = _copy_registry(tmp_path)
    lock = json.loads((d / LOCK_NAME).read_text())
    del lock["rules"]["P12"]
    (d / LOCK_NAME).write_text(json.dumps(lock))
    reg, _ = load_registry_uncached(d)
    assert reg is not None and any("P12: not in" in e for e in check_lock(reg))


# ------------------------------------------------------------------ rules are data


def test_no_code_branches_on_a_rule_id() -> None:
    """Rule logic is data: no registry rule id appears as a string constant in the Python code."""
    ids = {r.id for r in REG.rules}
    offenders: list[str] = []
    for path in package_dir().rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        docstrings = {id(n.body[0].value) for n in ast.walk(tree)
                      if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
                      and n.body and isinstance(n.body[0], ast.Expr) and isinstance(getattr(n.body[0], "value", None), ast.Constant)}
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
                if node.value in ids:
                    offenders.append(f"{path.name}:{node.lineno} {node.value!r}")
    assert not offenders, offenders


# ------------------------------------------------------------------ wording and i18n


def _walk_strings(node: Any, path: str = "") -> list[tuple[str, str]]:
    if isinstance(node, str):
        return [(path, node)]
    if isinstance(node, dict):
        return [x for k, v in node.items() for x in _walk_strings(v, f"{path}.{k}" if path else str(k))]
    if isinstance(node, list):
        return [x for i, v in enumerate(node) for x in _walk_strings(v, f"{path}[{i}]")]
    return []


def banned_hits(text: str) -> list[str]:
    import re

    hits = []
    gap = "[\\s-]+"
    for w in BANNED["en"]:
        pattern = "(?<![A-Za-z0-9_-])" + re.escape(w).replace("\\ ", gap).replace(" ", gap) + "(?![A-Za-z0-9_])"
        if re.search(pattern, text, re.I):
            hits.append(w)
    hits += [w for w in BANNED["hi"] if w in text]
    return hits


def test_registry_yaml_uses_no_banned_wording() -> None:
    """check-wording.mjs scans templates*.yaml; the registry text must meet the same bar (CLAUDE.md rule 4)."""
    bad: list[str] = []
    for p in sorted(registry_dir().glob("*.yaml")):
        for where, s in _walk_strings(yaml.safe_load(p.read_text(encoding="utf-8"))):
            if where.split(".")[-1] in ("dt", "id") or ".claims[" in where:
                continue  # ontology ids in test fixtures (e.g. fraud_prevention) are ids, not wording
            bad += [f"{p.name}:{where}: {h}" for h in banned_hits(s)]
    assert not bad, bad


def test_every_user_facing_template_exists_in_both_languages() -> None:
    for r in REG.rules:
        assert r.name and r.name_hi and r.plain_language and r.plain_language_hi
    for r in REG.runnable():
        if r.investigation:
            assert has_text("indicator", r.id), r.id
    for eid in ("IC-01", "DM-01", "DM-02", "DM-03", "BM-01", "BM-02", "BM-03", "BM-04"):
        assert has_text("card", "finding", eid)
    templates = yaml.safe_load((package_dir() / "engine" / "templates.yaml").read_text(encoding="utf-8"))

    def keys(d: Any, prefix: str = "") -> set[str]:
        if not isinstance(d, dict):
            return {prefix}
        return {k for kk, vv in d.items() for k in keys(vv, f"{prefix}.{kk}" if prefix else kk)}

    assert keys(templates["en"]) == keys(templates["hi"])
    for lang in ("en", "hi"):
        for where, s in _walk_strings(templates[lang]):
            assert not banned_hits(s), (lang, where, s)


def test_report_categories_cover_the_ontology() -> None:
    cats = ONTO.data_types.report_categories
    assert list(cats) == ["location", "contacts", "photos_files", "camera_mic", "messages_calls",
                          "money_payments", "identity", "health", "ads_tracking", "account_profile"]
    assert set(REG.status.group_slugs) == set(cats)
    # every leaf data type resolves to a category, except the two hierarchy roots
    for nid in ONTO.data_types.nodes:
        if nid in ONTO.data_types.roots or nid == "identifiers":
            continue
        assert ONTO.data_types.report_category(nid) in cats, nid
    for rule in REG.rules:
        assert set(rule.categories) <= set(cats)
