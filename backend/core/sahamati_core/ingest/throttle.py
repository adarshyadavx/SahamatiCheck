"""Token bucket for Play listing fetches: 1 request per 2 s globally (PLAN.md §4.5).

Uses Redis when REDIS_URL is set and the `redis` package is installed, so all
workers share one bucket; otherwise an in-process bucket.
"""

from __future__ import annotations

import os
import threading
import time


class TokenBucket:
    def __init__(self, rate_per_s: float = 0.5, capacity: int = 1) -> None:
        self.rate = rate_per_s
        self.capacity = capacity
        self.tokens = float(capacity)
        self.updated = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self, *, block: bool = True, timeout: float = 30.0) -> bool:
        deadline = time.monotonic() + timeout
        while True:
            with self.lock:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return True
                wait = (1 - self.tokens) / self.rate
            if not block or time.monotonic() + wait > deadline:
                return False
            time.sleep(wait)


class RedisTokenBucket:
    """Fixed-interval limiter shared across processes (SET NX PX)."""

    def __init__(self, url: str, key: str = "sahamati:play_bucket", interval_ms: int = 2000) -> None:
        import redis  # type: ignore[import-not-found]

        self.r = redis.Redis.from_url(url)
        self.key = key
        self.interval_ms = interval_ms

    def acquire(self, *, block: bool = True, timeout: float = 30.0) -> bool:
        deadline = time.monotonic() + timeout
        while True:
            if self.r.set(self.key, "1", nx=True, px=self.interval_ms):
                return True
            if not block or time.monotonic() > deadline:
                return False
            time.sleep(0.2)


_bucket: TokenBucket | RedisTokenBucket | None = None
_lock = threading.Lock()


def play_bucket() -> TokenBucket | RedisTokenBucket:
    global _bucket
    with _lock:
        if _bucket is None:
            url = os.environ.get("REDIS_URL")
            if url:
                try:
                    _bucket = RedisTokenBucket(url)
                except Exception:  # noqa: BLE001 - redis optional
                    _bucket = TokenBucket()
            else:
                _bucket = TokenBucket()
        return _bucket
