"""Builds the public `Report` (the contract) from claims + engine output."""

from __future__ import annotations

from dataclasses import dataclass

from sahamati_core import ENGINE_VERSION, EXTRACTOR_VERSION
from sahamati_core.engine import (
    Engine,
    EngineFinding,
    EngineGap,
    EngineResult,
    render_indicator,
    render_summary,
)
from sahamati_core.engine.templates import benign_explanations
from sahamati_core.ontology import Ontology, load_ontology
from sahamati_core.policy.extractor import text_fragment
from sahamati_core.report_card import (
    ReportFacts,
    assign_groups,
    build_card,
    facts_from_report,
    recipient_root,
)
from sahamati_core.rules import (
    Evaluation,
    Evaluator,
    FindingDecision,
    IndicatorDraft,
    Registry,
    load_registry,
)
from sahamati_core.rules.evaluator import candidate_category
from sahamati_core.schema import (
    Action,
    AppInfo,
    ClaimMatrixRow,
    ClaimTuple,
    ClaimTupleView,
    ConflictClass,
    Coverage,
    CoverageMap,
    DisclosureGap,
    Evidence,
    Finding,
    FindingSide,
    Indicator,
    Polarity,
    Report,
    ReportSummary,
    RuleRun,
    SourceKind,
    StatusCounts,
    Tier,
    Versions,
)

_CLASS_ABBR = {
    ConflictClass.INTERNAL_CONTRADICTION: "ic",
    ConflictClass.DECLARATION_MISMATCH: "dm",
    ConflictClass.BEHAVIOURAL_MISMATCH: "bm",
}
_CLASS_PRIORITY = {
    "internal_contradiction": 0, "declaration_mismatch": 1, "behavioural_mismatch": 2, "disclosure_gap": 3,
}
_SHARE_ACTIONS = {Action.SHARE, Action.SELL}


@dataclass
class ReportInputs:
    report_id: str
    package: str
    title: str
    version_code: int | None
    developer: str | None
    is_demo: bool
    generated_at: str
    coverage: CoverageMap
    claims: list[ClaimTuple]
    engine_result: EngineResult
    vague_claim_ratio: float
    extractor_version: str = EXTRACTOR_VERSION
    sdk_scan: bool = True  # the APK class list was read, so "no SDK found" means something (AI09)
    facts: ReportFacts | None = None  # plain facts for the five answers; derived by the pipeline


def evidence_view(c: ClaimTuple) -> Evidence:
    ev = c.evidence
    captured = ev.captured_at or ""
    if c.source_kind == SourceKind.POLICY:
        return Evidence(quote=ev.text, url=ev.url, char_start=ev.char_start, char_end=ev.char_end,
                        text_fragment=text_fragment(ev.text), captured_at=captured)
    if c.source_kind == SourceKind.DATA_SAFETY:
        return Evidence(label=ev.text, captured_at=captured)
    if c.source_kind == SourceKind.APK_PERMISSION:
        return Evidence(permission=ev.text, captured_at=captured)
    return Evidence(sdk=ev.text, captured_at=captured)


def tuple_view(c: ClaimTuple) -> ClaimTupleView:
    return ClaimTupleView(actor=c.actor, action=c.action, polarity=c.polarity, data_type=c.data_type,
                          condition=c.condition)


def _side(c: ClaimTuple) -> FindingSide:
    return FindingSide(source=c.source_kind.value, tuple=tuple_view(c), evidence=evidence_view(c))  # type: ignore[arg-type]


def finding_view(onto: Ontology, f: EngineFinding, fid: str, lang: str = "en", *,
                 decision: FindingDecision | None = None, user_category: str | None = None) -> Finding:
    deny = f.a if f.a.polarity == Polarity.DENY else f.b
    sdk_name = None
    if f.b.source_kind == SourceKind.APK_SDK:
        sdk_name = next((s.name for s in onto.sdks if s.prefix == f.b.evidence.text), f.b.evidence.text)
    assert decision is not None and user_category is not None
    return Finding(
        id=fid,
        class_=f.cls.value,  # type: ignore[arg-type]
        tier=f.tier.value,  # type: ignore[arg-type]
        confidence=f.confidence,
        rule_id=f.rule_id,
        summary=render_summary(onto, f.rule_id, f.overlap, action=deny.action.value, sdk=sdk_name, lang=lang),
        ontology_path=onto.data_types.ontology_path(f.overlap),
        sides=(_side(f.a), _side(f.b)),
        benign_explanations=benign_explanations(f.rule_id, lang=lang),
        status=decision.status,  # type: ignore[arg-type]
        evidence_strength=decision.strength,  # type: ignore[arg-type]
        limitations=list(decision.limitations),
        user_category=user_category,  # type: ignore[arg-type]
    )


