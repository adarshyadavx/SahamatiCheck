"""Source acquisition: demo fixtures, Play listing (throttled), policy fetch, AndroZoo stub.

* Demo apps (`sahamati_core/demo/fixtures/<package>/`) are served fully offline.
* Play listing: `google-play-scraper`, plus the public data-safety page, both behind
  the global token bucket (1 request / 2 s). Never fetches APKs from Play.
* Policy: httpx + tenacity retries, honest User-Agent, robots.txt respected (RFC 9309).
  Pages that are empty JavaScript shells are rendered in headless Chromium when the
  optional `render` extra (Playwright) is installed.
* AndroZoo: stub client that reads ANDROZOO_API_KEY; downloads are not wired yet.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from sahamati_core import demo_fixtures_dir

from .throttle import play_bucket

# A browser-compatible but honest User-Agent: many CDNs drop requests whose UA does not
# start with "Mozilla/5.0", which made policies look "unreachable" when they were not.
USER_AGENT = "Mozilla/5.0 (compatible; SahamatiCheck/0.2; +https://sahamaticheck.example/about)"
ROBOTS_TOKEN = "sahamaticheck"  # the product token matched against robots.txt groups (RFC 9309)
HTML_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5",
    "Accept-Language": "en-IN,en;q=0.9",
}
PACKAGE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$")

# Anything that points at a Play app page: web links (with or without scheme or "www."),
# the datasafety sub-page, and market:// intents. Share text from the Play app ("Check out
# X: https://play.google.com/store/apps/details?id=...") is matched anywhere in the string.
_PLAY_LINK_RE = re.compile(
    r"(?:(?:https?://)?(?:www\.)?(?:play\.google\.com|market\.android\.com)/store/apps/(?:details|datasafety)"
    r"|market://details)[^\s<>\"']*",
    re.I,
)
_ID_PARAM_RE = re.compile(r"[?&]id=([^&#\s]+)")
_SHORT_LINK_RE = re.compile(r"(?:play\.app\.goo\.gl|goo\.gl|g\.co|bit\.ly)/", re.I)
_ANY_LINK_RE = re.compile(r"(?:[a-z][a-z0-9+.-]*://|www\.)\S+", re.I)


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


def package_from_text(text: str) -> str | None:
    """The package id from a Play link or a share message that contains one, else None."""
    for m in _PLAY_LINK_RE.finditer(text or ""):
        q = _ID_PARAM_RE.search(m.group(0))
        if q:
            pkg = unquote(q.group(1)).strip()
            if PACKAGE_RE.match(pkg) and len(pkg) <= 200:
                return pkg
    return None


def normalise_package(package_name: str | None = None, play_url: str | None = None) -> str:
    """Accept a package name, a Play link, or the text the Play app's Share button produces."""
    for raw in (package_name, play_url):
        s = (raw or "").strip()
        if not s:
            continue
        if PACKAGE_RE.match(s) and len(s) <= 200:
            return s
        pkg = package_from_text(s)
        if pkg:
            return pkg
        if _SHORT_LINK_RE.search(s):
            raise IngestError(
                "short links can't be opened here; open the link on your phone or browser and copy the full "
                "play.google.com/store/apps/details?id=… address"
            )
        if _ANY_LINK_RE.search(s):
            raise IngestError(
                "play_url must be a play.google.com link to an app page, "
                "like https://play.google.com/store/apps/details?id=com.example.app"
            )
    raise IngestError("a valid Android package name is required (e.g. in.example.chaiwallet)")


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

# Some apps are listed only outside India; try the Indian store first, then the US one.
PLAY_COUNTRIES = ("in", "us")


