"""The report card, grouping and plain facts (PLAN.md §4.9, CLAUDE.md rules 3, 13-15).

* `build_card` turns findings, indicators and rule runs into ten fixed categories and five answers.
  Red appears only for a confirmed_conflict. Grey means "could not check" or "not checked in this
  version". Green means every enabled rule for the category ran with usable sources and found
  nothing; the wording is "No issue found in what we could check", never "safe" or "compliant".
  There is no overall colour, score or grade.
* `assign_groups` implements dedup (AI11): findings and indicators on the same
  (user_category, recipient root) share a `group_id`; findings list each other in `related_finding_ids`.
* `derive_facts` reads the few plain facts the five answers need.

Everything here is a function of the (contract) report parts plus `ReportFacts`, so the same code
re-renders the card in another language (`relocalise`) without re-running the engine.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict

from sahamati_core.engine.templates import has_text, inline_label, join_labels, text
from sahamati_core.ontology import Ontology
from sahamati_core.rules.models import LADDER
from sahamati_core.rules.registry import Registry
from sahamati_core.schema import (
    Action,
    CardAnswer,
    CardCategory,
    ClaimTuple,
    CoverageMap,
    Finding,
    Indicator,
    Polarity,
    ReportCard,
    RuleRun,
    SourceKind,
)

_FACTS_PATH = Path(__file__).with_name("engine") / "facts.yaml"
COLOR_OF = {
    "confirmed_conflict": "red", "potential_conflict": "orange", "needs_review": "yellow",
    "inconclusive": "grey", "no_issue_detected": "green",
}
_SHARE = {"share", "sell"}


class ReportFacts(BaseModel):
    """Plain facts behind the five answers. Persisted with the report so another language can be rendered later."""

    model_config = ConfigDict(extra="forbid")

    location_access: Literal["precise", "approximate", "general", "none", "unknown"] = "unknown"
    ds_known: bool = False
    ds_shared: list[str] = []  # data-type ids the declaration lists as shared (most specific, in order)
    ds_no_data_shared: bool = False
    ds_ad_purpose: bool = False
    ad_sdks: list[str] = []  # names of advertising SDKs found in the APK
    policy_known: bool = False
    deletion_policy: bool = False
    deletion_ds: bool = False
    grievance_policy: bool = False


@lru_cache(maxsize=1)
def _facts_cfg() -> dict[str, Any]:
    with _FACTS_PATH.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)  # type: ignore[no-any-return]


def derive_facts(*, onto: Ontology, claims: list[ClaimTuple], coverage: CoverageMap, policy_text: str | None,
                 ds: dict[str, Any] | None, sdk_scan: bool = True) -> ReportFacts:
    cfg = _facts_cfg()
    f = ReportFacts()
    dt = onto.data_types
    # location access (needs a readable APK)
    if coverage.apk.value == "ok":
        best = "none"
        order = {"none": 0, "general": 1, "approximate": 2, "precise": 3}
        for c in claims:
            if c.source_kind != SourceKind.APK_PERMISSION or not dt.subsumes("location", c.data_type):
                continue
            lvl = {"precise_location": "precise", "approximate_location": "approximate"}.get(c.data_type, "general")
            if order[lvl] > order[best]:
                best = lvl
        f.location_access = best  # type: ignore[assignment]
    # declaration
    if coverage.data_safety.value == "ok":
        f.ds_known = True
        seen: list[str] = []
        for c in claims:
            if (c.source_kind == SourceKind.DATA_SAFETY and c.polarity == Polarity.AFFIRM and not c.synthetic
                    and c.action in (Action.SHARE, Action.SELL) and c.data_type not in seen):
                seen.append(c.data_type)
        f.ds_shared = seen
        f.ds_no_data_shared = bool(ds and ds.get("no_data_shared") is True)
        ad_ids = set(cfg.get("advertising_purposes") or [])
        f.ds_ad_purpose = any(
            c.source_kind == SourceKind.DATA_SAFETY and c.polarity == Polarity.AFFIRM and ad_ids & set(c.purposes)
            for c in claims)
        f.deletion_ds = bool(ds and (ds.get("security_practices") or {}).get("deletion_request") is True)
    # advertising SDKs
    if coverage.apk.value == "ok" and sdk_scan:
        names: list[str] = []
        for c in claims:
            if c.source_kind != SourceKind.APK_SDK:
                continue
            e = next((s for s in onto.sdks if s.prefix == c.evidence.text), None)
            if e and onto.actors.subsumes("ad_network", e.actor) and e.name not in names:
                names.append(e.name)
        f.ad_sdks = names
    # policy text
    if coverage.policy.value == "ok" and policy_text:
        f.policy_known = True
        low = policy_text.lower()
        f.deletion_policy = any(re.search(p, low) for p in cfg["deletion"])
        f.grievance_policy = any(re.search(p, low) for p in cfg["grievance"])
    return f


def facts_from_report(report: Any, onto: Ontology) -> ReportFacts:
    """Best effort when the stored facts are not available (e.g. a fixture): what the report itself shows."""
    f = ReportFacts()
    cov = report.coverage
    if cov.apk.value == "ok":
        best = "none"
        order = {"none": 0, "general": 1, "approximate": 2, "precise": 3}
        for i in report.indicators:
            if i.source == "apk_permission" and onto.data_types.subsumes("location", i.data_type):
                lvl = {"precise_location": "precise", "approximate_location": "approximate"}.get(i.data_type, "general")
                if order[lvl] > order[best]:
                    best = lvl
        f.location_access = best  # type: ignore[assignment]
    if cov.data_safety.value == "ok":
        f.ds_known = True
        f.ds_shared = [r.data_type for r in report.matrix if r.data_safety == "shares"]
    f.policy_known = cov.policy.value == "ok"
    return f


# ------------------------------------------------------------------ grouping (AI11)


def recipient_root(onto: Ontology, actor: str) -> str:
    return onto.actors.root_of(actor) if actor in onto.actors else actor


@dataclass
class GroupPlan:
    group_of_finding: dict[int, str]  # index in the findings list -> group id
    related: dict[int, list[int]]  # index -> indexes of the other findings in the group
    group_of_indicator: dict[int, str]  # index in the indicators list -> group id (only when a finding shares it)


def assign_groups(*, onto: Ontology, reg: Registry, findings: list[Finding], finding_rules: list[list[str]],
                  indicators: list[Indicator], indicator_roots: list[str]) -> GroupPlan:
    """`finding_rules[i]` = registry rule ids behind finding i (for the parent order)."""
    slugs = reg.status.group_slugs
    order = reg.status.group_parent_order

    def gid(cat: str, root: str, default_root: str) -> str:
        base = f"g_{slugs[cat]}"
        return base if root == default_root else f"{base}_{root}"

    default_root = onto.actors.roots[0]
    keys: dict[int, tuple[str, str]] = {}
    for i, f in enumerate(findings):
        # the recipient of a finding is the recipient named on its sides (the third party if one is named)
        roots = [recipient_root(onto, s.tuple.actor) for s in f.sides]
        keys[i] = (f.user_category, roots[0])
    plan = GroupPlan({}, {}, {})
    by_key: dict[tuple[str, str], list[int]] = {}
    for i, k in keys.items():
        by_key.setdefault(k, []).append(i)
        plan.group_of_finding[i] = gid(k[0], k[1], default_root)

    def prio(i: int) -> tuple[int, int]:
        ranks = [order.index(r) for r in finding_rules[i] if r in order]
        return (min(ranks) if ranks else len(order), i)

    for members in by_key.values():
        if len(members) > 1:
            for i in members:
                plan.related[i] = sorted((j for j in members if j != i), key=prio)
    for j, ind in enumerate(indicators):
        key = (ind.user_category, indicator_roots[j])
        if key in by_key:
            plan.group_of_indicator[j] = gid(key[0], key[1], default_root)
    return plan


# ------------------------------------------------------------------ the card


def _deny_aff(f: Finding) -> tuple[Any, Any]:
    deny = next((s for s in f.sides if s.tuple.polarity.value == "deny"), f.sides[0])
    aff = f.sides[1] if deny is f.sides[0] else f.sides[0]
    return deny, aff


def _is_are(label: str) -> str:
    last = label.split()[-1].lower() if label else ""
    return "are" if last.endswith("s") and not last.endswith("ss") else "is"


def finding_note(onto: Ontology, f: Finding, lang: str) -> str:
    deny, aff = _deny_aff(f)
    dl = inline_label(onto, deny.tuple.data_type, lang)
    al = inline_label(onto, aff.tuple.data_type, lang)
    past = text(lang, "action_past", deny.tuple.action.value)
    apast = text(lang, "action_past", aff.tuple.action.value)
    sdk = None
    for s in f.sides:
        if s.evidence.sdk:
            sdk = next((e.name for e in onto.sdks if e.prefix == s.evidence.sdk), s.evidence.sdk)
    return text(lang, "card", "finding", f.rule_id).format(
        label=inline_label(onto, f.ontology_path[-1], lang), deny_label=dl, aff_label=al,
        deny_is_are=_is_are(dl), aff_is_are=_is_are(al), deny_action_past=past, aff_action_past=apast,
        sdk=sdk or "")


def _rank(status: str) -> int:
    return LADDER.get(status, 0)


def build_card(*, onto: Ontology, reg: Registry, findings: list[Finding], indicators: list[Indicator],
               rule_runs: list[RuleRun], coverage: CoverageMap, facts: ReportFacts, checked_at: str,
               lang: str = "en") -> ReportCard:
    from sahamati_core.engine.templates import render_indicator  # local: avoids a cycle at import time

    runs = {r.rule_id: r for r in rule_runs}
    cats = list(onto.data_types.report_categories)
    cov = {"policy": coverage.policy.value, "data_safety": coverage.data_safety.value, "apk": coverage.apk.value}
    out: list[CardCategory] = []
    for cat in cats:
        cf = sorted((f for f in findings if f.user_category == cat),
                    key=lambda f: (-_rank(f.status), -f.confidence))
        ci = [i for i in indicators if i.user_category == cat]
        covering = [r for r in reg.runnable() if cat in r.categories and r.id in runs]
        generic = [r for r in reg.runnable() if r.applies_to_all and r.id in runs]
        if any(f.status == "confirmed_conflict" for f in cf):
            status = "confirmed_conflict"
        elif any(f.status == "potential_conflict" for f in cf):
            status = "potential_conflict"
        elif cf or ci:
            status = "needs_review"
        elif any(runs[r.id].status == "inconclusive" for r in covering + generic) or not covering:
            status = "inconclusive"
        else:
            needed = {s for r in covering + generic
                      for s in list(r.evidence_sources.required) + list(r.evidence_sources.any_of)}
            if any(s in cov and cov[s] != "ok" for s in needed):
                status = "inconclusive"
            else:
                status = "no_issue_detected"
        if cf:
            note = finding_note(onto, cf[0], lang)
        elif ci:
            ind = ci[0]
            sdk = next((e.name for e in onto.sdks if e.prefix == ind.evidence.sdk), ind.evidence.sdk) if ind.evidence.sdk else None
            note = render_indicator(onto, ind.rule_id, ind.data_type, sdk=sdk, lang=lang)
        elif status == "no_issue_detected":
            note = text(lang, "card", "no_issue")
        elif not covering:
            note = text(lang, "card", "not_checked")
        else:
            bad = next((runs[r.id] for r in covering + generic if runs[r.id].status == "inconclusive"), None)
            if bad is not None and has_text("card", "inconclusive", bad.rule_id):
                note = text(lang, "card", "inconclusive", bad.rule_id)
            elif bad is not None and bad.reason and has_text("card", "reason", bad.reason):
                note = text(lang, "card", "reason", bad.reason)
            else:
                src = next((s for s in ("policy", "data_safety", "apk") if cov[s] != "ok"), "policy")
                note = text(lang, "card", "reason", {"policy": "policy_unavailable", "data_safety": "data_safety_unavailable",
                                                     "apk": "apk_unavailable"}[src])
        out.append(CardCategory(
            id=cat, color=COLOR_OF[status], status=status, note=note,  # type: ignore[arg-type]
            finding_ids=[f.id for f in cf], indicator_ids=[i.id for i in ci]))
    return ReportCard(categories=out, answers=build_answers(onto=onto, findings=findings, facts=facts, lang=lang),
                      checked_at=checked_at)


def build_answers(*, onto: Ontology, findings: list[Finding], facts: ReportFacts, lang: str) -> list[CardAnswer]:
    def t(*p: str, **kw: str) -> str:
        return text(lang, "answers", *p).format(**kw)

    # location
    loc_key = {"precise": "precise", "approximate": "approximate", "general": "general", "none": "none",
               "unknown": "unknown"}[facts.location_access]
    loc_ids = [f.id for f in findings if f.user_category == "location"]
    # sharing
    if not facts.ds_known:
        share_text = t("sharing", "unknown")
    elif facts.ds_shared:
        labels = [inline_label(onto, d, lang) for d in facts.ds_shared]
        if len(labels) > 3:
            labels = labels[:3] + [text(lang, "answers", "and_more").format(n=len(facts.ds_shared) - 3)]
            shown = ", ".join(labels[:3]) + " " + labels[3]
        else:
            shown = join_labels(labels, lang)
        is_are = _is_are(labels[0]) if len(labels) == 1 else "are"
        share_text = t("sharing", "shared", labels=shown, is_are=is_are)
    elif facts.ds_no_data_shared:
        share_text = t("sharing", "no_data_shared")
    else:
        share_text = t("sharing", "none_declared")
    share_ids = [f.id for f in findings
                 if any(s.tuple.action.value in _SHARE for s in f.sides)]
    # ads
    sdks = ", ".join(facts.ad_sdks)
    if facts.ds_known and facts.ds_ad_purpose:
        ads_text = t("ads", "ds_purpose_sdk", sdks=sdks) if sdks else t("ads", "ds_purpose")
    elif sdks:
        ads_text = t("ads", "sdk", sdks=sdks)
    elif facts.ds_known:
        ads_text = t("ads", "none")
    else:
        ads_text = t("ads", "unknown")
    ads_ids = [f.id for f in findings if f.user_category == "ads_tracking"]
    # deletion / grievance
    if facts.deletion_policy:
        del_text = t("deletion", "policy")
    elif facts.deletion_ds:
        del_text = t("deletion", "ds")
    elif facts.policy_known:
        del_text = t("deletion", "none")
    else:
        del_text = t("deletion", "unknown")
    if not facts.policy_known:
        gr_text = t("grievance", "unknown")
    elif facts.grievance_policy:
        gr_text = t("grievance", "found")
    else:
        gr_text = t("grievance", "none")
    return [
        CardAnswer(id="location", text=t("location", loc_key), finding_ids=loc_ids),
        CardAnswer(id="sharing", text=share_text, finding_ids=share_ids),
        CardAnswer(id="ads", text=ads_text, finding_ids=ads_ids),
        CardAnswer(id="deletion", text=del_text, finding_ids=[]),
        CardAnswer(id="grievance", text=gr_text, finding_ids=[]),
    ]


__all__ = [
    "COLOR_OF", "GroupPlan", "ReportFacts", "assign_groups", "build_answers", "build_card", "derive_facts",
    "facts_from_report", "finding_note", "recipient_root",
]
