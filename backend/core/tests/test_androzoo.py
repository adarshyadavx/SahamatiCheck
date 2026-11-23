"""AndroZoo index, download and pipeline wiring. Everything is local: a fabricated list, a fake HTTP
stream and fake APK facts. Package names are fabricated (CLAUDE.md rule 9)."""

from __future__ import annotations

import gzip
import hashlib
from pathlib import Path
from typing import Any

import httpx
import pytest
from sahamati_core.apk.analyzer import ApkFacts
from sahamati_core.ingest import androzoo
from sahamati_core.ingest.androzoo import AndroZooError, build_index, download_apk, iter_play_rows, lookup
from sahamati_core.schema import Coverage

H = {c: c * 64 for c in "abcdef"}
CSV = "\n".join([
    "sha256,sha1,md5,dex_date,apk_size,pkg_name,vercode,vt_detection,vt_scan_date,dex_size,markets",
    f"{H['a']},x,x,2024-01-01,100,in.example.chaiwallet,10,0,,1,play.google.com",
    f"{H['b']},x,x,2025-01-01,200,in.example.chaiwallet,12,0,,1,play.google.com",
    f"{H['c']},x,x,2025-06-01,300,in.example.chaiwallet,99,0,,1,anzhi",          # not Play: ignored
    f"{H['d']},x,x,2023-01-01,50,in.example.chaiwallet,11,0,,1,play.google.com|anzhi",
    f"{H['e']},x,x,2024-01-01,70,in.example.shopkart,,0,,1,play.google.com",
    "not-a-hash,x,x,,,in.example.broken,1,0,,1,play.google.com",
    "short,row",
]) + "\n"


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("SAHAMATI_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ANDROZOO_INDEX", str(tmp_path / "idx.sqlite"))
    monkeypatch.setenv("ANDROZOO_API_KEY", "SECRET-KEY")
    return tmp_path


def _write(tmp: Path, gz: bool) -> Path:
    p = tmp / ("latest.csv.gz" if gz else "latest.csv")
    p.write_bytes(gzip.compress(CSV.encode()) if gz else CSV.encode())
    return p


@pytest.mark.parametrize("gz", [True, False])
def test_index_keeps_the_newest_play_version_per_package(env: Path, gz: bool) -> None:
    assert build_index(_write(env, gz)) == 2
    e = lookup("in.example.chaiwallet")
    assert e is not None and (e.version_code, e.sha256) == (12, H["b"])  # 99 is not from Play
    assert lookup("in.example.shopkart") is not None
    assert lookup("in.example.broken") is None and lookup("in.example.nothing") is None


def test_columns_are_found_by_name_not_position() -> None:
    reordered = "markets,pkg_name,sha256,vercode\nplay.google.com,in.example.x," + H["f"] + ",3\n"
    rows = list(iter_play_rows(reordered.splitlines()))
    assert [(r.package, r.version_code) for r in rows] == [("in.example.x", 3)]
    with pytest.raises(AndroZooError, match="sha256"):
        list(iter_play_rows(["pkg_name,vercode", "a.b,1"]))


def test_lookup_without_an_index_says_so(env: Path) -> None:
    with pytest.raises(AndroZooError) as ei:
        lookup("in.example.chaiwallet")
    assert ei.value.reason == "androzoo_index_missing"


class FakeStream:
    def __init__(self, status: int, body: bytes, seen: dict[str, Any]) -> None:
        self.status_code, self.body, self.headers = status, body, {"content-length": str(len(body))}
        self.seen = seen

    def __enter__(self) -> FakeStream:
        return self

    def __exit__(self, *a: object) -> None:
        return None

    def iter_bytes(self, n: int) -> Any:
        for i in range(0, len(self.body), n):
            yield self.body[i:i + n]


def _fake_http(monkeypatch: pytest.MonkeyPatch, status: int, body: bytes) -> dict[str, Any]:
    seen: dict[str, Any] = {}

    def stream(method: str, url: str, **kw: Any) -> FakeStream:
        seen.update(method=method, url=url, params=kw.get("params"))
        return FakeStream(status, body, seen)

    monkeypatch.setattr(httpx, "stream", stream)
    return seen