def fetch_play_listing(package: str, *, lang: str = "en", country: str = "in") -> Listing:
    try:
        from google_play_scraper import app as gps_app  # type: ignore[import-not-found]
    except ImportError as exc:
        raise IngestError(
            "Play listing fetch needs the optional 'play' extra (google-play-scraper); "
            "only the fabricated demo apps work offline"
        ) from exc
    countries = [country, *[c for c in PLAY_COUNTRIES if c != country]]
    raw: dict[str, Any] | None = None
    used = country
    for c in countries:
        if not play_bucket().acquire(timeout=30):
            raise IngestError("Play fetch throttled; too many checks at once, try again in a minute")
        try:
            raw = gps_app(package, lang=lang, country=c)
            used = c
            break
        except Exception as exc:  # noqa: BLE001
            if type(exc).__name__ == "NotFoundError":
                continue  # not listed in this country; try the next one
            raise IngestError(
                f"Google Play listing unavailable for {package} right now ({type(exc).__name__}); try again shortly"
            ) from exc
    if raw is None:
        raise IngestError(
            f"{package} was not found on Google Play. Check the link or package name; "
            "the app may be unlisted, removed, or not offered in India or the US"
        )
    vc = raw.get("versionCode") if isinstance(raw.get("versionCode"), int) else None
    policy_url = raw.get("privacyPolicy")
    return Listing(
        package=package,
        title=str(raw.get("title") or package),
        developer=raw.get("developer"),
        category=raw.get("genre"),
        policy_url=str(policy_url).strip() if policy_url else None,
        version_code=vc,
        is_demo=False,
        # google-play-scraper does not expose the data-safety section; the pipeline
        # reads it separately with fetch_play_data_safety().
        data_safety=None,
        extra={"country": used, "icon": raw.get("icon")},
    )


def get_listing(package: str) -> Listing:
    return demo_listing(package) if demo_dir(package) else fetch_play_listing(package)


# ------------------------------------------------------------------ Play data safety

PLAY_DATASAFETY_URL = "https://play.google.com/store/apps/datasafety?id={package}&hl=en&gl={country}"


def _ws(s: str) -> str:
    return " ".join(s.split())


def parse_play_data_safety(html: str, *, package: str, captured_at: str = "") -> dict[str, Any] | None:
    """Parse Play's data-safety page into `sahamati.data_safety/v1`, or None if it has no such section.

    The page is server-rendered with semantic headings: <h2> per section ("Data shared",
    "Data collected", "Security practices", or "No data shared with third parties" /
    "No data collected"), <h3> per category, and <h4> per data type (with an optional
    "· Optional" suffix) followed by a sibling listing the purposes. Class names are
    obfuscated and change, so only the heading structure is relied on. The page must be
    requested with hl=en so labels match `ds_vocab.yaml`.
    """
    from bs4 import BeautifulSoup

    from sahamati_core.declaration import from_play_scraper

    soup = BeautifulSoup(html, "html.parser")
    section: str | None = None
    category: str | None = None
    seen = False
    no_shared = no_collected = False
    items: dict[str, list[dict[str, Any]]] = {"collected": [], "shared": []}
    security: dict[str, bool] = {}
    for h in soup.find_all(["h2", "h3", "h4"]):
        text = _ws(h.get_text(" ", strip=True))
        low = text.lower().replace("’", "'")
        if h.name == "h2":
            category = None
            if low.startswith("no data shared"):
                no_shared, seen, section = True, True, None
            elif low.startswith("no data collected"):
                no_collected, seen, section = True, True, None
            elif low == "data shared":
                section, seen = "shared", True
            elif low == "data collected":
                section, seen = "collected", True
            elif low.startswith("security practices"):
                section, seen = "security", True
            else:
                section = None
            continue
        if section == "security" and h.name == "h3":
            if "encrypted in transit" in low:
                security["encrypted_in_transit"] = True
            elif "isn't encrypted" in low or "not encrypted" in low:
                security["encrypted_in_transit"] = False
            elif "request that data be deleted" in low or "request data deletion" in low:
                security["deletion_request"] = True
            elif "can't be deleted" in low or "cannot be deleted" in low:
                security["deletion_request"] = False
            continue
        if section not in ("collected", "shared"):
            continue
        if h.name == "h3":
            category = text
            continue
        span = h.find("span")
        name = _ws(span.get_text(" ", strip=True)) if span else text
        rest = low.replace(name.lower(), "", 1)
        nxt = h.find_next_sibling()
        items[section].append({
            "data": name,
            "type": category,
            "optional": "optional" in rest,
            "purpose": _ws(nxt.get_text(" ", strip=True)) if nxt else "",
        })
    if not seen:
        return None
    ds = from_play_scraper({"collectedData": items["collected"], "sharedData": items["shared"]},
                           package=package, captured_at=captured_at)
    # Only an explicit "No data …" heading is a denial; an unparsed section is never one.
    ds["no_data_collected"] = no_collected
    ds["no_data_shared"] = no_shared
    ds["security_practices"] = security
    return ds


@dataclass
class FetchedDataSafety:
    url: str
    data_safety: dict[str, Any] | None
    status: str  # ok | unavailable | unreachable | unparseable
    reason: str | None = None