def indicator_view(onto: Ontology, d: IndicatorDraft, iid: str, lang: str = "en") -> Indicator:
    c = d.claim
    sdk = next((s.name for s in onto.sdks if s.prefix == c.evidence.text), c.evidence.text) \
        if c.source_kind == SourceKind.APK_SDK else None
    return Indicator(
        id=iid, rule_id=d.rule.id, status="needs_review", user_category=d.user_category,  # type: ignore[arg-type]
        data_type=c.data_type, ontology_path=onto.data_types.ontology_path(c.data_type),
        summary=render_indicator(onto, d.rule.id, c.data_type, sdk=sdk, lang=lang),
        source=c.source_kind.value,  # type: ignore[arg-type]
        evidence=evidence_view(c))


def gap_view(onto: Ontology, g: EngineGap, gid: str) -> DisclosureGap:
    return DisclosureGap(
        id=gid,
        data_type=g.data_type,
        ontology_path=onto.data_types.ontology_path(g.data_type),
        evidence=evidence_view(g.evidence),
        source=g.evidence.source_kind.value,  # type: ignore[arg-type]
    )


def number_findings(findings: list[EngineFinding]) -> list[tuple[str, EngineFinding]]:
    counters: dict[str, int] = {}
    out: list[tuple[str, EngineFinding]] = []
    for f in findings:
        abbr = _CLASS_ABBR[f.cls]
        counters[abbr] = counters.get(abbr, 0) + 1
        out.append((f"f_{abbr}_{counters[abbr]:02d}", f))
    return out


# ------------------------------------------------------------------ matrix


def _rank(onto: Ontology, claim_dt: str, row: str) -> int | None:
    dt = onto.data_types
    if claim_dt == row:
        return 0
    if dt.subsumes(row, claim_dt):
        return 1  # claim is about a descendant of the row type
    if dt.subsumes(claim_dt, row):
        return 2 + (dt.depth(row) - dt.depth(claim_dt))  # inherited from an ancestor
    return None


def _glyph(c: ClaimTuple) -> str:
    if c.polarity == Polarity.VAGUE:
        return "vague"
    if c.polarity == Polarity.DENY:
        return "denies"
    return "shares" if c.action in _SHARE_ACTIONS else "collects"


_GLYPH_ORDER = {"shares": 0, "collects": 1, "denies": 2, "vague": 3}


