"""AndroZoo: the only place public-check APKs come from (CLAUDE.md rule 8; never from Play).

Three parts:

* **Index.** AndroZoo publishes its catalogue as one large CSV (`latest.csv.gz`, several GB). It has
  no "APKs for this package" endpoint, so we build a small local SQLite index once, keeping only
  Google Play entries and, per package, the newest version (highest `vercode`). Columns are found
  by name from the header row, so a reordered or extended CSV still works.

      python -m sahamati_core.ingest.androzoo build-index --csv /path/to/latest.csv.gz
      python -m sahamati_core.ingest.androzoo build-index --download      # fetches the list itself
      python -m sahamati_core.ingest.androzoo lookup in.example.chaiwallet

* **Download.** `GET {base}/api/download?apikey=KEY&sha256=HASH`, streamed to a temporary file with
  a size cap and a SHA-256 check. The API key never appears in logs, errors, reports or the DB.

* **Facts cache.** The APK is analysed and deleted at once; only the extracted facts (permissions,
  class names, version) are cached per SHA-256, so a repeat check does not download it again.

Configuration (environment):
  ANDROZOO_API_KEY     required to download; request access at https://androzoo.uni.lu/access
  ANDROZOO_INDEX       path of the SQLite index (default: <data dir>/androzoo_index.sqlite)
  ANDROZOO_BASE_URL    default https://androzoo.uni.lu
  ANDROZOO_MAX_APK_MB  refuse larger APKs (default 300)
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import sqlite3
import sys
import tempfile
from collections.abc import Callable, Iterable, Iterator
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import IO, Any

DEFAULT_BASE = "https://androzoo.uni.lu"
LIST_PATH = "/static/lists/latest.csv.gz"
PLAY_MARKET = "play.google.com"
REQUIRED_COLUMNS = ("sha256", "pkg_name", "vercode")
_HEX64 = frozenset("0123456789abcdef")


class AndroZooError(RuntimeError):
    """A failure with a short reason code (see SourceNote reasons in packages/contracts)."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


# ------------------------------------------------------------------ configuration


