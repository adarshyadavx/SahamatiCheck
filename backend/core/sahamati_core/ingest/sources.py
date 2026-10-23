"""Source acquisition: demo fixtures, Play listing (throttled), policy fetch, AndroZoo stub.

* Demo apps (`sahamati_core/demo/fixtures/<package>/`) are served fully offline.
* Play listing: `google-play-scraper` (optional extra `play`), behind the global
  token bucket (1 request / 2 s). Never fetches APKs from Play.
* Policy: httpx + tenacity retries, honest User-Agent, robots.txt respected.
* AndroZoo: stub client that reads ANDROZOO_API_KEY; downloads are not wired yet.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib import robotparser
from urllib.parse import parse_qs, urlparse

from sahamati_core import demo_fixtures_dir

from .throttle import play_bucket

USER_AGENT = "SahamatiCheck/0.1 (+https://sahamaticheck.example/about; academic privacy research)"
PACKAGE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$")


class IngestError(RuntimeError):
    pass


@dataclass
class Listing:
    package: str
    title: str
    developer: str | None = None
    category: str | None = None
    policy_url: str | None = None
    version_code: int | None = None
    is_demo: bool = False
    captured_at: str = ""
    data_safety: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def normalise_package(package_name: str | None = None, play_url: str | None = None) -> str:
    pkg = (package_name or "").strip()
    if not pkg and play_url:
        u = urlparse(play_url.strip())
        if u.netloc and u.netloc not in ("play.google.com", "market.android.com"):
            raise IngestError("play_url must be a play.google.com link")
        pkg = (parse_qs(u.query).get("id") or [""])[0]
    if not pkg or not PACKAGE_RE.match(pkg) or len(pkg) > 200:
        raise IngestError("a valid Android package name is required (e.g. in.example.chaiwallet)")
    return pkg


# ------------------------------------------------------------------ demo fixtures


def demo_dir(package: str) -> Path | None:
    d = demo_fixtures_dir() / package
    return d if d.is_dir() and (d / "listing.json").is_file() else None


def demo_packages() -> list[str]:
    root = demo_fixtures_dir()
    return sorted(p.name for p in root.iterdir() if (p / "listing.json").is_file()) if root.is_dir() else []


def demo_listing(package: str) -> Listing:
    d = demo_dir(package)
    if d is None:
        raise IngestError(f"no demo fixture for {package}")
    meta = json.loads((d / "listing.json").read_text(encoding="utf-8"))
    ds_path = d / "data_safety.json"
    return Listing(
        package=package,
        title=meta.get("title", package),
        developer=meta.get("developer"),
        category=meta.get("category"),
        policy_url=meta.get("policy_url"),
        is_demo=bool(meta.get("is_demo", True)),
        captured_at=meta.get("captured_at", ""),
        data_safety=json.loads(ds_path.read_text(encoding="utf-8")) if ds_path.is_file() else None,
    )


# ------------------------------------------------------------------ Play listing


def fetch_play_listing(package: str, *, lang: str = "en", country: str = "in") -> Listing:
    try:
        from google_play_scraper import app as gps_app  # type: ignore[import-not-found]
    except ImportError as exc:
        raise IngestError(
            "Play listing fetch needs the optional 'play' extra (google-play-scraper); "
            "only the fabricated demo apps work offline"
        ) from exc
    if not play_bucket().acquire(timeout=30):
        raise IngestError("Play fetch throttled; try again shortly")
    try:
        raw = gps_app(package, lang=lang, country=country)
    except Exception as exc:  # noqa: BLE001
        raise IngestError(f"Play listing unavailable for {package}: {type(exc).__name__}") from exc
    vc = raw.get("versionCode") if isinstance(raw.get("versionCode"), int) else None
    return Listing(
        package=package,
        title=str(raw.get("title") or package),
        developer=raw.get("developer"),
        category=raw.get("genre"),
        policy_url=raw.get("privacyPolicy"),
        version_code=vc,
        is_demo=False,
        # the python scraper does not expose the data-safety section; when a
        # scraper adds it, convert with declaration.from_play_scraper()
        data_safety=None,
    )


def get_listing(package: str) -> Listing:
    return demo_listing(package) if demo_dir(package) else fetch_play_listing(package)


# ------------------------------------------------------------------ policy


@dataclass
class FetchedPolicy:
    url: str | None
    content: str
    content_type: str
    status: str  # ok | unreachable | blocked | unparseable


def _robots_allows(url: str) -> bool:
    import httpx

    u = urlparse(url)
    rp = robotparser.RobotFileParser()
    try:
        r = httpx.get(f"{u.scheme}://{u.netloc}/robots.txt", headers={"User-Agent": USER_AGENT}, timeout=5)
        if r.status_code >= 400:
            return True
        rp.parse(r.text.splitlines())
        return rp.can_fetch(USER_AGENT, url)
    except Exception:  # noqa: BLE001 - unreachable robots.txt does not block
        return True


def fetch_policy(url: str) -> FetchedPolicy:
    import httpx
    from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

    if not url.startswith(("http://", "https://")):
        return FetchedPolicy(url, "", "", "unreachable")
    if not _robots_allows(url):
        return FetchedPolicy(url, "", "", "blocked")

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, max=4),
           retry=retry_if_exception_type(httpx.TransportError), reraise=True)
    def _get() -> httpx.Response:
        return httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=15, follow_redirects=True)

    try:
        r = _get()
    except Exception:  # noqa: BLE001
        return FetchedPolicy(url, "", "", "unreachable")
    if r.status_code >= 400:
        return FetchedPolicy(url, "", "", "unreachable")
    ctype = r.headers.get("content-type", "")
    if "pdf" in ctype:
        try:
            import io

            from pypdf import PdfReader  # type: ignore[import-not-found]

            text = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(r.content)).pages)
            return FetchedPolicy(url, text, "text/plain", "ok" if text.strip() else "unparseable")
        except Exception:  # noqa: BLE001
            return FetchedPolicy(url, "", ctype, "unparseable")
    return FetchedPolicy(url, r.text, ctype, "ok")


def demo_policy(package: str) -> FetchedPolicy:
    d = demo_dir(package)
    lst = demo_listing(package)
    p = d / "policy.html" if d else None
    if not p or not p.is_file():
        return FetchedPolicy(lst.policy_url, "", "", "unreachable")
    return FetchedPolicy(lst.policy_url, p.read_text(encoding="utf-8"), "text/html", "ok")


def demo_policy_history(package: str) -> list[tuple[str, str]]:
    """[(captured_at, html)] older snapshots shipped with a demo fixture, oldest first."""
    d = demo_dir(package)
    if not d or not (d / "policy_history").is_dir():
        return []
    return [(p.stem, p.read_text(encoding="utf-8")) for p in sorted((d / "policy_history").glob("*.html"))]


# ------------------------------------------------------------------ APK sources


def demo_apk_files(package: str) -> tuple[str, str | None] | None:
    d = demo_dir(package)
    if not d or not (d / "AndroidManifest.xml").is_file():
        return None
    classes = d / "classes.txt"
    return (d / "AndroidManifest.xml").read_text(encoding="utf-8"), (
        classes.read_text(encoding="utf-8") if classes.is_file() else None
    )


class AndroZooClient:
    """Stub. APKs come only from AndroZoo or a developer's own upload (never from Play)."""

    BASE = "https://androzoo.uni.lu/api/download"

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("ANDROZOO_API_KEY")

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def lookup_sha256(self, package: str, version_code: int | None = None) -> str | None:
        """Needs the AndroZoo `latest.csv` index (not bundled). Returns None until wired."""
        return None

    def download(self, sha256: str, dest: Path) -> Path:
        raise IngestError("AndroZoo download is not wired in this MVP (set ANDROZOO_API_KEY and implement)")