def build_matrix(onto: Ontology, claims: list[ClaimTuple], result: EngineResult,
                 apk_coverage: Coverage) -> list[ClaimMatrixRow]:
    dt = onto.data_types
    mentioned = {c.data_type for c in claims if not c.synthetic and c.polarity != Polarity.VAGUE}
    rows = [t for t in mentioned if not any(u != t and dt.subsumes(t, u) for u in mentioned)]

    by_src: dict[str, list[ClaimTuple]] = {"policy": [], "data_safety": [], "apk": []}
    for c in claims:
        k = "apk" if c.source_kind in (SourceKind.APK_PERMISSION, SourceKind.APK_SDK) else c.source_kind.value
        by_src[k].append(c)

    marks: list[tuple[str, str]] = [(f.overlap, f.cls.value) for f in result.public_findings]
    marks += [(g.data_type, "disclosure_gap") for g in result.public_gaps]

    def cell(src: str, row: str) -> str:
        ranked: list[tuple[int, ClaimTuple]] = []
        for c in by_src[src]:
            if c.polarity == Polarity.VAGUE and dt.is_root(c.data_type):
                continue  # an unspecific hedge says nothing about this row
            r = _rank(onto, c.data_type, row)
            if r is None:
                continue
            if r >= 2:
                # an inherited broad claim speaks to this row only for an action another source raises here
                others = [o for s, lst in by_src.items() if s != src for o in lst
                          if o.polarity != Polarity.VAGUE and _rank(onto, o.data_type, row) is not None]
                if not any(o.action == c.action for o in others):
                    continue
            ranked.append((r, c))
        if not ranked:
            return "silent"
        best = min(r for r, _ in ranked)
        glyphs = sorted({_glyph(c) for r, c in ranked if r == best}, key=_GLYPH_ORDER.__getitem__)
        return glyphs[0]

    out: list[ClaimMatrixRow] = []
    for row in rows:
        pol = cell("policy", row)
        ds = cell("data_safety", row)
        if ds == "vague":
            ds = "silent"
        if apk_coverage != Coverage.OK:
            apk = "unknown"
        else:
            apk = "evidence" if any(_rank(onto, c.data_type, row) is not None for c in by_src["apk"]) else "silent"
        cands = []
        for node, cls in marks:
            r = _rank(onto, node, row)
            if r is not None:
                cands.append((0 if r == 0 else 1, _CLASS_PRIORITY[cls], cls))
        conflict = sorted(cands)[0][2] if cands else None
        out.append(ClaimMatrixRow(data_type=row, ontology_path=dt.ontology_path(row), policy=pol,  # type: ignore[arg-type]
                                  data_safety=ds, apk=apk, conflict_class=conflict))  # type: ignore[arg-type]

    def sort_key(r: ClaimMatrixRow) -> tuple[int, int, str]:
        return (0 if r.conflict_class else 1, _CLASS_PRIORITY.get(r.conflict_class or "", 9), r.data_type)

    return sorted(out, key=sort_key)


def agree_count(rows: list[ClaimMatrixRow]) -> int:
    n = 0
    for r in rows:
        if r.conflict_class:
            continue
        if r.policy in ("collects", "shares") and r.data_safety in ("collects", "shares"):
            n += 1
        elif r.policy == "denies" and r.data_safety == "denies" and r.apk != "evidence":
            n += 1
    return n


# ------------------------------------------------------------------ report


@dataclass
class BuiltReport:
    report: Report
    facts: ReportFacts
    evaluation: Evaluation


def _count_statuses(runs: list[RuleRun]) -> StatusCounts:
    counts = {k: 0 for k in ("confirmed_conflict", "potential_conflict", "needs_review", "inconclusive",
                             "no_issue_detected")}
    for r in runs:
        counts[r.status] += 1
    return StatusCounts(**counts)


