"""Named predicates over candidates and the evaluation context (PLAN.md §4.9).

Registry rules, `exclude_if` lists and the global ceilings refer to predicates *by name*; the
loader rejects an unknown name or an unknown argument. A predicate never mentions a rule id.
Add a predicate here, then use it in YAML.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from sahamati_core.schema import Polarity, SourceKind

from .context import APK_KINDS, Candidate, EvalContext

Scope = Literal["candidate", "context"]
PredicateFn = Callable[[EvalContext, Candidate | None, dict[str, Any]], bool]


@dataclass(frozen=True)
class PredicateSpec:
    name: str
    fn: PredicateFn
    scope: Scope
    params: frozenset[str]
    required: frozenset[str]
    doc: str


PREDICATES: dict[str, PredicateSpec] = {}


def predicate(name: str, *, scope: Scope = "candidate", params: tuple[str, ...] = (),
              required: tuple[str, ...] | None = None) -> Callable[[PredicateFn], PredicateFn]:
    def deco(fn: PredicateFn) -> PredicateFn:
        PREDICATES[name] = PredicateSpec(
            name=name, fn=fn, scope=scope, params=frozenset(params),
            required=frozenset(params if required is None else required), doc=(fn.__doc__ or "").strip())
        return fn
    return deco


def validate_call(name: str, args: dict[str, Any], *, scope: Scope) -> list[str]:
    spec = PREDICATES.get(name)
    if spec is None:
        return [f"unknown predicate {name!r}"]
    errs: list[str] = []
    if spec.scope != scope:
        errs.append(f"predicate {name!r} has {spec.scope} scope, used in a {scope} position")
    unknown = set(args) - spec.params
    if unknown:
        errs.append(f"predicate {name!r}: unknown argument(s) {sorted(unknown)}")
    missing = spec.required - set(args)
    if missing:
        errs.append(f"predicate {name!r}: missing argument(s) {sorted(missing)}")
    return errs


def call(name: str, args: dict[str, Any], ctx: EvalContext, cand: Candidate | None) -> bool:
    return PREDICATES[name].fn(ctx, cand, args)


def _cand(cand: Candidate | None) -> Candidate:
    assert cand is not None
    return cand


# --------------------------------------------------------------------------- candidate scope


@predicate("action_in", params=("actions",))
def action_in(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """The candidate's action (the denied action for findings) is one of `actions`."""
    return _cand(cand).action.value in a["actions"]


@predicate("candidate_kind_is", params=("kind",))
def candidate_kind_is(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """finding | gap | apk_claim."""
    return bool(_cand(cand).kind == a["kind"])


@predicate("evidence_strength_is", params=("strength",))
def evidence_strength_is(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """The weaker side's evidence strength equals `strength` (declaration|code_path|presence|capability)."""
    c = _cand(cand)
    return c.kind != "gap" and c.strength(ctx.cfg) == a["strength"]


@predicate("denial_is_conditional")
def denial_is_conditional(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """The denying claim is limited by a purpose/condition, so it may not be a flat denial."""
    d = _cand(cand).deny
    return d is not None and bool(d.condition or d.purposes)


@predicate("affirm_broader_than_denial")
def affirm_broader_than_denial(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """The affirming claim is not strictly covered by the denial (broader or unrelated type or actor)."""
    c = _cand(cand)
    d, f = c.deny, c.affirm
    if d is None or f is None:
        return False
    return not (ctx.onto.data_types.subsumes(d.data_type, f.data_type)
                and ctx.onto.actors.subsumes(d.actor, f.actor))


@predicate("claim_confidence_below_min")
def claim_confidence_below_min(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """A claim behind the candidate was read with confidence below `status.min_claim_confidence`."""
    return _cand(cand).claim_confidence < ctx.cfg.min_claim_confidence


@predicate("data_type_under", params=("nodes",))
def data_type_under(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """The candidate's data type is one of `nodes` or a descendant of one (subsumption only)."""
    dt = ctx.onto.data_types
    t = _cand(cand).data_type
    return any(dt.subsumes(n, t) for n in a["nodes"])


@predicate("source_is", params=("sources",))
def source_is(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """Some side of the candidate comes from one of `sources` (policy|data_safety|apk_permission|apk_sdk)."""
    return any(k.value in a["sources"] for k in _cand(cand).source_kinds())


@predicate("sdk_actor_under", params=("actor",))
def sdk_actor_under(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """The candidate's SDK evidence belongs to an SDK whose actor is `actor` or a descendant."""
    c = _cand(cand).apk_claim
    if c is None or c.source_kind != SourceKind.APK_SDK:
        return False
    entry = next((s for s in ctx.onto.sdks if s.prefix == c.evidence.text), None)
    return entry is not None and ctx.onto.actors.subsumes(a["actor"], entry.actor)


@predicate("affirm_actor_is_exempt")
def affirm_actor_is_exempt(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """The affirmed recipient is one Play does not count as "sharing" (service providers, legal requests)."""
    f = _cand(cand).affirm
    return f is not None and any(ctx.onto.actors.subsumes(x, f.actor) for x in ctx.onto.sharing_exemptions)


@predicate("no_stated_purpose")
def no_stated_purpose(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """Neither the policy nor the data-safety section affirms a purpose for an overlapping data type."""
    dt = ctx.onto.data_types
    t = _cand(cand).data_type
    for c in ctx.claims:
        if c.source_kind in APK_KINDS or c.synthetic or c.polarity != Polarity.AFFIRM:
            continue
        if (c.purposes or c.condition) and dt.overlaps(c.data_type, t) is not None:
            return False
    return True


# --------------------------------------------------------------------------- context scope


@predicate("sdk_scan_complete", scope="context")
def sdk_scan_complete(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """The APK class list was read in full, so "no SDK found" means something."""
    return ctx.cov("apk") == "ok" and ctx.sdk_scan


@predicate("source_ok", scope="context", params=("source",))
def source_ok(ctx: EvalContext, cand: Candidate | None, a: dict[str, Any]) -> bool:
    """The named source has coverage `ok`."""
    return ctx.cov(a["source"]) == "ok"
