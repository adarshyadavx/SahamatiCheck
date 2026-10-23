"""Public API v1 (PLAN.md §4.6). Clients are display-only: every route returns
contract JSON produced by sahamati_core."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import tempfile
from collections.abc import AsyncIterator, Iterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from sahamati_core.db import DisputeRow, FeedbackRow, JobRow, repo, session_scope
from sahamati_core.ingest import IngestError, demo_dir, demo_packages, normalise_package
from sahamati_core.ontology import load_ontology
from sahamati_core.pipeline import analyse_inputs, demo_report_id
from sahamati_core.policy import ExtractContext, RuleExtractor, split_sentences, vague_claim_ratio
from sahamati_core.report import hide_findings, relocalise, tuple_view
from sahamati_core.report_card import ReportFacts
from sahamati_core.rules import RuleInfo, load_registry
from sahamati_core.schema import (
    AuditAggregate,
    CheckJobResponse,
    CheckReportResponse,
    CheckRequest,
    DisputeRequest,
    DisputeResponse,
    FeedbackRequest,
    Job,
    JobStatus,
    Ontology,
    OntologyNode,
    PolicyHistory,
    PolicySegment,
    PolicySegmentsRequest,
    PolicySegmentsResponse,
    Report,
    SelfCheckResponse,
)
from sahamati_worker import run_check_sync, submit_check
from sqlalchemy.orm import Session

from ..ratelimit import enforce
from ..settings import get_settings

router = APIRouter(prefix="/v1")

NOINDEX = {"X-Robots-Tag": "noindex, nofollow"}


def db() -> Iterator[Session]:
    with session_scope() as s:
        yield s


DB = Annotated[Session, Depends(db)]


# ------------------------------------------------------------------ helpers


def _facts(raw: dict[str, Any] | None) -> ReportFacts | None:
    return ReportFacts.model_validate(raw) if raw else None


def _public_payload(s: Session, payload: dict[str, Any], facts: dict[str, Any] | None = None) -> dict[str, Any]:
    """Hide findings under review after a verified dispute; the summary, card and rule runs follow."""
    hidden = repo.hidden_finding_ids(s, payload["report_id"])
    if not hidden:
        return payload
    return hide_findings(Report.model_validate(payload), hidden, facts=_facts(facts)).model_dump(mode="json")


def _localised(payload: dict[str, Any], hl: str | None, facts: dict[str, Any] | None = None) -> dict[str, Any]:
    if hl and hl.lower().startswith("hi"):
        return relocalise(Report.model_validate(payload), "hi", facts=_facts(facts)).model_dump(mode="json")
    return payload


def _report_response(request: Request, s: Session, row: Any, hl: str | None) -> Response:
    payload = _localised(_public_payload(s, row.payload, row.facts), hl, row.facts)
    etag = f'"{row.etag}{"-hi" if hl and hl.startswith("hi") else ""}"'
    headers = {**NOINDEX, "ETag": etag, "Cache-Control": "private, max-age=300"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(content=payload, headers=headers)


def _run_demo_now(package: str) -> str:
    _job_id, rid = run_check_sync(package)
    if rid is None:
        raise HTTPException(status_code=500, detail="demo pipeline failed")
    return rid


def _demo_package_for_report_id(report_id: str) -> str | None:
    for pkg in demo_packages():
        if demo_report_id(pkg) == report_id:
            return pkg
    return None


# ------------------------------------------------------------------ checks & jobs


@router.post(
    "/checks",
    responses={200: {"model": CheckReportResponse}, 202: {"model": CheckJobResponse}},
    summary="Start a check (200 cached report, or 202 job)",
)
def create_check(body: CheckRequest, request: Request, s: DB,
                 wait: Annotated[bool, Query(description="run inline and return 200 with the report")] = False
                 ) -> Response:
    try:
        package = normalise_package(body.package_name, body.play_url)
    except IngestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row = repo.fresh_public_report(s, package)
    if row is not None:
        enforce(request, "reads")
        resp = CheckReportResponse(report=Report.model_validate(_public_payload(s, row.payload, row.facts)))
        return JSONResponse(content=resp.model_dump(mode="json"), headers=NOINDEX)
    if not demo_dir(package):
        enforce(request, "checks")  # demo fixtures run offline and are exempt
    if wait:
        s.commit()
        job_id, rid = run_check_sync(package)
        if rid is None:
            with session_scope() as s2:
                job = s2.get(JobRow, job_id)
                err = job.error if job else "pipeline error"
            raise HTTPException(status_code=422, detail=err)
        with session_scope() as s2:
            r = repo.get_report_row(s2, rid)
            payload = _public_payload(s2, r.payload, r.facts) if r else None
        resp = CheckReportResponse(report=Report.model_validate(payload))
        return JSONResponse(content=resp.model_dump(mode="json"), headers=NOINDEX)
    s.commit()
    job_id = submit_check(package)
    jr = CheckJobResponse(job_id=job_id, status_url=f"/v1/jobs/{job_id}", events_url=f"/v1/jobs/{job_id}/events")
    return JSONResponse(status_code=202, content=jr.model_dump(mode="json"),
                        headers={"Location": jr.status_url, "Retry-After": "1"})


@router.get("/jobs/{job_id}", response_model=Job)
def get_job(job_id: str, request: Request, response: Response, s: DB) -> Job:
    enforce(request, "reads")
    job = s.get(JobRow, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    view = repo.job_view(job)
    if view.status in (JobStatus.QUEUED, JobStatus.RUNNING):
        response.headers["Retry-After"] = "1"
    return view


@router.get("/jobs/{job_id}/events", summary="Server-sent events: progress, then done|error")
async def job_events(job_id: str) -> StreamingResponse:
    with session_scope() as s:
        if s.get(JobRow, job_id) is None:
            raise HTTPException(status_code=404, detail="job not found")
    timeout = get_settings().sse_timeout_s

    def snapshot() -> Job | None:
        with session_scope() as s:
            job = s.get(JobRow, job_id)
            return repo.job_view(job) if job else None

    async def gen() -> AsyncIterator[bytes]:
        last: str | None = None
        waited = 0.0
        yield b"retry: 1000\n\n"
        while waited < timeout:
            view = await asyncio.to_thread(snapshot)
            if view is None:
                break
            data = view.model_dump_json()
            if data != last:
                last = data
                yield f"event: progress\ndata: {data}\n\n".encode()
            if view.status == JobStatus.DONE:
                yield f"event: done\ndata: {data}\n\n".encode()
                return
            if view.status == JobStatus.ERROR:
                yield f"event: error\ndata: {data}\n\n".encode()
                return
            await asyncio.sleep(0.25)
            waited += 0.25
            if int(waited * 4) % 60 == 0:
                yield b": keep-alive\n\n"
        yield b'event: error\ndata: {"error": "timeout"}\n\n'

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ reports


@router.get("/apps/{package}/report", response_model=Report, summary="Latest public report for a package (ETag)")
def app_report(package: str, request: Request, s: DB,
               version: int | None = None, hl: str | None = None) -> Response:
    enforce(request, "reads")
    try:
        package = normalise_package(package)
    except IngestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row = repo.fresh_public_report(s, package, max_age=repo.REPORT_FRESHNESS * 365)
    if row is not None and version is not None and row.payload["app"]["version_code"] != version:
        row = None
    if row is None and demo_dir(package):
        s.commit()
        rid = _run_demo_now(package)
        s.expire_all()
        row = repo.get_report_row(s, rid)
    if row is None:
        raise HTTPException(status_code=404, detail="no report yet; POST /v1/checks to start one")
    return _report_response(request, s, row, hl)


@router.get("/reports/{report_id}", response_model=Report,
            summary="A report by id (EXTENSION: used by the web /r/[id] page)")
def report_by_id(report_id: str, request: Request, s: DB, hl: str | None = None) -> Response:
    enforce(request, "reads")
    row = repo.get_report_row(s, report_id)
    if row is None:
        pkg = _demo_package_for_report_id(report_id)
        if pkg:
            s.commit()
            _run_demo_now(pkg)
            s.expire_all()
            row = repo.get_report_row(s, report_id)
    if row is None:
        raise HTTPException(status_code=404, detail="report not found or expired")
    return _report_response(request, s, row, hl)


@router.get("/apps/{package}/policy-history", response_model=PolicyHistory,
            summary="Policy snapshots and semantic claim diffs (Policy Drift)")
def app_policy_history(package: str, request: Request, s: DB) -> PolicyHistory:
    enforce(request, "reads")
    try:
        package = normalise_package(package)
    except IngestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    hist = repo.policy_history(s, package)
    if not hist.snapshots and demo_dir(package):
        s.commit()
        _run_demo_now(package)
        s.expire_all()
        hist = repo.policy_history(s, package)
    return hist


# ------------------------------------------------------------------ policy segments (extension highlighter)


@router.post("/policy/segments", response_model=PolicySegmentsResponse)
def policy_segments(body: PolicySegmentsRequest, request: Request) -> PolicySegmentsResponse:
    enforce(request, "reads")
    ex = RuleExtractor()
    ctx = ExtractContext(source_id="segments", url=body.url)
    results = [ex.extract_sentence(sent, ctx=ctx) for sent in split_sentences(body.text)]
    segments = [
        PolicySegment(char_start=r.sentence.start, char_end=r.sentence.end, text=r.sentence.text,
                      tuples=[tuple_view(t) for t in r.tuples], vague=r.vague, confidence=r.confidence)
        for r in results if r.tuples
    ]
    return PolicySegmentsResponse(segments=segments, vague_claim_ratio=vague_claim_ratio(results))


# ------------------------------------------------------------------ self-check


_SELF_CHECK_FIELDS: dict[str, dict[str, Any]] = {
    "package_name": {"type": "string", "description": "your app's package name"},
    "app_title": {"type": "string"},
    "policy_text": {"type": "string", "description": "policy as text or HTML"},
    "policy": {"type": "string", "format": "binary", "description": "policy .html or .txt file"},
    "policy_url": {"type": "string", "description": "fetched with robots.txt respected"},
    "data_safety": {"type": "string", "description": "sahamati.data_safety/v1 JSON, as a file or a text field"},
    "apk": {"type": "string", "format": "binary", "description": ".apk (needs the optional androguard extra)"},
    "manifest": {"type": "string", "format": "binary", "description": "plain-text AndroidManifest.xml"},
    "classes": {"type": "string", "format": "binary", "description": "classes.txt, one class or package per line"},
    "owner_confirmed": {"type": "string", "description": "'true' when the uploader owns the app"},
}


async def _form_text(value: Any, name: str, limit_mb: int = 5) -> str | None:
    """A multipart value may arrive as a text field or a file; return its text."""
    if value is None:
        return None
    if isinstance(value, str):
        return value or None
    data = await value.read(limit_mb * 1024 * 1024 + 1)
    if len(data) > limit_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"{name} is larger than {limit_mb} MB")
    return data.decode("utf-8", errors="replace") or None


@router.post(
    "/self-check", response_model=SelfCheckResponse,
    summary="Developer self-check (multipart). Private result, deleted after 30 days.",
    openapi_extra={"requestBody": {"required": True, "content": {"multipart/form-data": {
        "schema": {"type": "object", "properties": _SELF_CHECK_FIELDS}}}}},
)
async def self_check(request: Request) -> JSONResponse:
    enforce(request, "checks")
    try:
        form = await request.form(max_part_size=get_settings().max_upload_mb * 1024 * 1024)
    except Exception as exc:  # noqa: BLE001 - malformed multipart
        raise HTTPException(status_code=422, detail=f"expected multipart/form-data: {exc}") from exc
    try:
        pkg = normalise_package(await _form_text(form.get("package_name"), "package_name") or "unknown.selfcheck.app")
    except IngestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    app_title = await _form_text(form.get("app_title"), "app_title")
    policy_url = await _form_text(form.get("policy_url"), "policy_url")
    pol = await _form_text(form.get("policy_text"), "policy_text") or await _form_text(form.get("policy"), "policy")
    ds_raw = await _form_text(form.get("data_safety"), "data_safety") or await _form_text(
        form.get("data_safety_json"), "data_safety_json")
    ds: dict[str, Any] | None = None
    if ds_raw:
        try:
            ds = json.loads(ds_raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"data_safety is not valid JSON: {exc}") from exc
        if not isinstance(ds, dict):
            raise HTTPException(status_code=422, detail="data_safety must be a JSON object")
    manifest_xml = await _form_text(form.get("manifest"), "manifest")
    classes_txt = await _form_text(form.get("classes"), "classes")
    apk = form.get("apk")
    if isinstance(apk, str):
        apk = None
    if not any([pol, policy_url, ds, apk, manifest_xml]):
        raise HTTPException(status_code=422, detail="provide at least one source: policy, data_safety, apk or manifest")

    apk_path: str | None = None
    try:
        if apk is not None:
            limit = get_settings().max_upload_mb * 1024 * 1024
            fd, apk_path = tempfile.mkstemp(suffix=".apk")
            size = 0
            with os.fdopen(fd, "wb") as out:
                while chunk := await apk.read(1024 * 1024):
                    size += len(chunk)
                    if size > limit:
                        raise HTTPException(status_code=413, detail="APK too large")
                    out.write(chunk)
        report_id = "r_sc_" + secrets.token_urlsafe(12)
        result = await asyncio.to_thread(
            analyse_inputs, package=pkg, report_id=report_id, title=app_title, policy_content=pol,
            policy_url=policy_url, data_safety=ds, manifest_xml=manifest_xml, classes_txt=classes_txt,
            apk_path=apk_path)
    finally:
        if apk_path and os.path.exists(apk_path):
            os.unlink(apk_path)  # the APK itself is never stored

    with session_scope() as s:
        repo.purge_expired(s)
        row = repo.persist_state(s, result.state, private=True)
        expires = row.expires_at.strftime("%Y-%m-%dT%H:%M:%SZ") if row.expires_at else ""
    resp = SelfCheckResponse(report=result.report, suppressed_findings=result.suppressed, private=True,
                             expires_at=expires)
    return JSONResponse(content=resp.model_dump(mode="json"), headers={**NOINDEX, "Cache-Control": "no-store"})


# ------------------------------------------------------------------ rules


@router.get("/rules", response_model=list[RuleInfo], summary="The rule registry (EXTENSION of the contract)")
def list_rules(request: Request, response: Response,
               family: Annotated[str | None, Query(description="P, D, T, A, C, S or AI")] = None) -> list[RuleInfo]:
    enforce(request, "reads")
    if family is not None and family not in ("P", "D", "T", "A", "C", "S", "AI"):
        raise HTTPException(status_code=422, detail="family must be one of P, D, T, A, C, S, AI")
    response.headers["Cache-Control"] = "public, max-age=3600"
    return load_registry().info(family)


# ------------------------------------------------------------------ ontology


def _ontology_view() -> Ontology:
    onto = load_ontology()
    nodes: list[OntologyNode] = []
    for kind in ("data_type", "actor", "purpose"):
        h = onto.hierarchy(kind)  # type: ignore[arg-type]
        for n in h.nodes.values():
            nodes.append(OntologyNode(id=n.id, label_en=n.label_en, label_hi=n.label_hi, parents=list(n.parents),
                                      kind=kind))  # type: ignore[arg-type]
    return Ontology(version=onto.version, nodes=nodes)


@router.get("/ontology", response_model=Ontology)
def ontology(request: Request, response: Response) -> Ontology:
    enforce(request, "reads")
    response.headers["Cache-Control"] = "public, max-age=3600"
    return _ontology_view()


@router.get("/ontology/{version}", response_model=Ontology)
def ontology_version(version: str, request: Request, response: Response) -> Ontology:
    enforce(request, "reads")
    view = _ontology_view()
    if version not in (view.version, "latest"):
        raise HTTPException(status_code=404, detail=f"ontology version {version} not available; current is {view.version}")
    response.headers["Cache-Control"] = "public, max-age=86400"
    return view


# ------------------------------------------------------------------ feedback & disputes


@router.post("/findings/{finding_id}/feedback", status_code=202)
def finding_feedback(finding_id: str, body: FeedbackRequest, request: Request, s: DB) -> dict[str, str]:
    enforce(request, "reads")
    if len(finding_id) > 64:
        raise HTTPException(status_code=422, detail="invalid finding id")
    s.add(FeedbackRow(finding_id=finding_id, report_id=body.report_id, verdict=body.verdict[:32],
                      comment=body.comment))
    return {"status": "received"}


@router.post("/disputes", status_code=201, response_model=DisputeResponse)
def create_dispute(body: DisputeRequest, request: Request, s: DB) -> DisputeResponse:
    enforce(request, "checks")
    if repo.get_report_row(s, body.report_id) is None and not _demo_package_for_report_id(body.report_id):
        raise HTTPException(status_code=404, detail="report not found")
    if "@" not in body.contact_email:
        raise HTTPException(status_code=422, detail="contact_email must be an email address")
    row = DisputeRow(report_id=body.report_id, finding_id=body.finding_id, contact_email=body.contact_email,
                     message=body.message, verification_method=body.verification_method)
    s.add(row)
    s.flush()
    return DisputeResponse(dispute_id=row.id, status=row.status)


# ------------------------------------------------------------------ audit


@router.get("/audit/aggregates", response_model=AuditAggregate)
def audit_aggregates(request: Request, s: DB) -> AuditAggregate:
    enforce(request, "reads")
    return repo.audit_aggregates(s)

