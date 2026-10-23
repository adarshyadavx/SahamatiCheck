from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    cors_origins: list[str]
    cors_origin_regex: str
    checks_per_hour: int
    reads_per_minute: int
    rate_limit_disabled: bool
    trust_proxy: bool
    max_upload_mb: int
    sse_timeout_s: int


def get_settings() -> Settings:
    """Read from the environment on every call (cheap; keeps tests and reloads honest)."""
    origins = os.environ.get("SAHAMATI_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return Settings(
        cors_origins=[o.strip() for o in origins.split(",") if o.strip()],
        # Chrome extension ids are 32 chars a-p; set SAHAMATI_CORS_ORIGIN_REGEX to pin one id in production
        cors_origin_regex=os.environ.get("SAHAMATI_CORS_ORIGIN_REGEX", r"chrome-extension://[a-p]{32}"),
        checks_per_hour=_int("SAHAMATI_RATE_CHECKS_PER_HOUR", 10),
        reads_per_minute=_int("SAHAMATI_RATE_READS_PER_MIN", 120),
        rate_limit_disabled=os.environ.get("SAHAMATI_RATE_LIMIT_DISABLED", "0") == "1",
        trust_proxy=os.environ.get("SAHAMATI_TRUST_PROXY", "0") == "1",
        max_upload_mb=_int("SAHAMATI_MAX_UPLOAD_MB", 150),
        sse_timeout_s=_int("SAHAMATI_SSE_TIMEOUT_S", 180),
    )
