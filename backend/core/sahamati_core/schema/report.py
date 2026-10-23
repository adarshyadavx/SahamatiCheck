"""Public report contract. Serialises exactly to packages/contracts/src/index.ts.

Fields that are optional (`field?: T`) in TypeScript are omitted from the JSON
when they are None; fields typed `T | null` are always present.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .enums import Action, Coverage, Polarity

ConflictClassLit = Literal["internal_contradiction", "declaration_mismatch", "behavioural_mismatch"]
StatusLit = Literal["confirmed_conflict", "potential_conflict", "needs_review", "inconclusive", "no_issue_detected"]
FindingStatusLit = Literal["confirmed_conflict", "potential_conflict", "needs_review"]
EvidenceStrengthLit = Literal["declaration", "code_path", "presence", "capability"]
UserCategoryLit = Literal[
    "location", "contacts", "photos_files", "camera_mic", "messages_calls",
    "money_payments", "identity", "health", "ads_tracking", "account_profile",
]
CardColorLit = Literal["red", "orange", "yellow", "grey", "green"]
SideSource = Literal["policy", "data_safety", "apk_permission", "apk_sdk"]


def _is_none(v: Any) -> bool:
    return v is None


def opt(**kw: Any) -> Any:
    """A TS optional field (`name?: T`): omitted from the JSON when None."""
    return Field(default=None, exclude_if=_is_none, **kw)


class ContractModel(BaseModel):
    model_config = ConfigDict(
        serialize_by_alias=True, validate_by_name=True, validate_by_alias=True, extra="forbid"
    )


class ClaimTupleView(ContractModel):
    actor: str
    action: Action
    polarity: Polarity
    data_type: str
    condition: str | None = None


class Evidence(ContractModel):
    quote: str | None = opt()
    label: str | None = opt()
    permission: str | None = opt()
    sdk: str | None = opt()
    url: str | None = opt()
    char_start: int | None = opt()
    char_end: int | None = opt()
    text_fragment: str | None = opt()
    captured_at: str


class FindingSide(ContractModel):
    source: SideSource
    tuple: ClaimTupleView
    evidence: Evidence


class Finding(ContractModel):
    id: str
    class_: ConflictClassLit = Field(alias="class")
    tier: Literal["strong", "indicative"]
    confidence: float = Field(ge=0, le=1)
    rule_id: str
    summary: str
    ontology_path: list[str]
    sides: tuple[FindingSide, FindingSide]
    benign_explanations: list[str]
    status: FindingStatusLit
    evidence_strength: EvidenceStrengthLit
    limitations: list[str]
    user_category: UserCategoryLit
    group_id: str | None = opt()
    related_finding_ids: list[str] | None = opt()


class DisclosureGap(ContractModel):
    id: str
    data_type: str
    ontology_path: list[str]
    evidence: Evidence
    source: Literal["apk_permission", "apk_sdk"]


class Indicator(ContractModel):
    id: str
    rule_id: str
    status: Literal["needs_review"]
    user_category: UserCategoryLit
    data_type: str
    ontology_path: list[str]
    summary: str
    source: SideSource
    evidence: Evidence
    group_id: str | None = opt()


class RuleRun(ContractModel):
    rule_id: str
    name: str
    family: Literal["P", "D", "T", "A", "C", "S", "AI"]
    phase: int = Field(ge=1, le=3)
    status: StatusLit
    reason: str | None = opt()


class CardCategory(ContractModel):
    id: UserCategoryLit
    color: CardColorLit
    status: StatusLit
    note: str
    finding_ids: list[str]
    indicator_ids: list[str]


class CardAnswer(ContractModel):
    id: Literal["location", "sharing", "ads", "deletion", "grievance"]
    text: str
    finding_ids: list[str]


class ReportCard(ContractModel):
    categories: list[CardCategory]
    answers: list[CardAnswer]
    checked_at: str


class StatusCounts(ContractModel):
    confirmed_conflict: int
    potential_conflict: int
    needs_review: int
    inconclusive: int
    no_issue_detected: int


class ReportSummary(ContractModel):
    strong: int
    indicative: int
    not_mentioned: int
    agree_types: int
    vague_claim_ratio: float


class ClaimMatrixRow(ContractModel):
    data_type: str
    ontology_path: list[str]
    policy: Literal["collects", "shares", "denies", "vague", "silent"]
    data_safety: Literal["collects", "shares", "denies", "silent"]
    apk: Literal["evidence", "silent", "unknown"]
    conflict_class: Literal[
        "internal_contradiction", "declaration_mismatch", "behavioural_mismatch", "disclosure_gap"
    ] | None = opt()


class AppInfo(ContractModel):
    package: str
    version_code: int | None
    title: str
    developer: str | None = opt()
    is_demo: bool


class CoverageMap(ContractModel):
    policy: Coverage
    data_safety: Coverage
    apk: Coverage


class Versions(ContractModel):
    engine: str
    ontology: str
    extractor: str


class Report(ContractModel):
    report_id: str
    app: AppInfo
    generated_at: str  # ISO 8601, e.g. "2026-10-19T10:00:00Z"
    coverage: CoverageMap
    summary: ReportSummary
    findings: list[Finding]
    disclosure_gaps: list[DisclosureGap]
    matrix: list[ClaimMatrixRow]
    indicators: list[Indicator]
    rule_runs: list[RuleRun]
    status_counts: StatusCounts
    card: ReportCard
    versions: Versions