def data_dir() -> Path:
    from sahamati_core import package_dir

    d = Path(os.environ.get("SAHAMATI_DATA_DIR") or (package_dir().parent.parent / ".data"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def api_key() -> str | None:
    key = (os.environ.get("ANDROZOO_API_KEY") or "").strip()
    return key or None


def base_url() -> str:
    return (os.environ.get("ANDROZOO_BASE_URL") or DEFAULT_BASE).rstrip("/")


def index_path() -> Path:
    p = os.environ.get("ANDROZOO_INDEX")
    return Path(p) if p else data_dir() / "androzoo_index.sqlite"


def max_apk_bytes() -> int:
    try:
        mb = int(os.environ.get("ANDROZOO_MAX_APK_MB", "300"))
    except ValueError:
        mb = 300
    return max(1, mb) * 1024 * 1024


def _redact(text: str, key: str | None) -> str:
    return text.replace(key, "***") if key else text


# ------------------------------------------------------------------ index


@dataclass(frozen=True)
class ApkEntry:
    package: str
    version_code: int | None
    sha256: str
    dex_date: str | None = None
    apk_size: int | None = None


_SCHEMA = """
CREATE TABLE IF NOT EXISTS apks (
  pkg_name TEXT PRIMARY KEY,
  vercode  INTEGER,
  sha256   TEXT NOT NULL,
  dex_date TEXT,
  apk_size INTEGER
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""


def _int(x: str | None) -> int | None:
    try:
        return int(x) if x not in (None, "") else None
    except ValueError:
        return None


def iter_play_rows(lines: Iterable[str]) -> Iterator[ApkEntry]:
    """Rows of an AndroZoo list that come from Google Play, read by header name."""
    reader = csv.reader(lines)
    header = next(reader, None)
    if not header:
        raise AndroZooError("index_bad", "the AndroZoo list is empty")
    cols = {name.strip().lower(): i for i, name in enumerate(header)}
    missing = [c for c in REQUIRED_COLUMNS if c not in cols]
    if missing:
        raise AndroZooError("index_bad", f"the AndroZoo list has no column(s) {', '.join(missing)}")
    i_sha, i_pkg, i_ver = cols["sha256"], cols["pkg_name"], cols["vercode"]
    i_mkt, i_date, i_size = cols.get("markets"), cols.get("dex_date"), cols.get("apk_size")
    width = max(cols.values()) + 1
    for row in reader:
        if len(row) < width:
            continue
        if i_mkt is not None and PLAY_MARKET not in row[i_mkt]:
            continue
        sha = row[i_sha].strip().lower()
        pkg = row[i_pkg].strip()
        if len(sha) != 64 or not set(sha) <= _HEX64 or not pkg:
            continue
        yield ApkEntry(package=pkg, version_code=_int(row[i_ver]), sha256=sha,
                       dex_date=row[i_date] if i_date is not None else None,
                       apk_size=_int(row[i_size]) if i_size is not None else None)


def _open_text(path: Path) -> IO[str]:
    raw = path.open("rb")
    head = raw.read(2)
    raw.seek(0)
    stream: IO[bytes] = gzip.GzipFile(fileobj=raw) if head == b"\x1f\x8b" else raw  # type: ignore[assignment]
    return io.TextIOWrapper(stream, encoding="utf-8", errors="replace", newline="")


def build_index(csv_path: Path, out: Path | None = None, *, progress: Callable[[int, int], None] | None = None,
                batch: int = 50_000) -> int:
    """Build (or rebuild) the index from a local `latest.csv[.gz]`. Returns the number of packages kept."""
    out = out or index_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".building")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    try:
        con.executescript(_SCHEMA)
        con.execute("PRAGMA journal_mode=OFF")
        con.execute("PRAGMA synchronous=OFF")
        # keep the newest version per package; ties keep the later row
        upsert = ("INSERT INTO apks(pkg_name, vercode, sha256, dex_date, apk_size) VALUES (?,?,?,?,?) "
                  "ON CONFLICT(pkg_name) DO UPDATE SET vercode=excluded.vercode, sha256=excluded.sha256, "
                  "dex_date=excluded.dex_date, apk_size=excluded.apk_size "
                  "WHERE COALESCE(excluded.vercode, -1) >= COALESCE(apks.vercode, -1)")
        rows: list[tuple[Any, ...]] = []
        seen = 0
        with _open_text(csv_path) as fh:
            for e in iter_play_rows(fh):
                rows.append((e.package, e.version_code, e.sha256, e.dex_date, e.apk_size))
                seen += 1
                if len(rows) >= batch:
                    con.executemany(upsert, rows)
                    rows.clear()
                    if progress:
                        progress(seen, con.execute("SELECT COUNT(*) FROM apks").fetchone()[0])
        if rows:
            con.executemany(upsert, rows)
        kept = int(con.execute("SELECT COUNT(*) FROM apks").fetchone()[0])
        con.execute("INSERT OR REPLACE INTO meta(k, v) VALUES ('source', ?), ('rows', ?)",
                    (csv_path.name, str(seen)))
        con.commit()
    finally:
        con.close()
    os.replace(tmp, out)
    return kept


def download_list(dest: Path, *, chunk: int = 1 << 20) -> Path:
    """Download AndroZoo's public `latest.csv.gz` (no key needed; it is large)."""
    import httpx

    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    with httpx.stream("GET", base_url() + LIST_PATH, timeout=httpx.Timeout(60, connect=15),
                      follow_redirects=True) as r:
        if r.status_code >= 400:
            raise AndroZooError("download_failed", f"the AndroZoo list answered HTTP {r.status_code}")
        with part.open("wb") as fh:
            for block in r.iter_bytes(chunk):
                fh.write(block)
    os.replace(part, dest)
    return dest


def lookup(package: str, *, index: Path | None = None) -> ApkEntry | None:
    """The newest Google Play APK AndroZoo has for this package, or None."""
    p = index or index_path()
    if not p.is_file():
        raise AndroZooError("androzoo_index_missing", "the AndroZoo index has not been built")
    con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    try:
        row = con.execute("SELECT pkg_name, vercode, sha256, dex_date, apk_size FROM apks WHERE pkg_name = ?",
                          (package,)).fetchone()
    finally:
        con.close()
    if row is None:
        return None
    return ApkEntry(package=row[0], version_code=row[1], sha256=row[2], dex_date=row[3], apk_size=row[4])


# ------------------------------------------------------------------ download


def download_apk(sha256: str, dest: Path, *, key: str | None = None, limit: int | None = None) -> Path:
    """Stream one APK to `dest`, checking size and hash. Raises AndroZooError with a reason code."""
    import httpx

    key = key or api_key()
    if not key:
        raise AndroZooError("androzoo_not_configured", "ANDROZOO_API_KEY is not set")
    sha256 = sha256.lower()
    limit = limit or max_apk_bytes()
    digest = hashlib.sha256()
    size = 0
    try:
        with httpx.stream("GET", base_url() + "/api/download", params={"apikey": key, "sha256": sha256},
                          timeout=httpx.Timeout(120, connect=15), follow_redirects=True) as r:
            if r.status_code in (401, 403):
                raise AndroZooError("androzoo_key_rejected", f"AndroZoo refused the API key (HTTP {r.status_code})")
            if r.status_code == 404:
                raise AndroZooError("not_in_corpus", "AndroZoo has no APK with this hash")
            if r.status_code >= 400:
                raise AndroZooError("download_failed", f"AndroZoo answered HTTP {r.status_code}")
            declared = r.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > limit:
                raise AndroZooError("apk_too_large", "the APK is larger than ANDROZOO_MAX_APK_MB")
            with dest.open("wb") as fh:
                for block in r.iter_bytes(1 << 20):
                    size += len(block)
                    if size > limit:
                        raise AndroZooError("apk_too_large", "the APK is larger than ANDROZOO_MAX_APK_MB")
                    digest.update(block)
                    fh.write(block)
    except AndroZooError:
        dest.unlink(missing_ok=True)
        raise
    except Exception as exc:  # noqa: BLE001 - network errors: never echo the URL (it holds the key)
        dest.unlink(missing_ok=True)
        raise AndroZooError("download_failed", _redact(f"download failed: {type(exc).__name__}", key)) from None
    if digest.hexdigest() != sha256:
        dest.unlink(missing_ok=True)
        raise AndroZooError("download_failed", "the downloaded APK does not match its SHA-256")
    return dest


# ------------------------------------------------------------------ facts (download, analyse, delete)


def _facts_cache(sha256: str) -> Path:
    d = data_dir() / "androzoo_facts"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{sha256}.json"


def _facts_to_json(facts: Any) -> str:
    raw = asdict(facts)
    raw["coverage"] = facts.coverage.value
    return json.dumps(raw)


def _facts_from_json(text: str) -> Any:
    from sahamati_core.apk.analyzer import ApkFacts
    from sahamati_core.schema import Coverage

    raw = json.loads(text)
    raw["coverage"] = Coverage(raw["coverage"])
    return ApkFacts(**raw)


def fetch_apk_facts(package: str) -> tuple[ApkEntry, Any]:
    """Look up, download, analyse and delete the newest AndroZoo APK for `package`.

    Returns (entry, ApkFacts). Raises AndroZooError with a reason code when it cannot.
    """
    from sahamati_core.apk.analyzer import facts_from_apk
    from sahamati_core.schema import Coverage

    if not api_key():
        raise AndroZooError("androzoo_not_configured", "ANDROZOO_API_KEY is not set")
    entry = lookup(package)
    if entry is None:
        raise AndroZooError("not_in_corpus", f"AndroZoo has no Google Play APK for {package}")
    cache = _facts_cache(entry.sha256)
    if cache.is_file():
        try:
            return entry, _facts_from_json(cache.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 - a bad cache entry is simply rebuilt
            cache.unlink(missing_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".apk")
    os.close(fd)
    path = Path(tmp)
    try:
        download_apk(entry.sha256, path)
        facts = facts_from_apk(path)
    finally:
        path.unlink(missing_ok=True)  # the APK itself is never kept
    if facts.coverage == Coverage.UNPARSEABLE:
        missing = any("not installed" in n for n in facts.notes)
        raise AndroZooError("apk_reader_missing" if missing else "apk_unparseable",
                            "; ".join(facts.notes) or "the APK could not be read")
    facts.method = "androzoo"
    if facts.package and facts.package != package:
        raise AndroZooError("apk_unparseable", f"the APK is for {facts.package}, not {package}")
    cache.write_text(_facts_to_json(facts), encoding="utf-8")
    return entry, facts


# ------------------------------------------------------------------ CLI


def _cli(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m sahamati_core.ingest.androzoo",
                                 description="Build and query the local AndroZoo index.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build-index", help="build the index from AndroZoo's latest.csv(.gz)")
    src = b.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", type=Path, help="a local latest.csv or latest.csv.gz")
    src.add_argument("--download", action="store_true", help="download latest.csv.gz first (several GB)")
    b.add_argument("--out", type=Path, default=None, help=f"index path (default {index_path()})")
    lk = sub.add_parser("lookup", help="show the APK the index has for a package")
    lk.add_argument("package")
    args = ap.parse_args(argv)

    try:
        if args.cmd == "build-index":
            csv_path = args.csv
            if args.download:
                csv_path = data_dir() / "androzoo_latest.csv.gz"
                print(f"downloading {base_url()}{LIST_PATH} -> {csv_path} (this is large) …", flush=True)
                download_list(csv_path)
            if not csv_path.is_file():
                print(f"no such file: {csv_path}", file=sys.stderr)
                return 2

            def progress(rows: int, pkgs: int) -> None:
                print(f"\r  {rows:,} Play rows read, {pkgs:,} packages", end="", flush=True)

            kept = build_index(csv_path, args.out, progress=progress)
            print(f"\nindex ready: {kept:,} packages -> {args.out or index_path()}")
            return 0
        entry = lookup(args.package)
        if entry is None:
            print(f"{args.package}: not in the AndroZoo index")
            return 1
        print(json.dumps(asdict(entry), indent=2))
        return 0
    except AndroZooError as exc:
        print(f"error ({exc.reason}): {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(_cli())
