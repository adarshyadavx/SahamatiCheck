"""Unit tests for ingest: policy fetching (robots, retries, PDF), the Play listing fetch, demo helpers, throttling.

Everything external is faked: HTTP via a patched `httpx.get`, the Play scraper and Redis via fake modules.
"""

from __future__ import annotations

import sys
import types
from typing import Any

import httpx
import pytest
from sahamati_core.ingest import sources, throttle
from sahamati_core.ingest.sources import (
    AndroZooClient,
    IngestError,
    demo_apk_files,
    demo_listing,
    demo_packages,
    demo_policy,
    demo_policy_history,
    fetch_play_listing,
    fetch_policy,
    get_listing,
)
from sahamati_core.ingest.throttle import RedisTokenBucket, TokenBucket

URL = "https://example.test/privacy"


def _resp(status: int = 200, text: str = "", ctype: str = "text/html", content: bytes | None = None) -> httpx.Response:
    return httpx.Response(status, text=text, headers={"content-type": ctype}, content=content,
                          request=httpx.Request("GET", URL))


class FakeHttp:
    """Routes httpx.get by URL suffix: robots.txt vs the policy itself."""

    def __init__(self, robots: httpx.Response | Exception, policy: httpx.Response | Exception | list[Any]) -> None:
        self.robots, self.policy, self.calls = robots, policy, 0

    def __call__(self, url: str, **_: Any) -> httpx.Response:
        item = self.robots if url.endswith("/robots.txt") else self.policy
        if not url.endswith("/robots.txt"):
            self.calls += 1
            if isinstance(item, list):
                item = item.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture(autouse=True)
def _fast_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    import tenacity.nap

    monkeypatch.setattr(tenacity.nap.time, "sleep", lambda _s: None)


def _patch(monkeypatch: pytest.MonkeyPatch, fake: FakeHttp) -> FakeHttp:
    monkeypatch.setattr(httpx, "get", fake)
    return fake


# ------------------------------------------------------------------ fetch_policy


