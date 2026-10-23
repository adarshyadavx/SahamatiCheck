"""Job runner. CELERY_EAGER=1 (the dev default) runs the pipeline inline in a
background thread, so no Redis is needed. Otherwise the Celery chain in
`tasks.py` runs it on a worker. Progress is written to the `jobs` row after
every stage; the API's SSE endpoint streams those updates.
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from typing import Any

from sahamati_core.db import repo, session_scope
from sahamati_core.ingest import IngestError
from sahamati_core.nlp.llm_fallback import LLMFallback
from sahamati_core.pipeline import (
    STAGES,
    stage_analyse_apk,
    stage_detect_conflicts,
    stage_extract_claims,
    stage_fetch_policy,
    stage_ingest_listing,
    stage_map_declaration,
)

log = logging.getLogger("sahamati.worker")

StageFn = Callable[[dict[str, Any]], dict[str, Any]]


def is_eager() -> bool:
    return os.environ.get("CELERY_EAGER", "1").lower() not in ("0", "false", "no")


def _llm() -> LLMFallback | None:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    from sahamati_core.db import session_factory

    return LLMFallback(log_call=repo.llm_logger(session_factory()))


def stage_functions() -> list[tuple[str, StageFn]]:
    llm = _llm()
    return [
        ("ingest_listing", stage_ingest_listing),
        ("fetch_policy", stage_fetch_policy),
        ("map_declaration", stage_map_declaration),
        ("analyse_apk", stage_analyse_apk),
        ("extract_claims", lambda s: stage_extract_claims(s, llm=llm)),
        ("detect_conflicts", stage_detect_conflicts),
    ]


def mark(job_id: str, **fields: Any) -> None:
    with session_scope() as s:
        repo.update_job(s, job_id, **fields)


def finish(job_id: str, state: dict[str, Any]) -> str:
    """snapshot_diff + persist; returns report_id."""
    mark(job_id, stage="snapshot_diff", progress=(len(STAGES) - 1) / len(STAGES))
    with session_scope() as s:
        repo.snapshot_diff(s, state)
        row = repo.persist_state(s, state)
        rid = row.id
    mark(job_id, status="done", stage="done", progress=1.0, report_id=rid)
    return rid


def fail(job_id: str, exc: BaseException) -> None:
    msg = str(exc) if isinstance(exc, IngestError) else f"pipeline error: {type(exc).__name__}"
    if not isinstance(exc, IngestError):
        log.exception("job %s failed", job_id)
    mark(job_id, status="error", stage="error", error=msg)


def run_job(job_id: str, package: str) -> str | None:
    """Run every stage inline, updating the job row. Never raises."""
    state: dict[str, Any] = {"package": package}
    try:
        mark(job_id, status="running")
        for i, (name, fn) in enumerate(stage_functions()):
            mark(job_id, stage=name, progress=i / len(STAGES))
            state = fn(state)
        return finish(job_id, state)
    except Exception as exc:  # noqa: BLE001
        fail(job_id, exc)
        return None


def submit_check(package: str) -> str:
    """Create a job and start it. Returns job_id immediately."""
    with session_scope() as s:
        job_id = repo.create_job(s, package).id
    if is_eager():
        t = threading.Thread(target=run_job, args=(job_id, package), name=f"job-{job_id}", daemon=True)
        t.start()
    else:
        from .tasks import enqueue_pipeline

        enqueue_pipeline(job_id, package)
    return job_id


def run_check_sync(package: str) -> tuple[str, str | None]:
    """Create a job and run it in the calling thread (used by ?wait=true and the demo fallback)."""
    with session_scope() as s:
        job_id = repo.create_job(s, package).id
    return job_id, run_job(job_id, package)
