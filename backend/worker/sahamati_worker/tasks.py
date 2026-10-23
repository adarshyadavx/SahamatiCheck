"""Celery chain of the pipeline stages (used when CELERY_EAGER=0).

ingest_listing -> fetch_policy -> map_declaration -> analyse_apk
  -> extract_claims -> detect_conflicts -> snapshot_diff

Each task takes and returns the JSON state dict, and writes progress to the
`jobs` row (the API streams it over SSE). PLAN.md sketches fetch_policy /
map_declaration / analyse_apk as a group; they run sequentially here because a
chord needs a result backend and each stage is fast. Start a worker with:

    REDIS_URL=redis://localhost:6379/0 CELERY_EAGER=0 celery -A sahamati_worker.tasks worker -l info
"""

from __future__ import annotations

import os
from typing import Any

from celery import Celery, chain
from sahamati_core.pipeline import STAGES

from . import runner

BROKER = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
app = Celery("sahamati", broker=BROKER, backend=os.environ.get("CELERY_RESULT_BACKEND"))
app.conf.update(task_serializer="json", accept_content=["json"], result_serializer="json",
                task_always_eager=runner.is_eager(), task_acks_late=True, worker_prefetch_multiplier=1)


def _stage(job_id: str, index: int, state: dict[str, Any]) -> dict[str, Any]:
    name, fn = runner.stage_functions()[index]
    if index == 0:
        runner.mark(job_id, status="running")
    runner.mark(job_id, stage=name, progress=index / len(STAGES))
    try:
        return fn(state)
    except Exception as exc:
        runner.fail(job_id, exc)
        raise


@app.task(name="sahamati.stage")
def stage_task(state: dict[str, Any], job_id: str, index: int) -> dict[str, Any]:
    return _stage(job_id, index, state)


@app.task(name="sahamati.snapshot_diff")
def snapshot_diff_task(state: dict[str, Any], job_id: str) -> str:
    try:
        return runner.finish(job_id, state)
    except Exception as exc:
        runner.fail(job_id, exc)
        raise


def build_chain(job_id: str, package: str):  # type: ignore[no-untyped-def]
    n = len(runner.stage_functions())
    first = stage_task.s({"package": package}, job_id, 0)
    rest = [stage_task.s(job_id, i) for i in range(1, n)]
    return chain(first, *rest, snapshot_diff_task.s(job_id))


def enqueue_pipeline(job_id: str, package: str) -> None:
    build_chain(job_id, package).apply_async()
