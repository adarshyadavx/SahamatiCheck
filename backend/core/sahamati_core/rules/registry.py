"""Rule registry loader (PLAN.md §4.9, CLAUDE.md rules 12-14).

    backend/core/rules/registry/{P,D,T,A,C,S,AI}.yaml   the rules (data, never code)
    backend/core/rules/registry/reasons.yaml            coverage state -> inconclusive reason codes
    backend/core/rules/registry/registry.lock.json      version + content hash per rule

The loader rejects: unknown keys, unknown predicates or predicate arguments, a status ceiling above
`result_on_match`, a rule without tests (or without the required positive/negative/inconclusive cases),
unknown engine ids or report categories, and an `inconclusive_reasons` list that does not cover every
reason the rule can emit. `check_lock` fails when a rule's content changed without a `version` bump.

    python -m sahamati_core.rules            lint (CI)
    python -m sahamati_core.rules --update-lock
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from sahamati_core import registry_dir
from sahamati_core.ontology import Ontology, load_ontology

from .models import GUARD_REASON, STATIC_UNAVAILABLE, Rule, RuleInfo, StatusConfig

FAMILY_FILES = ["P", "D", "T", "A", "C", "S", "AI"]
LOCK_NAME = "registry.lock.json"
_THRESHOLDS = Path(__file__).resolve().parent.parent / "engine" / "thresholds.yaml"


class RegistryError(ValueError):
    pass


@dataclass
class Registry:
    rules: list[Rule]
    reasons: dict[str, dict[str, str]]  # source -> coverage state -> reason
    status: StatusConfig
    directory: Path
    by_id: dict[str, Rule] = field(init=False)

    def __post_init__(self) -> None:
        self.by_id = {r.id: r for r in self.rules}

    def enabled(self) -> list[Rule]:
        return [r for r in self.rules if r.enabled]

    def runnable(self) -> list[Rule]:
        """Enabled detectors: the rules that appear in `rule_runs`."""
        return [r for r in self.rules if r.enabled and r.kind == "detector"]

    def reason_for(self, source: str, state: str) -> str:
        table = self.reasons.get(source, {})
        return table.get(state) or table.get("not_attempted") or f"{source}_unavailable"

    def info(self, family: str | None = None) -> list[RuleInfo]:
        return [
            RuleInfo(
                id=r.id, version=r.version, name=r.name, name_hi=r.name_hi, family=r.family, phase=r.phase,
                enabled=r.enabled, kind=r.kind, investigation=r.investigation, severity=r.severity,
                score_track=r.score_track, required_sources=list(r.evidence_sources.required),
                any_of_sources=list(r.evidence_sources.any_of), engine_rules=list(r.engine_rules),
                result_on_match=r.result_on_match, status_ceiling=r.status_ceiling, categories=list(r.categories),
                inconclusive_reasons=list(r.inconclusive_reasons), plain_language=r.plain_language,
                plain_language_hi=r.plain_language_hi)
            for r in self.rules if family is None or r.family == family
        ]


def _read(path: Path) -> Any:
    if not path.is_file():
        raise RegistryError(f"missing registry file: {path}")
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_status_config(path: Path | None = None) -> StatusConfig:
    raw = _read(path or _THRESHOLDS)
    try:
        return StatusConfig.model_validate(raw.get("status") or {})
    except ValidationError as exc:
        raise RegistryError(f"thresholds.yaml `status`: {exc}") from exc


def expected_reasons(rule: Rule, reasons: dict[str, dict[str, str]]) -> set[str]:
    """Every inconclusive reason the rule can emit, from its sources and `requires`."""
    out: set[str] = set()
    for src in list(rule.evidence_sources.required) + list(rule.evidence_sources.any_of):
        table = reasons.get(src, {})
        out |= {v for k, v in table.items()}
        if not table:
            out.add(f"{src}_unavailable")
    out |= {c.reason for c in rule.requires if c.reason}
    return out


def load_registry_uncached(directory: Path | None = None, ontology: Ontology | None = None
                           ) -> tuple[Registry | None, list[str]]:
    d = Path(directory) if directory else registry_dir()
    onto = ontology or load_ontology()
    errors: list[str] = []
    reasons_raw = _read(d / "reasons.yaml")
    reasons: dict[str, dict[str, str]] = {s: dict(m) for s, m in (reasons_raw.get("sources") or {}).items()}
    rules: list[Rule] = []
    for fam in FAMILY_FILES:
        path = d / f"{fam}.yaml"
        if not path.is_file():
            errors.append(f"missing registry file {path.name}")
            continue
        raw = _read(path)
        if raw.get("family") != fam:
            errors.append(f"{path.name}: top-level `family` must be {fam!r}")
        for i, item in enumerate(raw.get("rules") or []):
            try:
                r = Rule.model_validate(item)
            except ValidationError as exc:
                rid = item.get("id", f"#{i}") if isinstance(item, dict) else f"#{i}"
                errors.append(f"{path.name}: rule {rid}: " + "; ".join(
                    f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()))
                continue
            if r.family != fam:
                errors.append(f"{path.name}: rule {r.id} has family {r.family}")
            rules.append(r)
    seen: set[str] = set()
    cats = set(onto.data_types.report_categories)
    for r in rules:
        if r.id in seen:
            errors.append(f"duplicate rule id {r.id}")
        seen.add(r.id)
        for c in r.categories:
            if c not in cats:
                errors.append(f"{r.id}: unknown report category {c!r}")
        if r.user_category != "derived" and r.user_category not in cats:
            errors.append(f"{r.id}: unknown user_category {r.user_category!r}")
        if r.enabled and r.kind == "detector":
            need = expected_reasons(r, reasons)
            missing = need - set(r.inconclusive_reasons)
            if missing:
                errors.append(f"{r.id}: inconclusive_reasons is missing {sorted(missing)}")
            extra = set(r.inconclusive_reasons) - need - {GUARD_REASON}
            if extra:
                errors.append(f"{r.id}: inconclusive_reasons lists reasons it can never emit: {sorted(extra)}")
    try:
        status = load_status_config()
    except RegistryError as exc:
        return None, errors + [str(exc)]
    for c in status.group_parent_order:
        if c not in seen:
            errors.append(f"status.group_parent_order lists unknown rule {c!r}")
    if set(status.group_slugs) != cats:
        errors.append(f"status.group_slugs must cover exactly the report categories {sorted(cats)}")
    if status.default_user_category not in cats:
        errors.append(f"status.default_user_category {status.default_user_category!r} is not a report category")
    if errors:
        return None, errors
    return Registry(rules=rules, reasons=reasons, status=status, directory=d), []


@lru_cache(maxsize=4)
def _load_cached(directory: str) -> Registry:
    reg, errors = load_registry_uncached(Path(directory))
    if errors or reg is None:
        raise RegistryError("rule registry invalid:\n  " + "\n  ".join(errors))
    return reg


def load_registry(directory: Path | str | None = None) -> Registry:
    """The validated registry (cached). Raises RegistryError when invalid."""
    return _load_cached(str(Path(directory) if directory else registry_dir()))


# ------------------------------------------------------------------ lock (version bump on change)


def rule_digest(rule: Rule) -> str:
    body = rule.model_dump(mode="json", exclude={"version"})
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def current_lock(reg: Registry) -> dict[str, Any]:
    return {"rules": {r.id: {"version": r.version, "sha256": rule_digest(r)} for r in reg.rules}}


def check_lock(reg: Registry) -> list[str]:
    path = reg.directory / LOCK_NAME
    if not path.is_file():
        return [f"{LOCK_NAME} is missing; run `python -m sahamati_core.rules --update-lock`"]
    locked = json.loads(path.read_text(encoding="utf-8")).get("rules", {})
    errs: list[str] = []
    for r in reg.rules:
        entry = locked.get(r.id)
        if entry is None:
            errs.append(f"{r.id}: not in {LOCK_NAME}; run --update-lock")
            continue
        changed = entry["sha256"] != rule_digest(r)
        if r.version < entry["version"]:
            errs.append(f"{r.id}: version went backwards ({entry['version']} -> {r.version})")
        elif changed and r.version == entry["version"]:
            errs.append(f"{r.id}: content changed but `version` is still {r.version}; bump it, then --update-lock")
        elif not changed and r.version != entry["version"]:
            errs.append(f"{r.id}: version bumped without a content change")
        elif changed:
            errs.append(f"{r.id}: version bumped; run --update-lock to record it")
    for rid in locked:
        if rid not in reg.by_id:
            errs.append(f"{rid}: removed from the registry but still in {LOCK_NAME}; run --update-lock")
    return errs


def write_lock(reg: Registry) -> Path:
    path = reg.directory / LOCK_NAME
    path.write_text(json.dumps(current_lock(reg), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


__all__ = [
    "FAMILY_FILES", "Registry", "RegistryError", "STATIC_UNAVAILABLE", "check_lock", "current_lock",
    "load_registry", "load_registry_uncached", "load_status_config", "rule_digest", "write_lock",
]