def build_report_full(inp: ReportInputs, *, ontology: Ontology | None = None, lang: str = "en",
                      registry: Registry | None = None) -> BuiltReport:
    onto = ontology or load_ontology()
    reg = registry or load_registry()
    res = inp.engine_result
    ev = Evaluator(reg, onto)
    coverage = {"policy": inp.coverage.policy.value, "data_safety": inp.coverage.data_safety.value,
                "apk": inp.coverage.apk.value}
    evaluation = ev.evaluate(ev.context(coverage=coverage, claims=inp.claims, result=res, sdk_scan=inp.sdk_scan))

    index_of = {id(f): i for i, f in enumerate(res.findings)}
    public = number_findings(res.public_findings)
    findings: list[Finding] = []
    finding_rules: list[list[str]] = []
    finding_roots: list[str] = []
    for fid, f in public:
        idx = index_of[id(f)]
        dec = evaluation.findings[idx]
        cand = _candidate_of(f, idx)
        cat = candidate_category(onto, reg.status, cand)
        findings.append(finding_view(onto, f, fid, lang, decision=dec, user_category=cat))
        finding_rules.append(dec.rule_ids)
        finding_roots.append(recipient_root(onto, f.a.actor))
    gaps = [gap_view(onto, g, f"g_{i + 1:02d}") for i, g in enumerate(res.public_gaps)]

    counters: dict[str, int] = {}
    indicators: list[Indicator] = []
    roots: list[str] = []
    for d in evaluation.indicators:
        n = counters[d.rule.id] = counters.get(d.rule.id, 0) + 1
        iid = f"i_{d.rule.id.lower()}" + ("" if n == 1 else f"_{n}")
        indicators.append(indicator_view(onto, d, iid, lang))
        roots.append(recipient_root(onto, d.claim.actor))

    plan = assign_groups(onto=onto, reg=reg, findings=findings, finding_rules=finding_rules,
                         indicators=indicators, indicator_roots=roots)
    for i, f in enumerate(findings):
        f.group_id = plan.group_of_finding[i]
        if i in plan.related:
            f.related_finding_ids = [findings[j].id for j in plan.related[i]]
    for j, ind in enumerate(indicators):
        ind.group_id = plan.group_of_indicator.get(j)

    names = {"hi": "name_hi"}
    rule_runs = [
        RuleRun(rule_id=r.rule.id, name=getattr(r.rule, names.get(lang, "name")), family=r.rule.family,
                phase=r.rule.phase, status=r.status, reason=r.reason)  # type: ignore[arg-type]
        for r in evaluation.runs
    ]
    matrix = build_matrix(onto, inp.claims, res, inp.coverage.apk)
    summary = ReportSummary(
        strong=sum(1 for f in findings if f.tier == Tier.STRONG.value),
        indicative=sum(1 for f in findings if f.tier == Tier.INDICATIVE.value),
        not_mentioned=len(gaps),
        agree_types=agree_count(matrix),
        vague_claim_ratio=inp.vague_claim_ratio,
    )
    facts = inp.facts or ReportFacts()
    card = build_card(onto=onto, reg=reg, findings=findings, indicators=indicators, rule_runs=rule_runs,
                      coverage=inp.coverage, facts=facts, checked_at=inp.generated_at, lang=lang)
    report = Report(
        report_id=inp.report_id,
        app=AppInfo(package=inp.package, version_code=inp.version_code, title=inp.title,
                    developer=inp.developer, is_demo=inp.is_demo),
        generated_at=inp.generated_at,
        coverage=inp.coverage,
        summary=summary,
        findings=findings,
        disclosure_gaps=gaps,
        matrix=matrix,
        indicators=indicators,
        rule_runs=rule_runs,
        status_counts=_count_statuses(rule_runs),
        card=card,
        versions=Versions(engine=ENGINE_VERSION, ontology=onto.version, extractor=inp.extractor_version),
    )
    return BuiltReport(report=report, facts=facts, evaluation=evaluation)


def build_report(inp: ReportInputs, *, ontology: Ontology | None = None, lang: str = "en",
                 registry: Registry | None = None) -> Report:
    return build_report_full(inp, ontology=ontology, lang=lang, registry=registry).report


def _candidate_of(f: EngineFinding, idx: int):  # type: ignore[no-untyped-def]
    from sahamati_core.rules.context import Candidate

    return Candidate("finding", f.rule_id, finding=f, index=idx)


def suppressed_finding_views(onto: Ontology, result: EngineResult, lang: str = "en", *,
                             registry: Registry | None = None) -> list[Finding]:
    """Below-threshold findings; only ever returned to the developer in self-check (PLAN D4).

    They carry the lowest status (needs_review) and the limitation `below_class_threshold`; no rule
    owns them and they join no group.
    """
    reg = registry or load_registry()
    out: list[Finding] = []
    sup = [(i, f) for i, f in enumerate(result.findings) if f.suppressed]
    for n, (idx, f) in enumerate(sup):
        cand = _candidate_of(f, idx)
        dec = FindingDecision("needs_review", cand.strength(reg.status), ["below_class_threshold"], [])
        out.append(finding_view(onto, f, f"s_{_CLASS_ABBR[f.cls]}_{n + 1:02d}", lang, decision=dec,
                                user_category=candidate_category(onto, reg.status, cand)))
    return out


def _finding_fits(conditions: list, f: Finding) -> bool:  # type: ignore[type-arg]
    """Best-effort re-check of a rule's `action_in` condition on a published finding (its other
    conditions need engine objects and are assumed to hold; hide_findings only ever lowers a status)."""
    deny = next((s for s in f.sides if s.tuple.polarity == Polarity.DENY), f.sides[0])
    return all(deny.tuple.action.value in c.args["actions"] for c in conditions if c.predicate == "action_in")


