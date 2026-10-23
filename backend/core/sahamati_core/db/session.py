"""Engine/session factory. DATABASE_URL (Postgres in Compose) or SQLite under backend/.data/."""

from __future__ import annotations

import os
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from sahamati_core import package_dir

from .models import Base

_lock = threading.Lock()
_engines: dict[str, Engine] = {}
_factories: dict[str, sessionmaker[Session]] = {}


def default_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        return url
    data_dir = Path(os.environ.get("SAHAMATI_DATA_DIR") or (package_dir().parent.parent / ".data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{data_dir / 'sahamati.db'}"


def get_engine(url: str | None = None) -> Engine:
    u = url or default_url()
    with _lock:
        eng = _engines.get(u)
        if eng is None:
            if u.startswith("sqlite"):
                eng = create_engine(u, connect_args={"check_same_thread": False, "timeout": 30})

                @event.listens_for(eng, "connect")
                def _pragma(dbapi_conn, _rec):  # type: ignore[no-untyped-def]
                    cur = dbapi_conn.cursor()
                    cur.execute("PRAGMA journal_mode=WAL")
                    cur.execute("PRAGMA foreign_keys=ON")
                    cur.close()
            else:
                eng = create_engine(u, pool_pre_ping=True)
            Base.metadata.create_all(eng)
            _add_missing_columns(eng)
            _engines[u] = eng
            _factories[u] = sessionmaker(bind=eng, expire_on_commit=False)
        return eng


# Columns added after the first release. create_all() never alters an existing table, so an
# older database (the SQLite file under backend/.data) gets them here. Nullable and additive only.
_ADDED_COLUMNS: list[tuple[str, str, str]] = [("reports", "facts", "JSON")]


def _add_missing_columns(eng: Engine) -> None:
    insp = inspect(eng)
    for table, column, sql_type in _ADDED_COLUMNS:
        if not insp.has_table(table):
            continue
        if column not in {c["name"] for c in insp.get_columns(table)}:
            with eng.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))


def session_factory(url: str | None = None) -> sessionmaker[Session]:
    u = url or default_url()
    get_engine(u)
    return _factories[u]


@contextmanager
def session_scope(url: str | None = None) -> Iterator[Session]:
    s = session_factory(url)()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def reset_engines() -> None:
    """Test helper: forget cached engines (e.g. after changing DATABASE_URL)."""
    with _lock:
        for e in _engines.values():
            e.dispose()
        _engines.clear()
        _factories.clear()
