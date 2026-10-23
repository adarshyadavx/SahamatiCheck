"""Simple in-process per-IP sliding-window rate limiter (no accounts; PLAN.md §4.6).

Buckets: "checks" (new, uncached checks; 10/hour) and "reads" (120/min).
Multi-process deployments should front this with the reverse proxy's limiter.
"""

from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import HTTPException, Request

from .settings import get_settings


class SlidingWindow:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, bucket: str, key: str, limit: int, window_s: float) -> float | None:
        """Record a hit. Returns None if allowed, else seconds until a slot frees up."""
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault((bucket, key), deque())
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                return max(1.0, window_s - (now - q[0]))
            q.append(now)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindow()


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce(request: Request, bucket: str) -> None:
    st = get_settings()
    if st.rate_limit_disabled:
        return
    limit, window = (st.checks_per_hour, 3600.0) if bucket == "checks" else (st.reads_per_minute, 60.0)
    wait = limiter.hit(bucket, client_ip(request), limit, window)
    if wait is not None:
        raise HTTPException(status_code=429, detail=f"rate limit exceeded for {bucket}",
                            headers={"Retry-After": str(int(wait))})
