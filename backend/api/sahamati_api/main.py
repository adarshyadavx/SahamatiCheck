"""FastAPI app. Run: cd backend && .venv/bin/uvicorn sahamati_api.main:app --reload --port 8000"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sahamati_core import ENGINE_VERSION, EXTRACTOR_VERSION
from sahamati_core.db import get_engine, repo, session_scope
from sahamati_core.ontology import load_ontology
from sahamati_core.rules import load_registry
from sahamati_core.rules.registry import current_lock

from .routes.v1 import router as v1_router
from .settings import get_settings

log = logging.getLogger("sahamati.api")

API_SCHEMA = "1"  # bump when the report JSON changes shape incompatibly; clients warn on a mismatch


def _git_sha() -> str:
    """Build identity: SAHAMATI_GIT_SHA (set at image build) or the checkout's HEAD, else "unknown"."""
    sha = os.environ.get("SAHAMATI_GIT_SHA", "").strip()
    if sha:
        return sha
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=Path(__file__).resolve().parent,
                             capture_output=True, text=True, timeout=3, check=False)
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


GIT_SHA = _git_sha()

DESCRIPTION = """
SahamatiCheck compares an Android app's privacy policy, its Play data-safety
declaration and its APK, and reports where they appear inconsistent, with
evidence from both sides. Automated static analysis: it may be wrong, it is a
snapshot at a version and date, it is not legal advice, and it is not
affiliated with Google.
"""


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    load_ontology()  # fail fast on an invalid ontology
    get_engine()
    try:
        with session_scope() as s:
            n = repo.purge_expired(s)
            if n:
                log.info("purged %d expired self-check reports", n)
    except Exception:  # noqa: BLE001
        log.exception("startup purge failed")
    yield


def create_app() -> FastAPI:
    st = get_settings()
    app = FastAPI(title="SahamatiCheck API", version="1.0.0", description=DESCRIPTION, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=st.cors_origins,
        allow_origin_regex=st.cors_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["ETag", "Retry-After", "Location"],
    )
    app.include_router(v1_router)

    @app.get("/healthz", tags=["meta"])
    def healthz() -> dict[str, object]:
        return {"status": "ok", "versions": {"engine": ENGINE_VERSION, "ontology": load_ontology().version,
                                             "extractor": EXTRACTOR_VERSION}}

    @app.get("/version", tags=["meta"], summary="Which build is this? Clients warn when it is stale")
    @app.get("/v1/version", tags=["meta"], include_in_schema=False)
    def version() -> dict[str, object]:
        reg = load_registry()
        return {"git_sha": GIT_SHA, "api_schema": API_SCHEMA, "engine": ENGINE_VERSION,
                "ontology": load_ontology().version, "extractor": EXTRACTOR_VERSION,
                "registry_digest": hashlib.sha256(json.dumps(current_lock(reg), sort_keys=True).encode()).hexdigest()[:12], "rule_count": len(reg.rules)}

    return app


app = create_app()
