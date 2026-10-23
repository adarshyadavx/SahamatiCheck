"""Shared pytest setup: isolated SQLite DB, no rate limits, no LLM key, no network."""

from __future__ import annotations

import os
import socket
import tempfile

import pytest

_TMP = tempfile.mkdtemp(prefix="sahamati-test-")
os.environ["SAHAMATI_DATA_DIR"] = _TMP
# Tests use a fresh SQLite file unless SAHAMATI_TEST_DATABASE_URL points at a disposable database (CI Postgres).
if os.environ.get("SAHAMATI_TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["SAHAMATI_TEST_DATABASE_URL"]
else:
    os.environ.pop("DATABASE_URL", None)
os.environ["SAHAMATI_RATE_LIMIT_DISABLED"] = "1"
os.environ["CELERY_EAGER"] = "1"
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("REDIS_URL", None)

_real_connect = socket.socket.connect


def _guarded_connect(self, address):  # type: ignore[no-untyped-def]
    host = address[0] if isinstance(address, tuple) else address
    if isinstance(host, str) and host not in ("127.0.0.1", "localhost", "::1") and not host.startswith("/"):
        raise RuntimeError(f"tests must not use the network (tried {address!r})")
    return _real_connect(self, address)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket.socket, "connect", _guarded_connect)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