def test_non_http_url_is_unreachable_without_any_request(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _patch(monkeypatch, FakeHttp(_resp(404), _resp(200, "x")))
    assert fetch_policy("ftp://x/y").status == "unreachable"
    assert fetch_policy("not a url").status == "unreachable"
    assert fake.calls == 0


def test_ok_html_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch(monkeypatch, FakeHttp(_resp(404), _resp(200, "<p>We collect data.</p>")))
    got = fetch_policy(URL)
    assert (got.status, got.content, got.content_type) == ("ok", "<p>We collect data.</p>", "text/html")


def test_robots_disallow_blocks_the_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _patch(monkeypatch, FakeHttp(_resp(200, "User-agent: *\nDisallow: /privacy", "text/plain"), _resp(200, "x")))
    assert fetch_policy(URL).status == "blocked"
    assert fake.calls == 0  # robots.txt is respected before the policy is requested


def test_robots_allow_and_unreachable_robots_do_not_block(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch(monkeypatch, FakeHttp(_resp(200, "User-agent: *\nDisallow: /admin", "text/plain"), _resp(200, "ok")))
    assert fetch_policy(URL).status == "ok"
    _patch(monkeypatch, FakeHttp(httpx.ConnectError("no robots"), _resp(200, "ok")))
    assert fetch_policy(URL).status == "ok"
    _patch(monkeypatch, FakeHttp(_resp(500), _resp(200, "ok")))  # robots.txt >= 400 means no restrictions
    assert fetch_policy(URL).status == "ok"


@pytest.mark.parametrize("status", [404, 410, 500, 503])
def test_http_errors_are_unreachable(monkeypatch: pytest.MonkeyPatch, status: int) -> None:
    _patch(monkeypatch, FakeHttp(_resp(404), _resp(status)))
    assert fetch_policy(URL).status == "unreachable"


def test_transport_errors_are_retried_then_give_up(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _patch(monkeypatch, FakeHttp(_resp(404), httpx.ConnectError("down")))
    assert fetch_policy(URL).status == "unreachable"
    assert fake.calls == 3  # tenacity: 3 attempts


def test_a_transient_error_then_success(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _patch(monkeypatch, FakeHttp(_resp(404), [httpx.ReadTimeout("slow"), _resp(200, "<p>fine</p>")]))
    assert fetch_policy(URL).status == "ok" and fake.calls == 2


def test_pdf_policy_is_unparseable_when_the_bytes_are_not_a_pdf(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch(monkeypatch, FakeHttp(_resp(404), _resp(200, ctype="application/pdf", content=b"%PDF-1.4 garbage")))
    got = fetch_policy(URL)
    assert got.status == "unparseable" and got.content == ""


def test_pdf_policy_text_is_extracted(monkeypatch: pytest.MonkeyPatch) -> None:
    class Page:
        def extract_text(self) -> str:
            return "We never sell your data."

    fake_pypdf = types.SimpleNamespace(PdfReader=lambda _b: types.SimpleNamespace(pages=[Page(), Page()]))
    monkeypatch.setitem(sys.modules, "pypdf", fake_pypdf)
    _patch(monkeypatch, FakeHttp(_resp(404), _resp(200, ctype="application/pdf", content=b"%PDF")))
    got = fetch_policy(URL)
    assert got.status == "ok" and got.content.count("We never sell your data.") == 2 and got.content_type == "text/plain"


def test_empty_pdf_is_unparseable(monkeypatch: pytest.MonkeyPatch) -> None:
    page = types.SimpleNamespace(extract_text=lambda: "  ")
    monkeypatch.setitem(sys.modules, "pypdf", types.SimpleNamespace(PdfReader=lambda _b: types.SimpleNamespace(pages=[page])))
    _patch(monkeypatch, FakeHttp(_resp(404), _resp(200, ctype="application/pdf", content=b"%PDF")))
    assert fetch_policy(URL).status == "unparseable"


# ------------------------------------------------------------------ Play listing


def _fake_scraper(monkeypatch: pytest.MonkeyPatch, fn: Any) -> None:
    monkeypatch.setitem(sys.modules, "google_play_scraper", types.SimpleNamespace(app=fn))


def test_play_listing_without_the_optional_extra(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "google_play_scraper", None)  # makes `import` raise ImportError
    with pytest.raises(IngestError, match="play"):
        fetch_play_listing("com.unknown.app")


def test_play_listing_maps_the_scraper_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    def app(pkg: str, **kw: Any) -> dict[str, Any]:
        seen.update(pkg=pkg, **kw)
        return {"title": "Some App", "developer": "Some Dev", "genre": "Tools", "privacyPolicy": "https://x.test/p",
                "versionCode": 42}

    _fake_scraper(monkeypatch, app)
    monkeypatch.setattr(throttle.play_bucket(), "acquire", lambda **_: True)
    lst = fetch_play_listing("com.some.app", lang="hi", country="in")
    assert (lst.title, lst.developer, lst.category, lst.policy_url, lst.version_code) == (
        "Some App", "Some Dev", "Tools", "https://x.test/p", 42)
    assert lst.is_demo is False and lst.data_safety is None
    assert seen == {"pkg": "com.some.app", "lang": "hi", "country": "in"}


def test_play_listing_tolerates_missing_and_odd_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_scraper(monkeypatch, lambda pkg, **_: {"versionCode": "Varies with device"})
    monkeypatch.setattr(throttle.play_bucket(), "acquire", lambda **_: True)
    lst = fetch_play_listing("com.some.app")
    assert lst.title == "com.some.app" and lst.version_code is None


def test_play_listing_scraper_failure_is_an_ingest_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_: Any, **__: Any) -> None:
        raise RuntimeError("404")

    _fake_scraper(monkeypatch, boom)
    monkeypatch.setattr(throttle.play_bucket(), "acquire", lambda **_: True)
    with pytest.raises(IngestError, match="unavailable.*RuntimeError"):
        fetch_play_listing("com.gone.app")


def test_play_listing_is_throttled(monkeypatch: pytest.MonkeyPatch) -> None:
    called = []
    _fake_scraper(monkeypatch, lambda *a, **k: called.append(1) or {})
    monkeypatch.setattr(throttle.play_bucket(), "acquire", lambda **_: False)
    with pytest.raises(IngestError, match="throttled"):
        fetch_play_listing("com.some.app")
    assert called == []  # no request is made when the bucket refuses


def test_get_listing_uses_the_demo_for_demo_packages_and_never_the_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "google_play_scraper", None)
    assert get_listing("in.example.shopkart").is_demo is True
    with pytest.raises(IngestError):
        get_listing("com.real.app")


# ------------------------------------------------------------------ demo helpers


def test_demo_packages_are_the_fabricated_apps() -> None:
    pk = demo_packages()
    assert {"in.example.chaiwallet", "in.example.dosanotes", "in.example.shopkart"} <= set(pk)
    assert all(p.startswith("in.example.") for p in pk)  # CLAUDE.md rule 9


def test_demo_listing_unknown_package() -> None:
    with pytest.raises(IngestError, match="no demo fixture"):
        demo_listing("in.example.nothing")


def test_demo_policy_and_history_and_apk_files() -> None:
    pol = demo_policy("in.example.chaiwallet")
    assert pol.status == "ok" and "<" in pol.content
    hist = demo_policy_history("in.example.chaiwallet")
    assert hist and hist[0][0] == "2026-07-01"
    assert demo_policy_history("in.example.dosanotes") == []
    manifest, classes = demo_apk_files("in.example.chaiwallet") or ("", None)
    assert "<manifest" in manifest and classes
    assert demo_apk_files("in.example.nothing") is None


def test_demo_policy_without_a_policy_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    d = tmp_path / "in.example.nopolicy"
    d.mkdir()
    (d / "listing.json").write_text('{"title": "No Policy", "policy_url": "https://x.test/p"}')
    monkeypatch.setattr(sources, "demo_fixtures_dir", lambda: tmp_path)
    got = demo_policy("in.example.nopolicy")
    assert got.status == "unreachable" and got.url == "https://x.test/p"
    assert demo_apk_files("in.example.nopolicy") is None  # no manifest in the fixture


def test_androzoo_stub_is_honest(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    monkeypatch.delenv("ANDROZOO_API_KEY", raising=False)
    assert AndroZooClient().configured is False
    z = AndroZooClient(api_key="k")
    assert z.configured is True and z.lookup_sha256("a.b") is None
    with pytest.raises(IngestError, match="not wired"):
        z.download("00" * 32, tmp_path / "x.apk")


# ------------------------------------------------------------------ throttling


def test_token_bucket_allows_one_then_refuses_without_blocking() -> None:
    b = TokenBucket(rate_per_s=0.5, capacity=1)
    assert b.acquire(block=False) is True
    assert b.acquire(block=False) is False  # 1 request / 2 s


def test_token_bucket_times_out_instead_of_waiting_forever() -> None:
    b = TokenBucket(rate_per_s=0.01, capacity=1)
    assert b.acquire() is True
    assert b.acquire(timeout=0.05) is False


def test_token_bucket_refills_over_time() -> None:
    b = TokenBucket(rate_per_s=200.0, capacity=1)  # 5 ms per token
    assert b.acquire() is True
    assert b.acquire(timeout=1.0) is True  # blocks briefly, then succeeds


class FakeRedis:
    def __init__(self) -> None:
        self.keys: set[str] = set()

    def set(self, key: str, _v: str, nx: bool = False, px: int = 0) -> bool:
        if nx and key in self.keys:
            return False
        self.keys.add(key)
        return True


def _redis_bucket(monkeypatch: pytest.MonkeyPatch, fake: FakeRedis) -> RedisTokenBucket:
    mod = types.SimpleNamespace(Redis=types.SimpleNamespace(from_url=lambda _u: fake))
    monkeypatch.setitem(sys.modules, "redis", mod)
    return RedisTokenBucket("redis://x")


def test_redis_bucket_is_one_shared_key(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeRedis()
    a, b = _redis_bucket(monkeypatch, fake), _redis_bucket(monkeypatch, fake)  # two workers, one key
    assert a.acquire(block=False) is True
    assert b.acquire(block=False) is False
    assert b.acquire(timeout=0.05) is False


def test_play_bucket_falls_back_when_redis_is_unusable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(throttle, "_bucket", None)
    monkeypatch.setenv("REDIS_URL", "redis://nowhere")
    monkeypatch.setitem(sys.modules, "redis", None)  # not installed
    assert isinstance(throttle.play_bucket(), TokenBucket)
    monkeypatch.setattr(throttle, "_bucket", None)
    monkeypatch.delenv("REDIS_URL")
    assert isinstance(throttle.play_bucket(), TokenBucket)
    monkeypatch.setattr(throttle, "_bucket", None)  # leave no state behind
