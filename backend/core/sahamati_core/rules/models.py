"""Pydantic models for the rule registry and the status policy (PLAN.md §4.9).

Everything here is `extra="forbid"`: a typo in YAML is a load error, never a silently ignored key.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import predicates

Status = Literal["confirmed_conflict", "potential_conflict", "needs_review", "inconclusive", "no_issue_detected"]
LadderStatus = Literal["confirmed_conflict", "potential_conflict", "needs_review"]
Family = Literal["P", "D", "T", "A", "C", "S", "AI"]
Source = Literal["policy", "data_safety", "apk", "runtime", "test_account"]
Strength = Literal["declaration", "code_path", "presence", "capability"]

LADDER: dict[str, int] = {"needs_review": 1, "potential_conflict": 2, "confirmed_conflict": 3}
LADDER_BY_RANK = {v: k for k, v in LADDER.items()}
# Sources that no static run can provide. A rule that requires one is a stub: always inconclusive.
STATIC_UNAVAILABLE: frozenset[str] = frozenset({"runtime", "test_account"})
# What a rule may read: engine finding ids, plus the pseudo ids for gaps and raw APK claims.
ENGINE_IDS: frozenset[str] = frozenset(
    {"IC-01", "DM-01", "DM-02", "DM-03", "BM-01", "BM-02", "BM-03", "BM-04", "GAP", "APK-PERM", "APK-SDK"})
GUARD_REASON = "missing_source_false_pass_prevented"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PredicateCall(Strict):
    predicate: str
    args: dict[str, Any] = Field(default_factory=dict)
    reason: str | None = None  # only meaningful in `requires`: the inconclusive reason when it does not hold


class CeilingSpec(Strict):
    when: PredicateCall
    cap: LadderStatus
    limitation: str


class StatusConfig(Strict):
    """The `status:` section of engine/thresholds.yaml."""

    confirm_threshold: float = Field(ge=0, le=1)
    min_claim_confidence: float = Field(ge=0, le=1)
    confirm_strengths: list[Strength]
    gate_fail_cap: LadderStatus
    default_user_category: str
    evidence_strength_by_source: dict[str, Strength]
    evidence_strength_weights: dict[Strength, float]
    ceilings: list[CeilingSpec]
    class_limitations: dict[str, list[str]] = Field(default_factory=dict)
    group_parent_order: list[str] = Field(default_factory=list)
    group_slugs: dict[str, str]  # report category -> short slug used in group ids (g_ads, g_loc, ...)

    @model_validator(mode="after")
    def _check(self) -> StatusConfig:
        errs: list[str] = []
        for c in self.ceilings:
            errs += predicates.validate_call(c.when.predicate, c.when.args, scope="candidate")
        if set(self.evidence_strength_weights) != {"declaration", "code_path", "presence", "capability"}:
            errs.append("evidence_strength_weights must cover declaration, code_path, presence, capability")
        if set(self.evidence_strength_by_source) != {"policy", "data_safety", "apk_permission", "apk_sdk"}:
            errs.append("evidence_strength_by_source must cover policy, data_safety, apk_permission, apk_sdk")
        if errs:
            raise ValueError("; ".join(errs))
        return self


class EvidenceSources(Strict):
    required: list[Source] = Field(default_factory=list)
    any_of: list[Source] = Field(default_factory=list)


class TestExpect(Strict):
    __test__ = False  # not a pytest class
    rule: str | None = None  # guard cases: the rule whose run is checked (default: the owning rule)
    status: Status
    reason: str | None = None
    indicators: int | None = None  # exact number of indicators the rule emits
    findings: list[LadderStatus] | None = None  # exact finding statuses (any order) for this rule's matches


class TestCase(Strict):
    __test__ = False
    case: Literal["positive", "negative", "inconclusive", "guard"]
    name: str
    claims: list[dict[str, Any]] = Field(default_factory=list)  # tests/helpers.py claim specs
    coverage: dict[str, str] = Field(default_factory=dict)  # overrides; default: policy, data_safety, apk ok
    sdk_scan: bool = True
    sabotage: Literal["precheck"] | None = None  # guard cases: disable the pre-check to prove the guard fires
    expect: TestExpect


class Rule(Strict):
    id: str = Field(pattern=r"^[A-Z]{1,2}\d{2}$")
    version: int = Field(ge=1)
    name: str
    name_hi: str
    family: Family
    phase: int = Field(ge=1, le=3)
    enabled: bool
    kind: Literal["detector", "guard"] = "detector"
    investigation: bool = False
    severity: Literal["high", "medium", "low", "info"]
    score_track: Literal["privacy", "security"]
    evidence_sources: EvidenceSources = Field(default_factory=EvidenceSources)
    engine_rules: list[str] = Field(default_factory=list)
    requires: list[PredicateCall] = Field(default_factory=list)
    conditions: list[PredicateCall] = Field(default_factory=list)
    exclude_if: list[PredicateCall] = Field(default_factory=list)
    status_ceiling: LadderStatus | None = None
    result_on_match: LadderStatus
    inconclusive_reasons: list[str] = Field(default_factory=list)
    user_category: str = "derived"  # a category id, or "derived" from the data type
    categories: list[str] = Field(default_factory=list)  # report-card categories this rule covers
    applies_to_all: bool = False  # a generic detector: its health counts for every category
    dedupe: Literal["data_type", "category", "evidence"] = "data_type"  # investigation rules only
    plain_language: str
    plain_language_hi: str
    tests: list[TestCase]

    @field_validator("engine_rules")
    @classmethod
    def _engine_ids(cls, v: list[str]) -> list[str]:
        bad = [x for x in v if x not in ENGINE_IDS]
        if bad:
            raise ValueError(f"unknown engine rule id(s) {bad}; known: {sorted(ENGINE_IDS)}")
        return v

    @model_validator(mode="after")
    def _check(self) -> Rule:
        errs: list[str] = []
        if not self.id.startswith(self.family):
            errs.append(f"id {self.id} does not belong to family {self.family}")
        if LADDER[self.status_ceiling or self.result_on_match] > LADDER[self.result_on_match]:
            errs.append(f"status_ceiling {self.status_ceiling} is above result_on_match {self.result_on_match}")
        if self.investigation and self.result_on_match != "needs_review":
            errs.append("an investigation rule can only ever be needs_review")
        for pos, calls, scope in (("requires", self.requires, "context"), ("conditions", self.conditions, "candidate"),
                                  ("exclude_if", self.exclude_if, "candidate")):
            for c in calls:
                errs += [f"{pos}: {e}" for e in predicates.validate_call(c.predicate, c.args, scope=scope)]  # type: ignore[arg-type]
        for c in self.conditions + self.exclude_if:
            if c.reason:
                errs.append("`reason` is only allowed in `requires`")
        for c in self.requires:
            if not c.reason:
                errs.append(f"requires {c.predicate}: a `reason` is mandatory (what is reported when it fails)")
        both = set(self.evidence_sources.required) & set(self.evidence_sources.any_of)
        if both:
            errs.append(f"sources {sorted(both)} are both required and any_of")
        if self.kind == "detector" and self.enabled and not self.engine_rules and not (
                set(self.evidence_sources.required) & STATIC_UNAVAILABLE):
            errs.append("an enabled detector must read engine_rules (or require a runtime source)")
        if self.investigation and not set(self.engine_rules) <= {"APK-PERM", "APK-SDK", "GAP"}:
            errs.append("an investigation rule reads APK claims or gaps only")
        if not self.tests:
            errs.append("a rule without tests is rejected")
        else:
            kinds = {t.case for t in self.tests}
            has_sources = bool(self.evidence_sources.required or self.evidence_sources.any_of)
            stub = bool(set(self.evidence_sources.required) & STATIC_UNAVAILABLE)
            if self.kind == "guard":
                if "guard" not in kinds:
                    errs.append("a guard rule needs a `guard` test case")
            else:
                if stub:
                    if "inconclusive" not in kinds:
                        errs.append("a runtime stub needs an `inconclusive` test case")
                else:
                    for need in ("positive", "negative") + (("inconclusive",) if has_sources else ()):
                        if need not in kinds:
                            errs.append(f"missing a `{need}` test case")
        if errs:
            raise ValueError(f"rule {self.id}: " + "; ".join(errs))
        return self


class RuleInfo(Strict):
    """Public listing of one registry rule (GET /v1/rules)."""

    id: str
    version: int
    name: str
    name_hi: str
    family: Family
    phase: int
    enabled: bool
    kind: Literal["detector", "guard"]
    investigation: bool
    severity: Literal["high", "medium", "low", "info"]
    score_track: Literal["privacy", "security"]
    required_sources: list[str]
    any_of_sources: list[str]
    engine_rules: list[str]
    result_on_match: LadderStatus
    status_ceiling: LadderStatus | None
    categories: list[str]
    inconclusive_reasons: list[str]
    plain_language: str
    plain_language_hi: str
