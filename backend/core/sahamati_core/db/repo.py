"""Persistence helpers shared by the API and the worker."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from sahamati_core import ENGINE_VERSION
from sahamati_core.diff import diff_claims
from sahamati_core.ingest import demo_policy_history
from sahamati_core.ontology import load_ontology
from sahamati_core.schema import (
    AuditAggregate,
    AuditCategory,
    ClaimChange,
    ClaimTuple,
    FailureRates,
    Job,
    JobStatus,
    PolicyDiffView,
    PolicyHistory,
    PolicySnapshotView,
)

from .models import (
    AppRow,
    AppVersionRow,
    ClaimRow,
    DisputeRow,
    FindingRow,
    JobRow,
    LLMCallRow,
    PolicySnapshotRow,
    ReportRow,
    SourceRow,
)

REPORT_FRESHNESS = timedelta(hours=24)
SELF_CHECK_RETENTION = timedelta(days=30)
K_ANON = 5  # audit cells with fewer apps are merged


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(d: datetime | None) -> datetime | None:
    if d is None:
        return None
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def etag_for(payload: dict[str, Any]) -> str:
    import hashlib

    body = dict(payload)
    body.pop("generated_at", None)
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:32]


# ------------------------------------------------------------------ jobs


def create_job(s: Session, package: str) -> JobRow:
    job = JobRow(package=package, status=JobStatus.QUEUED.value, stage="queued", progress=0.0)
    s.add(job)
    s.flush()
    return job


def update_job(s: Session, job_id: str, **fields: Any) -> None:
    job = s.get(JobRow, job_id)
    if job is None:
        return
    for k, v in fields.items():
        setattr(job, k, v)
    job.updated_at = _now()


def job_view(job: JobRow) -> Job:
    return Job(job_id=job.id, status=JobStatus(job.status), stage=job.stage, progress=round(job.progress, 3),
               report_id=job.report_id, error=job.error)


# ------------------------------------------------------------------ reports


def _get_or_create_app(s: Session, listing: dict[str, Any]) -> AppRow:
    app = s.scalar(select(AppRow).where(AppRow.package == listing["package"]))
    if app is None:
        app = AppRow(package=listing["package"])
        s.add(app)
    app.title = listing.get("title")
    app.developer = listing.get("developer")
    app.category = listing.get("category")
    app.is_demo = bool(listing.get("is_demo"))
    s.flush()
    return app


def persist_state(s: Session, state: dict[str, Any], *, private: bool = False) -> ReportRow:
    """Store app, version, sources, claims, findings and the report from a finished pipeline state."""
    listing = state["listing"]
    report = state["report"]
    vc = report["app"]["version_code"]
    ds_hash = state["ds"].get("hash", "")
    pol_hash = state["policy"].get("content_sha256", "")
    ver: AppVersionRow | None = None
    if not private:
        # self-check uploads are private: no app/source/claim rows, only the expiring report
        app = _get_or_create_app(s, listing)
        ver = s.scalar(select(AppVersionRow).where(
            AppVersionRow.app_id == app.id, AppVersionRow.version_code == vc,
            AppVersionRow.ds_hash == ds_hash, AppVersionRow.policy_hash == pol_hash))
    if not private and ver is None:
        ver = AppVersionRow(app_id=app.id, version_code=vc, ds_hash=ds_hash, policy_hash=pol_hash)
        s.add(ver)
        s.flush()
        for kind, status, url, chash, claims in (
            ("policy", state["policy"].get("status", "unavailable"), state["policy"].get("url"), pol_hash,
             state.get("policy_claims", [])),
            ("data_safety", state["ds"]["status"], None, ds_hash, state["ds"]["claims"]),
            ("apk", state["apk"]["coverage"], None, "", state["apk"]["claims"]),
        ):
            src = SourceRow(app_version_id=ver.id, kind=kind, fetch_status=status, url=url, content_hash=chash,
                            captured_at=listing.get("captured_at", ""), meta={"sdks": state["apk"].get("sdks", [])}
                            if kind == "apk" else {})
            s.add(src)
            s.flush()
            for c in claims:
                s.add(ClaimRow(source_id=src.id, payload=c, extractor=c.get("extractor", ""),
                               extractor_version=c.get("extractor_version", ""),
                               ontology_version=c.get("ontology_version", "")))
    rid = report["report_id"]
    row = s.get(ReportRow, rid)
    if row is None:
        row = ReportRow(id=rid, package=listing["package"])
        s.add(row)
    else:
        s.execute(delete(FindingRow).where(FindingRow.report_id == rid))
    row.app_version_id = ver.id if ver is not None else None
    row.cache_key = state.get("cache_key", "")
    row.engine_version = report["versions"]["engine"]
    row.ontology_version = report["versions"]["ontology"]
    row.payload = report
    row.etag = etag_for(report)
    row.category = listing.get("category")
    row.is_demo = bool(listing.get("is_demo"))
    row.private = private
    row.expires_at = _now() + SELF_CHECK_RETENTION if private else None
    row.suppressed_payload = state.get("suppressed", [])
    row.facts = state.get("facts")
    row.created_at = _now()
    s.flush()
    public_ids = iter(f["id"] for f in report["findings"])
    for f in state.get("engine", []):
        s.add(FindingRow(
            report_id=rid, public_id=None if f["suppressed"] else next(public_ids, None), cls=f["class"],
            tier=f["tier"], confidence=f["confidence"], claim_a=f["claim_a"], claim_b=f["claim_b"],
            overlap_node=f["overlap_node"], rule_id=f["rule_id"], engine_version=ENGINE_VERSION,
            suppressed=f["suppressed"]))
    return row


def get_report_row(s: Session, report_id: str) -> ReportRow | None:
    row = s.get(ReportRow, report_id)
    if row is None or row.engine_version != ENGINE_VERSION:
        return None  # a report from an older engine has the old payload shape: regenerate, never serve it
    exp = _aware(row.expires_at)
    if exp is not None and exp < _now():
        return None
    return row


def fresh_public_report(s: Session, package: str, *, max_age: timedelta = REPORT_FRESHNESS) -> ReportRow | None:
    onto = load_ontology()
    row = s.scalar(
        select(ReportRow)
        .where(ReportRow.package == package, ReportRow.private.is_(False),
               ReportRow.engine_version == ENGINE_VERSION, ReportRow.ontology_version == onto.version)
        .order_by(ReportRow.created_at.desc())
        .limit(1)
    )
    if row is None:
        return None
    created = _aware(row.created_at)
    if created is not None and _now() - created > max_age:
        return None
    return row


def hidden_finding_ids(s: Session, report_id: str) -> set[str]:
    """Findings under review after a verified dispute are hidden (PLAN.md §8)."""
    rows = s.scalars(select(DisputeRow).where(DisputeRow.report_id == report_id,
                                              DisputeRow.status == "under_review"))
    return {r.finding_id for r in rows if r.finding_id}


def purge_expired(s: Session) -> int:
    now = _now()
    rows = list(s.scalars(select(ReportRow).where(ReportRow.private.is_(True))))
    n = 0
    for r in rows:
        exp = _aware(r.expires_at)
        if exp is not None and exp < now:
            s.execute(delete(FindingRow).where(FindingRow.report_id == r.id))
            s.delete(r)
            n += 1
    return n


# ------------------------------------------------------------------ policy drift


def _snapshot(s: Session, package: str, url: str | None, sha: str, captured: str, last_updated: str | None,
              claims: list[dict[str, Any]]) -> PolicySnapshotRow:
    snap = PolicySnapshotRow(package=package, url=url, content_sha256=sha, captured_at=captured,
                             last_updated_text=last_updated, claims=claims)
    s.add(snap)
    s.flush()
    return snap


def snapshot_diff(s: Session, state: dict[str, Any]) -> dict[str, Any] | None:
    """Store a new policy snapshot when the policy hash changed; return the claim diff vs the previous one."""
    from sahamati_core.pipeline import extract_policy_claims, policy_from_content

    pkg = state["package"]
    pol = state["policy"]
    if pol.get("status") != "ok":
        return None
    existing = list(s.scalars(select(PolicySnapshotRow).where(PolicySnapshotRow.package == pkg)
                              .order_by(PolicySnapshotRow.created_at)))
    if not existing:
        # demo fixtures ship older snapshots so Policy Drift can be shown offline
        for captured, html in demo_policy_history(pkg):
            p = policy_from_content(html, pol.get("url"), captured)
            claims, _, _ = extract_policy_claims(p["text"], url=p["url"], captured_at=captured)
            existing.append(_snapshot(s, pkg, p["url"], p["content_sha256"], captured, p.get("last_updated"),
                                      [c.model_dump(mode="json") for c in claims]))
    if existing and existing[-1].content_sha256 == pol["content_sha256"]:
        return None
    prev = existing[-1] if existing else None
    cur = _snapshot(s, pkg, pol.get("url"), pol["content_sha256"], pol["captured_at"], pol.get("last_updated"),
                    state.get("policy_claims", []))
    if prev is None:
        return None
    d = diff_claims([ClaimTuple.model_validate(c) for c in prev.claims],
                    [ClaimTuple.model_validate(c) for c in cur.claims],
                    old_last_updated=prev.last_updated_text, new_last_updated=cur.last_updated_text)
    return {"from": prev.id, "to": cur.id, "changes": len(d.changes), "silent": d.silent}


def policy_history(s: Session, package: str) -> PolicyHistory:
    snaps = list(s.scalars(select(PolicySnapshotRow).where(PolicySnapshotRow.package == package)
                           .order_by(PolicySnapshotRow.created_at)))
    views = [PolicySnapshotView(snapshot_id=x.id, captured_at=x.captured_at, url=x.url,
                                content_sha256=x.content_sha256, claim_count=len(x.claims or [])) for x in snaps]
    diffs: list[PolicyDiffView] = []
    for a, b in zip(snaps, snaps[1:], strict=False):
        d = diff_claims([ClaimTuple.model_validate(c) for c in a.claims or []],
                        [ClaimTuple.model_validate(c) for c in b.claims or []],
                        old_last_updated=a.last_updated_text, new_last_updated=b.last_updated_text)
        diffs.append(PolicyDiffView(
            from_snapshot=a.id, to_snapshot=b.id, silent=d.silent,
            changes=[ClaimChange(kind=c.kind, actor=c.actor, action=c.action, data_type=c.data_type,
                                 before=c.before, after=c.after) for c in d.changes]))
    return PolicyHistory(package=package, snapshots=views, diffs=diffs)


# ------------------------------------------------------------------ llm calls


def llm_logger(session_factory: Any):  # type: ignore[no-untyped-def]
    def _log(rec: dict[str, Any]) -> None:
        with session_factory() as s:
            s.add(LLMCallRow(model=rec.get("model", ""), request=rec.get("request", {}),
                             response=rec.get("response"), latency_ms=rec.get("latency_ms"),
                             error=rec.get("error")))
            s.commit()
    return _log


# ------------------------------------------------------------------ audit


DEMO_AGGREGATES = AuditAggregate(
    corpus_size=500,
    by_category=[
        AuditCategory(category="Finance", apps=92, strong_rate=0.21, indicative_rate=0.34, gap_rate=0.41, vague_ratio=0.29),
        AuditCategory(category="Education", apps=71, strong_rate=0.14, indicative_rate=0.27, gap_rate=0.38, vague_ratio=0.33),
        AuditCategory(category="Health & Fitness", apps=48, strong_rate=0.19, indicative_rate=0.31, gap_rate=0.44, vague_ratio=0.31),
        AuditCategory(category="Shopping", apps=66, strong_rate=0.17, indicative_rate=0.36, gap_rate=0.47, vague_ratio=0.35),
        AuditCategory(category="Tools", apps=83, strong_rate=0.11, indicative_rate=0.29, gap_rate=0.52, vague_ratio=0.37),
        AuditCategory(category="Other", apps=140, strong_rate=0.13, indicative_rate=0.25, gap_rate=0.39, vague_ratio=0.32),
    ],
    failure_rates=FailureRates(policy_unreachable=0.07, apk_unparseable=0.05),
    is_demo=True,
)


def audit_aggregates(s: Session) -> AuditAggregate:
    """Aggregates over the latest public, non-demo report per app; k>=5 per category cell."""
    rows = list(s.scalars(select(ReportRow).where(ReportRow.private.is_(False), ReportRow.is_demo.is_(False))
                          .order_by(ReportRow.created_at.desc())))
    latest: dict[str, ReportRow] = {}
    for r in rows:
        latest.setdefault(r.package, r)
    if not latest:
        return DEMO_AGGREGATES
    groups: dict[str, list[dict[str, Any]]] = {}
    for r in latest.values():
        groups.setdefault(r.category or "Other", []).append(r.payload)
    merged: dict[str, list[dict[str, Any]]] = {}
    for cat, items in groups.items():
        merged.setdefault(cat if len(items) >= K_ANON else "Other", []).extend(items)
    cats: list[AuditCategory] = []
    for cat, items in sorted(merged.items()):
        if len(items) < K_ANON:
            continue  # even the merged "Other" cell is too small to publish
        n = len(items)
        cats.append(AuditCategory(
            category=cat, apps=n,
            strong_rate=round(sum(1 for p in items if p["summary"]["strong"] > 0) / n, 3),
            indicative_rate=round(sum(1 for p in items if p["summary"]["indicative"] > 0) / n, 3),
            gap_rate=round(sum(1 for p in items if p["summary"]["not_mentioned"] > 0) / n, 3),
            vague_ratio=round(sum(p["summary"]["vague_claim_ratio"] for p in items) / n, 3),
        ))
    allp = [r.payload for r in latest.values()]
    n = len(allp)
    return AuditAggregate(
        corpus_size=n,
        by_category=cats,
        failure_rates=FailureRates(
            policy_unreachable=round(sum(1 for p in allp if p["coverage"]["policy"] == "unreachable") / n, 3),
            apk_unparseable=round(sum(1 for p in allp if p["coverage"]["apk"] in ("unparseable", "obfuscated")) / n, 3),
        ),
        is_demo=False,
    )
