"""Runs a registry TestCase: claim specs -> engine -> evaluator -> the owning rule's run."""

from __future__ import annotations

from helpers import claim
from sahamati_core.engine import Engine
from sahamati_core.ontology import load_ontology
from sahamati_core.rules import Evaluation, Evaluator, load_registry
from sahamati_core.rules.models import Rule, TestCase

DEFAULT_COVERAGE = {"policy": "ok", "data_safety": "ok", "apk": "ok"}


def evaluate_case(case: TestCase, evaluator: Evaluator | None = None) -> Evaluation:
    ev = evaluator or Evaluator(load_registry(), load_ontology())
    claims = [claim(spec, i) for i, spec in enumerate(case.claims)]
    coverage = {**DEFAULT_COVERAGE, **case.coverage}
    result = Engine().run(claims, apk_ok=coverage["apk"] == "ok")
    ctx = ev.context(coverage=coverage, claims=claims, result=result, sdk_scan=case.sdk_scan)
    return ev.evaluate(ctx)


def check_case(rule: Rule, case: TestCase, evaluator: Evaluator | None = None) -> list[str]:
    ev = evaluator or Evaluator(load_registry(), load_ontology())
    if case.sabotage == "precheck":
        ev._precheck = lambda rule, ctx: None  # type: ignore[method-assign,assignment]
    out = evaluate_case(case, ev)
    target = case.expect.rule or rule.id
    run = next((r for r in out.runs if r.rule.id == target), None)
    errs: list[str] = []
    if run is None:
        return [f"{rule.id}/{case.name}: rule {target} did not run"]
    exp = case.expect
    if run.status != exp.status:
        errs.append(f"{rule.id}/{case.name}: status {run.status!r}, expected {exp.status!r}")
    if exp.reason is not None and run.reason != exp.reason:
        errs.append(f"{rule.id}/{case.name}: reason {run.reason!r}, expected {exp.reason!r}")
    if exp.status == "inconclusive" and not run.reason:
        errs.append(f"{rule.id}/{case.name}: inconclusive without a reason")
    if exp.indicators is not None:
        n = sum(1 for i in out.indicators if i.rule.id == target)
        if n != exp.indicators:
            errs.append(f"{rule.id}/{case.name}: {n} indicator(s), expected {exp.indicators}")
    if exp.findings is not None:
        got = sorted(m.decision.status for m in run.matches if m.candidate.kind == "finding")
        if got != sorted(exp.findings):
            errs.append(f"{rule.id}/{case.name}: finding statuses {got}, expected {sorted(exp.findings)}")
    if case.sabotage and target not in out.guard_events:
        errs.append(f"{rule.id}/{case.name}: guard events {out.guard_events}, expected {target} among them")
    if not case.sabotage and out.guard_events:
        errs.append(f"{rule.id}/{case.name}: the AI09 guard fired for {out.guard_events} (must never happen)")
    return errs


def all_cases() -> list[tuple[Rule, TestCase]]:
    return [(r, t) for r in load_registry().rules for t in r.tests]


def case_id(pair: tuple[Rule, TestCase]) -> str:
    r, t = pair
    return f"{r.id}-{t.case}-{t.name[:48]}"


__all__ = ["DEFAULT_COVERAGE", "all_cases", "case_id", "check_case", "evaluate_case"]