def fetch_play_data_safety(package: str, *, country: str = "in", captured_at: str = "") -> FetchedDataSafety:
    """Read the public data-safety page for one app (throttled with the listing fetches)."""
    import httpx

    url = PLAY_DATASAFETY_URL.format(package=package, country=country)
    if not play_bucket().acquire(timeout=30):
        return FetchedDataSafety(url, None, "unreachable", "throttled")
    try:
        r = httpx.get(url, headers=HTML_HEADERS, timeout=httpx.Timeout(20, connect=8), follow_redirects=True)
    except Exception:  # noqa: BLE001
        return FetchedDataSafety(url, None, "unreachable", "network_error")
    if r.status_code == 404:
        return FetchedDataSafety(url, None, "unavailable", "not_listed")
    if r.status_code >= 400:
        return FetchedDataSafety(url, None, "unreachable", f"http_{r.status_code}")
    try:
        ds = parse_play_data_safety(r.text, package=package, captured_at=captured_at)
    except Exception:  # noqa: BLE001 - layout change: degrade, never fail the check
        return FetchedDataSafety(url, None, "unparseable", "layout_changed")
    if ds is None:
        return FetchedDataSafety(url, None, "unavailable", "not_provided")
    return FetchedDataSafety(url, ds, "ok")


# ------------------------------------------------------------------ policy


@dataclass
class FetchedPolicy:
    url: str | None
    content: str
    content_type: str
    status: str  # ok | unreachable | blocked | unparseable
    # Why the status is not ok, as a short code the clients translate:
    # no_url, bad_url, robots_blocked, http_<code>, network_error, needs_javascript, pdf_unreadable, empty
    reason: str | None = None
    final_url: str | None = None
    method: str = "http"  # http | browser


# Below this many characters of readable text a page is treated as an empty
# JavaScript shell (Next.js / React / Meta's privacy centre) and rendered in a browser.
MIN_POLICY_CHARS = 600


def _robots_pattern(path: str) -> re.Pattern[str]:
    anchored = path.endswith("$")
    body = re.escape(path[:-1] if anchored else path).replace(r"\*", ".*")
    return re.compile(body + ("$" if anchored else ""))


def robots_allows(robots_txt: str, url: str, token: str = ROBOTS_TOKEN) -> bool:
    """RFC 9309 matching: the most specific matching group, then the longest matching rule
    (allow wins a tie). The stdlib parser uses first-match and wrongly blocked real policies."""
    groups: list[tuple[list[str], list[tuple[bool, str]]]] = []
    agents: list[str] = []
    rules: list[tuple[bool, str]] = []
    in_rules = False
    for line in robots_txt.splitlines():
        line = line.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            if in_rules:
                groups.append((agents, rules))
                agents, rules, in_rules = [], [], False
            agents.append(value.lower())
        elif key in ("allow", "disallow"):
            in_rules = True
            if agents and value:
                rules.append((key == "allow", value))
    if agents:
        groups.append((agents, rules))
    token = token.lower()
    chosen = [r for a, r in groups if any(x != "*" and x in token for x in a)]
    if not chosen:
        chosen = [r for a, r in groups if "*" in a]
    applicable = [rule for g in chosen for rule in g]
    u = urlparse(url)
    target = (u.path or "/") + (f"?{u.query}" if u.query else "")
    best: tuple[int, bool] | None = None
    for allow, path in applicable:
        if _robots_pattern(path).match(target):
            rank = (len(path), allow)
            if best is None or rank > best:
                best = rank
    return True if best is None else best[1]


def _robots_allows(url: str) -> bool:
    import httpx

    u = urlparse(url)
    try:
        r = httpx.get(f"{u.scheme}://{u.netloc}/robots.txt", headers={"User-Agent": USER_AGENT}, timeout=5,
                      follow_redirects=True)
        if r.status_code >= 400:
            return True
        return robots_allows(r.text, url)
    except Exception:  # noqa: BLE001 - unreachable robots.txt does not block
        return True


_GDOC_RE = re.compile(r"^https://docs\.google\.com/document/d/([A-Za-z0-9_-]{10,})")


