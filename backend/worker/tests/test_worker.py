from __future__ import annotations

import sys
import time
import types

import pytest
from sahamati_core.db import JobRow, ReportRow, session_scope
from sahamati_worker import run_check_sync, submit_check, tasks


def test_run_check_sync_persists_report() -> None:
    job_id, rid = run_check_sync("in.example.chaiwallet")
    assert rid == "r_demo_chaiwallet"
    with session_scope() as s:
        job = s.get(JobRow, job_id)
        assert job is not None and job.status == "done" and job.progress == 1.0
        row = s.get(ReportRow, rid)
        assert row is not None and row.payload["summary"]["strong"] >= 2


def test_eager_thread_job() -> None:
    job_id = submit_check("in.example.dosanotes")
    deadline = time.time() + 20
    while time.time() < deadline:
        with session_scope() as s:
            job = s.get(JobRow, job_id)
            if job and job.status in ("done", "error"):
                break
        time.sleep(0.05)
    assert job is not None and job.status == "done", job.error if job else None


def test_error_is_recorded_not_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    # Without the optional `play` extra the listing fetch explains what is missing. Simulate that
    # explicitly: the test must not depend on whether google-play-scraper happens to be installed.
    monkeypatch.setitem(sys.modules, "google_play_scraper", None)
    job_id, rid = run_check_sync("in.example.notademo")
    assert rid is None
    with session_scope() as s:
        job = s.get(JobRow, job_id)
        assert job.status == "error" and "google-play-scraper" in (job.error or "")


def test_listing_failure_is_recorded_not_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    # With the extra installed, a failed fetch (here: the test suite blocks the network) is also an error row.
    fake = types.ModuleType("google_play_scraper")

    def _app(*_a: object, **_k: object) -> dict:
        raise RuntimeError("no network in tests")

    fake.app = _app  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "google_play_scraper", fake)
    job_id, rid = run_check_sync("in.example.notademo")
    assert rid is None
    with session_scope() as s:
        job = s.get(JobRow, job_id)
        assert job.status == "error" and "in.example.notademo" in (job.error or "")


def test_celery_chain_runs_eagerly() -> None:
    tasks.app.conf.task_always_eager = True
    with session_scope() as s:
        job_id = JobRow(package="in.example.chaiwallet")
        s.add(job_id)
        s.flush()
        jid = job_id.id
    result = tasks.build_chain(jid, "in.example.chaiwallet").apply()
    assert result.get() == "r_demo_chaiwallet"
    with session_scope() as s:
        assert s.get(JobRow, jid).status == "done"
