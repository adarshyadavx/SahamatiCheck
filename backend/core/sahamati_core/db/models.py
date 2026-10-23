"""SQLAlchemy 2.0 models (PLAN.md §4.1). SQLite by default, Postgres via DATABASE_URL.

Shared by the API and the worker, so it lives in core (no web imports).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class AppRow(Base):
    __tablename__ = "apps"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    package: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    title: Mapped[str | None] = mapped_column(String(500))
    developer: Mapped[str | None] = mapped_column(String(500))
    category: Mapped[str | None] = mapped_column(String(200))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AppVersionRow(Base):
    __tablename__ = "app_versions"
    __table_args__ = (UniqueConstraint("app_id", "version_code", "ds_hash", "policy_hash"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    app_id: Mapped[str] = mapped_column(ForeignKey("apps.id"), index=True)
    version_code: Mapped[int | None] = mapped_column(Integer)
    ds_hash: Mapped[str] = mapped_column(String(64), default="")
    policy_hash: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SourceRow(Base):
    __tablename__ = "sources"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    app_version_id: Mapped[str] = mapped_column(ForeignKey("app_versions.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32))  # policy | data_safety | apk
    url: Mapped[str | None] = mapped_column(Text)
    fetch_status: Mapped[str] = mapped_column(String(32))  # ok|unreachable|blocked|unparseable|unavailable
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    captured_at: Mapped[str] = mapped_column(String(32), default="")
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ClaimRow(Base):
    __tablename__ = "claims"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id"), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    extractor: Mapped[str] = mapped_column(String(32))
    extractor_version: Mapped[str] = mapped_column(String(64))
    ontology_version: Mapped[str] = mapped_column(String(32))


class ReportRow(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # report_id
    package: Mapped[str] = mapped_column(String(255), index=True)
    app_version_id: Mapped[str | None] = mapped_column(ForeignKey("app_versions.id"))
    cache_key: Mapped[str] = mapped_column(String(64), index=True, default="")
    engine_version: Mapped[str] = mapped_column(String(32))
    ontology_version: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    etag: Mapped[str] = mapped_column(String(64))
    category: Mapped[str | None] = mapped_column(String(200))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    private: Mapped[bool] = mapped_column(Boolean, default=False)  # self-check results
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suppressed_payload: Mapped[list[Any]] = mapped_column(JSON, default=list)
    # plain facts behind the report card's five answers (report_card.ReportFacts), so any language can be rendered
    facts: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class FindingRow(Base):
    __tablename__ = "findings"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    public_id: Mapped[str | None] = mapped_column(String(32))  # "f_dm_01" when shown publicly
    cls: Mapped[str] = mapped_column("class", String(32))
    tier: Mapped[str] = mapped_column(String(16))
    confidence: Mapped[float] = mapped_column(Float)
    claim_a: Mapped[dict[str, Any]] = mapped_column(JSON)
    claim_b: Mapped[dict[str, Any]] = mapped_column(JSON)
    overlap_node: Mapped[str] = mapped_column(String(64))
    rule_id: Mapped[str] = mapped_column(String(16))
    engine_version: Mapped[str] = mapped_column(String(32))
    suppressed: Mapped[bool] = mapped_column(Boolean, default=False)
    verdict: Mapped[str | None] = mapped_column(String(32))  # gold-set / manual verification


class JobRow(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: "j_" + uuid.uuid4().hex[:16])
    package: Mapped[str] = mapped_column(String(255), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    stage: Mapped[str] = mapped_column(String(64), default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    report_id: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class OntologyNodeRow(Base):
    __tablename__ = "ontology_nodes"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[str] = mapped_column(String(32), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)


class PolicySnapshotRow(Base):
    __tablename__ = "policy_snapshots"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: "ps_" + uuid.uuid4().hex[:12])
    package: Mapped[str] = mapped_column(String(255), index=True)
    url: Mapped[str | None] = mapped_column(Text)
    content_sha256: Mapped[str] = mapped_column(String(64))
    captured_at: Mapped[str] = mapped_column(String(32))
    last_updated_text: Mapped[str | None] = mapped_column(String(64))
    claims: Mapped[list[Any]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class LLMCallRow(Base):
    __tablename__ = "llm_calls"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    model: Mapped[str] = mapped_column(String(64))
    request: Mapped[dict[str, Any]] = mapped_column(JSON)
    response: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DisputeRow(Base):
    __tablename__ = "disputes"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: "d_" + uuid.uuid4().hex[:12])
    report_id: Mapped[str] = mapped_column(String(64), index=True)
    finding_id: Mapped[str | None] = mapped_column(String(32))
    contact_email: Mapped[str] = mapped_column(String(320))
    message: Mapped[str] = mapped_column(Text)
    verification_method: Mapped[str | None] = mapped_column(String(32))
    # pending_verification -> under_review (finding hidden) -> resolved_ruleset_fixed | resolved_response_attached
    status: Mapped[str] = mapped_column(String(32), default="pending_verification")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class FeedbackRow(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    finding_id: Mapped[str] = mapped_column(String(64), index=True)
    report_id: Mapped[str | None] = mapped_column(String(64))
    verdict: Mapped[str] = mapped_column(String(32))
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