def normalise_policy_url(url: str | None) -> str | None:
    """Clean a developer-supplied policy link. Google Docs links become their plain-text export."""
    if not url:
        return None
    s = url.strip()
    if s.startswith("//"):
        s = "https:" + s
    elif not re.match(r"^[a-z][a-z0-9+.-]*:", s, re.I) and re.match(r"^[\w-]+(\.[\w-]+)+(/|$)", s):
        s = "https://" + s  # "www.example.com/privacy"
    m = _GDOC_RE.match(s)
    if m and "/pub" not in s:
        s = f"https://docs.google.com/document/d/{m.group(1)}/export?format=txt"
    return s


def browser_rendering_enabled() -> bool:
    return os.environ.get("SAHAMATI_BROWSER_RENDER", "1").lower() not in ("0", "false", "no")


def render_with_browser(url: str) -> tuple[str, str] | None:
    """Render a JavaScript-only page in headless Chromium (optional extra `render`).
    Returns (html, final_url), or None when Playwright is missing or rendering fails."""
    if not browser_rendering_enabled():
        return None
    try:
        from playwright.sync_api import sync_playwright  # type: ignore[import-not-found]
    except ImportError:
        return None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(user_agent=USER_AGENT, locale="en-IN")
                page.goto(url, wait_until="domcontentloaded", timeout=25_000)
                try:
                    page.wait_for_load_state("networkidle", timeout=10_000)
                except Exception:  # noqa: BLE001 - long-polling pages never go idle
                    pass
                return page.content(), page.url
            finally:
                browser.close()
    except Exception:  # noqa: BLE001
        return None


def _readable_chars(html: str) -> int:
    from sahamati_core.policy.html import html_to_text

    try:
        return len(html_to_text(html)[0])
    except Exception:  # noqa: BLE001
        return 0


def fetch_policy(url: str) -> FetchedPolicy:
    import httpx
    from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

    url = normalise_policy_url(url) or ""
    if not url.startswith(("http://", "https://")):
        return FetchedPolicy(url or None, "", "", "unreachable", "bad_url")
    if not _robots_allows(url):
        return FetchedPolicy(url, "", "", "blocked", "robots_blocked")

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, max=4),
           retry=retry_if_exception_type(httpx.TransportError), reraise=True)
    def _get() -> httpx.Response:
        return httpx.get(url, headers=HTML_HEADERS, timeout=httpx.Timeout(10, connect=6), follow_redirects=True)

    try:
        r = _get()
    except Exception:  # noqa: BLE001
        rendered = render_with_browser(url)
        if rendered and _readable_chars(rendered[0]) >= MIN_POLICY_CHARS:
            return FetchedPolicy(url, rendered[0], "text/html", "ok", final_url=rendered[1], method="browser")
        return FetchedPolicy(url, "", "", "unreachable", "network_error")
    final_url = str(getattr(r, "url", "") or url)
    if r.status_code >= 400:
        # Bot walls answer 403/429/503 to plain HTTP clients but serve a real browser.
        if r.status_code in (401, 403, 429, 503):
            rendered = render_with_browser(url)
            if rendered and _readable_chars(rendered[0]) >= MIN_POLICY_CHARS:
                return FetchedPolicy(url, rendered[0], "text/html", "ok", final_url=rendered[1], method="browser")
        return FetchedPolicy(url, "", "", "unreachable", f"http_{r.status_code}")
    ctype = r.headers.get("content-type", "")
    if "pdf" in ctype or r.content[:5] == b"%PDF-":
        try:
            import io

            from pypdf import PdfReader  # type: ignore[import-not-found]

            text = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(r.content)).pages)
            if text.strip():
                return FetchedPolicy(url, text, "text/plain", "ok", final_url=final_url)
            return FetchedPolicy(url, "", "text/plain", "unparseable", "pdf_unreadable", final_url)
        except Exception:  # noqa: BLE001
            return FetchedPolicy(url, "", ctype, "unparseable", "pdf_unreadable", final_url)
    body = r.text
    if "html" in ctype or "<html" in body[:2000].lower():
        if _readable_chars(body) < MIN_POLICY_CHARS:
            rendered = render_with_browser(final_url)
            if rendered and _readable_chars(rendered[0]) > _readable_chars(body):
                return FetchedPolicy(url, rendered[0], "text/html", "ok", final_url=rendered[1], method="browser")
            if _readable_chars(body) == 0:
                return FetchedPolicy(url, "", ctype, "unparseable", "needs_javascript", final_url)
    if not body.strip():
        return FetchedPolicy(url, "", ctype, "unparseable", "empty", final_url)
    return FetchedPolicy(url, body, ctype, "ok", final_url=final_url)


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