def hide_findings(report: Report, hidden: set[str], *, facts: ReportFacts | None = None,
                  ontology: Ontology | None = None, registry: Registry | None = None) -> Report:
    """Remove findings under review (PLAN.md §8) and everything derived from them.

    The summary tier counts, the card, `related_finding_ids` and the rule runs are recomputed. A rule
    run is only ever lowered (never raised) to the best status of the findings that remain for its
    engine rules, so hiding a finding can not make another rule look worse.
    """
    if not hidden:
        return report
    onto = ontology or load_ontology()
    reg = registry or load_registry()
    keep = [f.model_copy(deep=True) for f in report.findings if f.id not in hidden]
    for f in keep:
        if f.related_finding_ids:
            rel = [x for x in f.related_finding_ids if x not in hidden]
            f.related_finding_ids = rel or None
    runs: list[RuleRun] = []
    for r in report.rule_runs:
        rule = reg.by_id.get(r.rule_id)
        if rule is not None and not rule.investigation and r.status in ("confirmed_conflict", "potential_conflict",
                                                                         "needs_review"):
            rank = {"needs_review": 1, "potential_conflict": 2, "confirmed_conflict": 3}
            left = [rank[f.status] for f in keep
                    if f.rule_id in rule.engine_rules and _finding_fits(rule.conditions, f)]
            top = max(left, default=0)
            if top < rank[r.status]:
                new = {0: "no_issue_detected", 1: "needs_review", 2: "potential_conflict", 3: "confirmed_conflict"}[top]
                r = r.model_copy(update={"status": new})
        runs.append(r)
    summary = report.summary.model_copy(update={
        "strong": sum(1 for f in keep if f.tier == Tier.STRONG.value),
        "indicative": sum(1 for f in keep if f.tier == Tier.INDICATIVE.value)})
    card = build_card(onto=onto, reg=reg, findings=keep, indicators=report.indicators, rule_runs=runs,
                      coverage=report.coverage, facts=facts or facts_from_report(report, onto),
                      checked_at=report.card.checked_at)
    return report.model_copy(update={"findings": keep, "rule_runs": runs, "summary": summary,
                                     "status_counts": _count_statuses(runs), "card": card})


def relocalise(report: Report, lang: str, ontology: Ontology | None = None, *,
               facts: ReportFacts | None = None, registry: Registry | None = None) -> Report:
    """Re-render every user-facing string in another language (?hl=hi); structure is untouched."""
    if lang == "en":
        return report
    onto = ontology or load_ontology()
    reg = registry or load_registry()
    new_findings = []
    for f in report.findings:
        deny = next((s for s in f.sides if s.tuple.polarity == Polarity.DENY), f.sides[0])
        sdk = f.sides[1].evidence.sdk
        sdk_name = next((s.name for s in onto.sdks if s.prefix == sdk), sdk) if sdk else None
        new_findings.append(f.model_copy(update={
            "summary": render_summary(onto, f.rule_id, f.ontology_path[-1], action=deny.tuple.action.value,
                                      sdk=sdk_name, lang=lang),
            "benign_explanations": benign_explanations(f.rule_id, lang=lang),
        }))
    new_inds = []
    for i in report.indicators:
        sdk = next((s.name for s in onto.sdks if s.prefix == i.evidence.sdk), i.evidence.sdk) if i.evidence.sdk else None
        new_inds.append(i.model_copy(update={
            "summary": render_indicator(onto, i.rule_id, i.data_type, sdk=sdk, lang=lang)}))
    runs = [r.model_copy(update={"name": reg.by_id[r.rule_id].name_hi}) if r.rule_id in reg.by_id else r
            for r in report.rule_runs]
    f_facts = facts or facts_from_report(report, onto)
    card = build_card(onto=onto, reg=reg, findings=new_findings, indicators=new_inds, rule_runs=runs,
                      coverage=report.coverage, facts=f_facts, checked_at=report.card.checked_at, lang=lang)
    return report.model_copy(update={"findings": new_findings, "indicators": new_inds, "rule_runs": runs,
                                     "card": card})


__all__ = [
    "BuiltReport", "Engine", "ReportInputs", "agree_count", "build_matrix", "build_report", "build_report_full",
    "evidence_view", "finding_view", "gap_view", "hide_findings", "indicator_view", "relocalise", "suppressed_finding_views",
    "tuple_view",
]
