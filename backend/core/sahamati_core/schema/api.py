"""API request/response models that mirror packages/contracts/src/index.ts.

Models marked EXTENSION are not (yet) in the TS contract; see docs/contract-requests.md.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .enums import JobStatus
from .report import ClaimTupleView, ContractModel, Finding, Report, opt


class Job(ContractModel):
    job_id: str
    status: JobStatus
    stage: str
    progress: float = Field(ge=0, le=1)
    report_id: str | None = opt()
    error: str | None = opt()


class CheckRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    package_name: str | None = None
    play_url: str | None = None


class CheckReportResponse(ContractModel):
    kind: Literal["report"] = "report"
    report: Report


class CheckJobResponse(ContractModel):
    kind: Literal["job"] = "job"
    job_id: str
    status_url: str
    events_url: str


class PolicySegment(ContractModel):
    char_start: int
    char_end: int
    text: str
    tuples: list[ClaimTupleView]
    vague: bool
    confidence: float


class PolicySegmentsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url: str
    text: str = Field(max_length=500_000)
    text_sha256: str
    lang: str | None = None


class PolicySegmentsResponse(ContractModel):
    segments: list[PolicySegment]
    vague_claim_ratio: float


class OntologyNode(ContractModel):
    id: str
    label_en: str
    label_hi: str
    parents: list[str]
    kind: Literal["data_type", "actor", "purpose"]


class Ontology(ContractModel):
    version: str
    nodes: list[OntologyNode]


class AuditCategory(ContractModel):
    category: str
    apps: int
    strong_rate: float
    indicative_rate: float
    gap_rate: float
    vague_ratio: float


class FailureRates(ContractModel):
    policy_unreachable: float
    apk_unparseable: float


class AuditAggregate(ContractModel):
    corpus_size: int
    by_category: list[AuditCategory]
    failure_rates: FailureRates
    is_demo: bool = False  # EXTENSION: true when serving fabricated demo aggregates


# ---------------------------------------------------------------- EXTENSIONS


class FeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    report_id: str | None = None
    verdict: str = "looks_wrong"
    comment: str | None = Field(default=None, max_length=4000)


class DisputeRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    report_id: str
    finding_id: str | None = None
    contact_email: str = Field(max_length=320)
    message: str = Field(max_length=8000)
    verification_method: Literal["play_contact_email", "policy_token", "well_known"] | None = None


class DisputeResponse(ContractModel):
    dispute_id: str
    status: str
    acknowledge_within_hours: int = 72


class SelfCheckResponse(ContractModel):
    kind: Literal["report"] = "report"  # also a valid CheckResponse for clients that treat it as one
    report: Report
    suppressed_findings: list[Finding]  # below-threshold findings, visible only to the developer
    private: bool = True
    expires_at: str


class PolicySnapshotView(ContractModel):
    snapshot_id: str
    captured_at: str
    url: str | None
    content_sha256: str
    claim_count: int


class ClaimChange(ContractModel):
    kind: Literal["added", "removed", "polarity_flipped", "broadened"]
    actor: str
    action: str
    data_type: str
    before: dict[str, Any] | None = opt()
    after: dict[str, Any] | None = opt()


class PolicyDiffView(ContractModel):
    from_snapshot: str
    to_snapshot: str
    changes: list[ClaimChange]
    silent: bool


class PolicyHistory(ContractModel):
    package: str
    snapshots: list[PolicySnapshotView]
    diffs: list[PolicyDiffView]
