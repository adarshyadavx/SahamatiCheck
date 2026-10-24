"""Worker units: the Celery chain run eagerly, failure messages, and how a job is submitted."""

from __future__ import annotations

import sys
from typing import Any

import pytest
from sahamati_core.db import JobRow, ReportRow, repo, session_scope
from sahamati_core.ingest import IngestError
from sahamati_worker import runner, tasks


def _new_job(package: str) -> str:
    with session_scope() as s:
        return repo.create_job(s, package).id


def _job(job_id: str) -> JobRow:
    with session_scope() as s:
        job = s.get(JobRow, job_id)
        assert job is not None
        s.expunge(job)
        return job


def test_is_eager_reads_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for value, expected in (("1", True), ("true", True), ("0", False), ("false", False), ("No", False)):
        monkeypatch.setenv("CELERY_EAGER", value)
        assert runner.is_eager() is expected
    monkeypatch.delenv("CELERY_EAGER")
    assert runner.is_eager() is True  # default: no Redis needed


def test_the_celery_chain_produces_the_same_report_as_the_inline_runner() -> None:
    inline_job, inline_rid = runner.run_check_sync("in.example.dosanotes")
    job_id = _new_job("in.example.dosanotes")
    result = tasks.build_chain(job_id, "in.example.dosanotes").apply()  # task_always_eager: runs here, no broker
    assert result.get() == inline_rid == "r_demo_dosanotes"
    job = _job(job_id)
    assert (job.status, job.stage, job.progress, job.report_id) == ("done", "done", 1.0, "r_demo_dosanotes")
    assert _job(inline_job).status == "done"
    with session_scope() as s:
        assert s.get(ReportRow, "r_demo_dosanotes") is not None


def test_a_failing_stage_marks_the_job_failed_and_stops_the_chain(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "google_play_scraper", None)
    job_id = _new_job("in.example.notademo")
    with pytest.raises(IngestError):  # eager mode propagates the failure; a real worker would log it
        tasks.build_chain(job_id, "in.example.notademo").apply()
    job = _job(job_id)
    assert job.status == "error" and job.stage == "error" and "play" in (job.error or "").lower()
    assert job.report_id is None


def test_the_snapshot_stage_failure_is_recorded(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_job_id: str, _state: dict[str, Any]) -> str:
        raise RuntimeError("database is on fire")

    monkeypatch.setattr(runner, "finish", boom)
    job_id = _new_job("in.example.dosanotes")
    with pytest.raises(RuntimeError):
        tasks.snapshot_diff_task({"package": "in.example.dosanotes"}, job_id)
    job = _job(job_id)
    assert job.status == "error" and job.error == "pipeline error: RuntimeError"


def test_failure_messages_never_leak_internals() -> None:
    job_id = _new_job("in.example.x")
    runner.fail(job_id, IngestError("Play listing unavailable for in.example.x"))  # user-facing: kept verbatim
    assert _job(job_id).error == "Play listing unavailable for in.example.x"
    runner.fail(job_id, ValueError("secret path /etc/passwd"))  # anything else: the type only
    assert _job(job_id).error == "pipeline error: ValueError"


def test_the_stage_list_is_the_documented_order() -> None:
    names = [n for n, _ in runner.stage_functions()]
    assert names == ["ingest_listing", "fetch_policy", "map_declaration", "analyse_apk", "extract_claims",
                     "detect_conflicts"]


def test_the_llm_fallback_is_off_without_an_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert runner._llm() is None
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    assert runner._llm() is not None  # constructed, but no call is made until a hard sentence needs it


def test_without_eager_mode_a_job_goes_to_the_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple[str, str]] = []
    monkeypatch.setenv("CELERY_EAGER", "0")
    monkeypatch.setattr(tasks, "enqueue_pipeline", lambda job_id, pkg: sent.append((job_id, pkg)))
    job_id = runner.submit_check("in.example.dosanotes")
    assert sent == [(job_id, "in.example.dosanotes")]
    assert _job(job_id).status == "queued"  # nothing ran inline