def test_download_checks_the_hash_and_sends_the_key_only_as_a_parameter(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    body = b"PK\x03\x04 fake apk"
    sha = hashlib.sha256(body).hexdigest()
    seen = _fake_http(monkeypatch, 200, body)
    out = download_apk(sha, env / "x.apk")
    assert out.read_bytes() == body
    assert seen["url"].endswith("/api/download") and seen["params"] == {"apikey": "SECRET-KEY", "sha256": sha}


@pytest.mark.parametrize("status, body, reason", [
    (200, b"something else", "download_failed"),       # hash mismatch
    (403, b"", "androzoo_key_rejected"),
    (404, b"", "not_in_corpus"),
    (500, b"", "download_failed"),
])
def test_download_failures_have_reasons_and_leave_no_file(env: Path, monkeypatch: pytest.MonkeyPatch,
                                                          status: int, body: bytes, reason: str) -> None:
    _fake_http(monkeypatch, status, body)
    dest = env / "x.apk"
    with pytest.raises(AndroZooError) as ei:
        download_apk("0" * 64, dest)
    assert ei.value.reason == reason and not dest.exists()
    assert "SECRET-KEY" not in str(ei.value)


def test_download_refuses_oversized_apks(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_http(monkeypatch, 200, b"x" * 2048)
    with pytest.raises(AndroZooError) as ei:
        download_apk("0" * 64, env / "x.apk", limit=1024)
    assert ei.value.reason == "apk_too_large"


def test_no_key_means_not_configured(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANDROZOO_API_KEY")
    with pytest.raises(AndroZooError) as ei:
        androzoo.fetch_apk_facts("in.example.chaiwallet")
    assert ei.value.reason == "androzoo_not_configured"


def test_fetch_analyses_deletes_the_apk_and_caches_only_facts(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    build_index(_write(env, True))
    paths: list[Path] = []

    def fake_download(sha: str, dest: Path, **_: Any) -> Path:
        dest.write_bytes(b"apk")
        paths.append(dest)
        return dest

    calls: list[int] = []

    def fake_facts(path: Any) -> ApkFacts:
        calls.append(1)
        return ApkFacts(package="in.example.chaiwallet", version_code=12,
                        permissions=["android.permission.READ_CONTACTS"], class_names=["com.example.A"],
                        method="androguard")

    monkeypatch.setattr(androzoo, "download_apk", fake_download)
    monkeypatch.setattr("sahamati_core.apk.analyzer.facts_from_apk", fake_facts)
    entry, facts = androzoo.fetch_apk_facts("in.example.chaiwallet")
    assert entry.sha256 == H["b"] and facts.method == "androzoo" and facts.coverage == Coverage.OK
    assert paths and not paths[0].exists()  # the APK itself is never kept
    _, again = androzoo.fetch_apk_facts("in.example.chaiwallet")
    assert calls == [1] and again.permissions == ["android.permission.READ_CONTACTS"]  # served from the facts cache


def test_pipeline_degrades_with_a_reason_when_androzoo_is_off(monkeypatch: pytest.MonkeyPatch) -> None:
    from sahamati_core import pipeline

    monkeypatch.delenv("ANDROZOO_API_KEY", raising=False)
    state: dict[str, Any] = {"package": "com.example.realapp", "listing": {"captured_at": "2026-11-23"}}
    out = pipeline.stage_analyse_apk(state)["apk"]
    assert (out["coverage"], out["reason"]) == ("unavailable", "androzoo_not_configured")


def test_pipeline_uses_androzoo_facts(monkeypatch: pytest.MonkeyPatch) -> None:
    from sahamati_core import pipeline

    facts = ApkFacts(package="com.example.realapp", version_code=7, permissions=["android.permission.CAMERA"],
                     class_names=["com.example.A"], method="androzoo")
    entry = androzoo.ApkEntry(package="com.example.realapp", version_code=7, sha256=H["a"])
    monkeypatch.setattr(pipeline, "fetch_apk_facts", lambda pkg: (entry, facts))
    state: dict[str, Any] = {"package": "com.example.realapp",
                             "listing": {"captured_at": "2026-11-23", "version_code": 9}}
    out = pipeline.stage_analyse_apk(state)["apk"]
    assert out["coverage"] == "ok" and out["method"] == "androzoo" and out["claims"]
    assert any("Play lists 9" in n for n in out["notes"])
