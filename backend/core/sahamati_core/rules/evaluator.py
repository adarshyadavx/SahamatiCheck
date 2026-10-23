"""Rule evaluator (PLAN.md §4.9, CLAUDE.md rules 12-14).

Input : the engine's output (findings, gaps), the claims, and per-source coverage.
Output: one RuleRun per enabled rule, a status/strength/limitations decision per engine finding,
        and the indicators of the investigation rules.

The registry is data. This module has no rule ids in it: every rule is run by the same code from
its `evidence_sources`, `requires`, `engine_rules`, `conditions`, `exclude_if` and `status_ceiling`.

Missing evidence never passes (AI09):
  1. pre-check per rule: a required source that is not `ok`, no usable `any_of` source, or a failed
     `requires` predicate makes the run `inconclusive` with a reason code;
  2. post-evaluation guard: any `no_issue_detected` that violates (1) is rewritten to `inconclusive`
     / `missing_source_false_pass_prevented` and recorded in `Evaluation.guard_events`. The guard
     must never fire in normal operation; CI fails if it does.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sahamati_core.engine import EngineResult
from sahamati_core.ontology import Ontology, load_ontology
from sahamati_core.schema import ClaimTuple, Polarity

from . import predicates
from .context import APK_KINDS, Candidate, EvalContext
from .models import GUARD_REASON, LADDER, LADDER_BY_RANK, Rule, StatusConfig
from .registry import Registry, load_registry

_ENGINE_KIND = {"GAP": "gap", "APK-PERM": "apk_claim", "APK-SDK": "apk_claim"}


@dataclass
class Decision:
    """How one rule judged one candidate."""

    status: str  # a ladder status
    strength: str
    limitations: list[str] = field(default_factory=list)


@dataclass
class Match:
    candidate: Candidate
    decision: Decision


@dataclass
class RuleEval:
    rule: Rule
    status: str  # Status
    reason: str | None = None
    matches: list[Match] = field(default_factory=list)


@dataclass
class FindingDecision:
    """The merged judgement of every rule that claims one engine finding."""

    status: str
    strength: str
    limitations: list[str]
    rule_ids: list[str]  # registry ids, registry order


@dataclass
class IndicatorDraft:
    rule: Rule
    candidate: Candidate
    user_category: str
    claim: ClaimTuple


@dataclass
class Evaluation:
    runs: list[RuleEval]
    findings: dict[int, FindingDecision]  # index into EngineResult.findings
    indicators: list[IndicatorDraft]
    guard_events: list[str] = field(default_factory=list)  # rule ids rewritten by the AI09 guard


def derive_category(ctx_onto: Ontology, default: str, *types: str) -> str:
    """First report category found along `types` (most specific first), else the default."""
    for t in types:
        if t in ctx_onto.data_types:
            cat = ctx_onto.data_types.report_category(t)
            if cat:
                return cat
    return default


def candidate_category(onto: Ontology, cfg: StatusConfig, c: Candidate) -> str:
    """Findings on a hierarchy root ("personal_info") take the category of the evidence side."""
    if c.finding is not None:
        d, a = c.deny, c.affirm
        assert d is not None and a is not None
        return derive_category(onto, cfg.default_user_category, c.data_type, a.data_type, d.data_type)
    return derive_category(onto, cfg.default_user_category, c.data_type)


class Evaluator:
    def __init__(self, registry: Registry | None = None, onto: Ontology | None = None) -> None:
        self.reg = registry or load_registry()
        self.onto = onto or load_ontology()
        self.cfg = self.reg.status

    # ------------------------------------------------------------------ context
    def context(self, *, coverage: dict[str, str], claims: list[ClaimTuple], result: EngineResult,
                sdk_scan: bool = True) -> EvalContext:
        cov = {"runtime": "unavailable", "test_account": "unavailable", **coverage}
        return EvalContext(onto=self.onto, cfg=self.cfg, coverage=cov, claims=claims, result=result,
                           sdk_scan=sdk_scan)

    # ------------------------------------------------------------------ AI09
    def source_gap(self, rule: Rule, ctx: EvalContext) -> str | None:
        """The inconclusive reason for `rule` under `ctx`, or None when its evidence is usable."""
        es = rule.evidence_sources
        for src in es.required:
            state = ctx.cov(src)
            if state != "ok":
                return self.reg.reason_for(src, state)
        if es.any_of and not any(ctx.cov(s) == "ok" for s in es.any_of):
            first = es.any_of[0]
            return self.reg.reason_for(first, ctx.cov(first))
        for req in rule.requires:
            if not predicates.call(req.predicate, req.args, ctx, None):
                assert req.reason is not None
                return req.reason
        return None

    def _precheck(self, rule: Rule, ctx: EvalContext) -> str | None:
        return self.source_gap(rule, ctx)

    # ------------------------------------------------------------------ candidates
    def candidates(self, ctx: EvalContext) -> dict[str, list[Candidate]]:
        by: dict[str, list[Candidate]] = {}
        for i, f in enumerate(ctx.result.findings):
            if f.suppressed:
                continue
            by.setdefault(f.rule_id, []).append(Candidate("finding", f.rule_id, finding=f, index=i))
        for g in ctx.result.public_gaps:
            by.setdefault("GAP", []).append(Candidate("gap", "GAP", gap=g, claim=g.evidence))
        for c in ctx.claims:
            if c.source_kind in APK_KINDS and c.polarity == Polarity.AFFIRM:
                eid = "APK-PERM" if c.source_kind.value == "apk_permission" else "APK-SDK"
                by.setdefault(eid, []).append(Candidate("apk_claim", eid, claim=c))
        return by

    # ------------------------------------------------------------------ ladder
    def decide(self, rule: Rule, cand: Candidate, ctx: EvalContext) -> Decision:
        cfg = self.cfg
        rank = LADDER[rule.result_on_match]
        limits: list[str] = []
        strength = cand.strength(cfg)
        for ex in rule.exclude_if:  # one step down per hit
            if predicates.call(ex.predicate, ex.args, ctx, cand):
                rank = max(1, rank - 1)
                limits.append(f"excluded_{ex.predicate}")
        if rule.status_ceiling:
            rank = min(rank, LADDER[rule.status_ceiling])
        for ceil in cfg.ceilings:  # absolute caps
            if predicates.call(ceil.when.predicate, ceil.when.args, ctx, cand):
                rank = min(rank, LADDER[ceil.cap])
                if ceil.limitation not in limits:
                    limits.append(ceil.limitation)
        if LADDER_BY_RANK[rank] == "confirmed_conflict":  # the confirm gate
            fail: list[str] = []
            if cand.tier != "strong":
                fail.append("tier_not_strong")
            if strength not in cfg.confirm_strengths:
                fail.append("evidence_strength_insufficient")
            if cand.confidence < cfg.confirm_threshold:
                fail.append("confidence_below_confirm_threshold")
            if fail:
                rank = min(rank, LADDER[cfg.gate_fail_cap])
                limits += [x for x in fail if x not in limits]
        if cand.conflict_class is not None:
            for extra in cfg.class_limitations.get(cand.conflict_class.value, []):
                if extra not in limits:
                    limits.append(extra)
        return Decision(status=LADDER_BY_RANK[rank], strength=strength, limitations=limits)

    # ------------------------------------------------------------------ one rule
    def run_rule(self, rule: Rule, ctx: EvalContext, cands: dict[str, list[Candidate]]) -> RuleEval:
        reason = self._precheck(rule, ctx)
        if reason is not None:
            return RuleEval(rule, "inconclusive", reason)
        matches: list[Match] = []
        for eid in rule.engine_rules:
            for cand in cands.get(eid, []):
                if all(predicates.call(c.predicate, c.args, ctx, cand) for c in rule.conditions):
                    matches.append(Match(cand, self.decide(rule, cand, ctx)))
        if not matches:
            return RuleEval(rule, "no_issue_detected")
        top = max(LADDER[m.decision.status] for m in matches)
        return RuleEval(rule, LADDER_BY_RANK[top], matches=matches)

    # ------------------------------------------------------------------ whole registry
    def evaluate(self, ctx: EvalContext) -> Evaluation:
        cands = self.candidates(ctx)
        runs = [self.run_rule(r, ctx, cands) for r in self.reg.runnable()]
        events: list[str] = []
        for run in runs:  # AI09 post-evaluation guard
            if run.status == "no_issue_detected" and self.source_gap(run.rule, ctx) is not None:
                run.status, run.reason, run.matches = "inconclusive", GUARD_REASON, []
                events.append(run.rule.id)
        return Evaluation(runs=runs, findings=self._merge_findings(runs, ctx),
                          indicators=self._indicators(runs, ctx), guard_events=events)

    def _merge_findings(self, runs: list[RuleEval], ctx: EvalContext) -> dict[int, FindingDecision]:
        merged: dict[int, FindingDecision] = {}
        for run in runs:
            for m in run.matches:
                c = m.candidate
                if c.kind != "finding":
                    continue
                cur = merged.get(c.index)
                if cur is None:
                    merged[c.index] = FindingDecision(m.decision.status, m.decision.strength,
                                                      list(m.decision.limitations), [run.rule.id])
                    continue
                if LADDER[m.decision.status] > LADDER[cur.status]:
                    cur.status = m.decision.status
                cur.limitations += [x for x in m.decision.limitations if x not in cur.limitations]
                cur.rule_ids.append(run.rule.id)
        for i, f in enumerate(ctx.result.findings):
            if f.suppressed or i in merged:
                continue
            cand = Candidate("finding", f.rule_id, finding=f, index=i)
            merged[i] = FindingDecision("needs_review", cand.strength(self.cfg), ["no_registry_rule"], [])
        return merged

    def _indicators(self, runs: list[RuleEval], ctx: EvalContext) -> list[IndicatorDraft]:
        out: list[IndicatorDraft] = []
        for run in runs:
            if not run.rule.investigation or run.status != "needs_review":
                continue
            seen: set[Any] = set()
            ordered = sorted(
                run.matches,
                key=lambda m: (m.candidate.claim.source_kind.value != "apk_permission" if m.candidate.claim else 1,
                               -m.candidate.confidence))
            for m in ordered:
                cl = m.candidate.claim
                assert cl is not None
                cat = (run.rule.user_category if run.rule.user_category != "derived"
                       else candidate_category(self.onto, self.cfg, m.candidate))
                key = {"evidence": cl.evidence.text, "category": cat, "data_type": cl.data_type}[run.rule.dedupe]
                if key in seen:
                    continue
                seen.add(key)
                out.append(IndicatorDraft(rule=run.rule, candidate=m.candidate, user_category=cat, claim=cl))
        return out


def finding_category(ev: Evaluator, c: Candidate) -> str:
    return candidate_category(ev.onto, ev.cfg, c)


__all__ = [
    "Decision", "Evaluation", "Evaluator", "FindingDecision", "IndicatorDraft", "Match", "RuleEval",
    "candidate_category", "derive_category", "finding_category",
]
