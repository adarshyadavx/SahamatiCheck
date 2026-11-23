"""Play links and share text, the Play data-safety page parser, robots.txt matching, policy URL
clean-up, JavaScript-only policy pages, and the precision guards for real-world policy text.

All apps and pages here are fabricated (CLAUDE.md rule 9); nothing touches the network.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from sahamati_core.engine import Engine
from sahamati_core.ingest import sources
from sahamati_core.ingest.sources import (
    IngestError,
    fetch_policy,
    normalise_package,
    normalise_policy_url,
    package_from_text,
    parse_play_data_safety,
    robots_allows,
)
from sahamati_core.pipeline import run_pipeline
from sahamati_core.schema import Action, ClaimTuple, EvidenceSpan, NegationMethod, Polarity, SourceKind

PKG = "in.example.shopkart"

# ------------------------------------------------------------------ links and share text


@pytest.mark.parametrize("raw", [
    PKG,
    f"https://play.google.com/store/apps/details?id={PKG}",
    f"https://play.google.com/store/apps/details?id={PKG}&hl=en_IN&gl=US",
    f"https://play.google.com/store/apps/details?id={PKG}&pcampaignid=web_share",
    f"http://play.google.com/store/apps/details?hl=en&id={PKG}",
    f"play.google.com/store/apps/details?id={PKG}",
    f"https://www.play.google.com/store/apps/details?id={PKG}",
    f"https://play.google.com/store/apps/datasafety?id={PKG}&hl=en",
    f"market://details?id={PKG}",
    f"Check out ShopKart on Google Play! https://play.google.com/store/apps/details?id={PKG}",
    f"  https://play.google.com/store/apps/details?id={PKG}\n",
])
def test_every_play_link_shape_resolves_to_the_package(raw: str) -> None:
    assert normalise_package(play_url=raw) == PKG
    assert normalise_package(package_name=raw) == PKG  # clients may send a link in either field


def test_package_from_text_ignores_other_links() -> None:
    assert package_from_text("see https://example.test/?id=in.example.shopkart") is None


@pytest.mark.parametrize("raw, match", [
    ("https://example.test/app?id=in.example.shopkart", "play.google.com"),
    ("https://play.app.goo.gl/?link=x", "short links"),
    ("https://play.google.com/store/apps/details", "play.google.com"),
    ("not a package", "package name"),
    ("", "package name"),
])
def test_bad_inputs_get_a_helpful_error(raw: str, match: str) -> None:
    with pytest.raises(IngestError, match=match):
        normalise_package(play_url=raw)


# ------------------------------------------------------------------ data-safety page

DS_PAGE = """<html><body>
<h2>Data shared</h2><div>Data that may be shared with other companies or organizations</div>
<div><h3>Device or other IDs</h3><div>Device or other IDs</div></div>
<div><h4><span>Device or other IDs</span></h4><div>Advertising or marketing, Analytics</div></div>
<h2>Data collected</h2>
<div><h3>Location</h3><div>Precise location</div></div>
<div><h4><span>Precise location</span> · Optional</h4>
     <div>App functionality, Fraud prevention, security, and compliance</div></div>
<div><h3>Personal info</h3></div>
<div><h4><span>Email address</span></h4><div>Account management</div></div>
<h2>Security practices</h2>
<h3>Data is encrypted in transit</h3><h3>You can request that data be deleted</h3>
</body></html>"""


def test_data_safety_page_is_parsed_into_the_schema() -> None:
    ds = parse_play_data_safety(DS_PAGE, package=PKG, captured_at="2026-11-23")
    assert ds is not None
    by_type = {e["type"]: e for e in ds["data_types"]}
    assert by_type["Device or other IDs"]["shared"] is True
    assert by_type["Device or other IDs"]["purposes_shared"] == ["Advertising or marketing", "Analytics"]
    loc = by_type["Precise location"]
    assert loc["collected"] and loc["optional"] and loc["category"] == "Location"
    assert loc["purposes_collected"] == ["App functionality", "Fraud prevention, security, and compliance"]
    assert by_type["Email address"]["category"] == "Personal info"
    assert ds["no_data_shared"] is False and ds["no_data_collected"] is False
    assert ds["security_practices"] == {"encrypted_in_transit": True, "deletion_request": True}


def test_no_data_headings_are_explicit_denials_and_nothing_else_is() -> None:
    page = "<h2>No data shared with third parties</h2><h2>No data collected</h2>"
    ds = parse_play_data_safety(page, package=PKG)
    assert ds is not None and ds["no_data_shared"] is True and ds["no_data_collected"] is True
    # a page without any data-safety heading (app not listed, layout unknown) is "unavailable", never "no data"
    assert parse_play_data_safety("<h2>Ratings</h2>", package=PKG) is None


# ------------------------------------------------------------------ robots.txt (RFC 9309)

ROBOTS = """User-agent: *
Disallow: /
Allow: /legal/

User-agent: SahamatiCheck
Disallow: /private
"""


def test_robots_longest_match_and_specific_group() -> None:
    assert robots_allows("User-agent: *\nDisallow: /\nAllow: /legal/", "https://x.test/legal/privacy") is True
    assert robots_allows("User-agent: *\nDisallow: /", "https://x.test/legal/privacy") is False
    # our own group wins over "*"
    assert robots_allows(ROBOTS, "https://x.test/legal/privacy") is True
    assert robots_allows(ROBOTS, "https://x.test/private/x") is False
    # wildcards and end anchors
    assert robots_allows("User-agent: *\nDisallow: /*.pdf$", "https://x.test/p.pdf") is False
    assert robots_allows("User-agent: *\nDisallow: /*.pdf$", "https://x.test/p.pdf?x=1") is True
    assert robots_allows("", "https://x.test/anything") is True


# ------------------------------------------------------------------ policy URLs and JS-only pages


def test_policy_url_clean_up() -> None:
    assert normalise_policy_url("www.example.test/privacy") == "https://www.example.test/privacy"
    assert normalise_policy_url("//example.test/p") == "https://example.test/p"
    assert normalise_policy_url(
        "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit?usp=sharing"
    ) == "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/export?format=txt"
    assert normalise_policy_url(None) is None


SHELL = '<!doctype html><html><head><title>Privacy</title></head><body><div id="root"></div></body></html>'
RENDERED = "<html><body><main>" + "<p>We collect your email address to run your account.</p>" * 30 + "</main></body></html>"


def _http(policy: httpx.Response) -> Any:
    def get(url: str, **_: Any) -> httpx.Response:
        if url.endswith("/robots.txt"):
            return httpx.Response(404, request=httpx.Request("GET", url))
        return policy

    return get


def test_a_javascript_shell_is_rendered_in_a_browser(monkeypatch: pytest.MonkeyPatch) -> None:
    url = "https://example.test/privacy"
    monkeypatch.setattr(httpx, "get", _http(httpx.Response(200, text=SHELL, headers={"content-type": "text/html"},
                                                           request=httpx.Request("GET", url))))
    monkeypatch.setattr(sources, "render_with_browser", lambda u: (RENDERED, u))
    got = fetch_policy(url)
    assert (got.status, got.method) == ("ok", "browser") and "email address" in got.content


def test_a_javascript_shell_without_a_browser_says_why(monkeypatch: pytest.MonkeyPatch) -> None:
    url = "https://example.test/privacy"
    monkeypatch.setattr(httpx, "get", _http(httpx.Response(200, text=SHELL, headers={"content-type": "text/html"},
                                                           request=httpx.Request("GET", url))))
    monkeypatch.setattr(sources, "render_with_browser", lambda u: None)
    got = fetch_policy(url)
    assert (got.status, got.reason) == ("unparseable", "needs_javascript")


def test_a_bot_wall_is_retried_in_a_browser(monkeypatch: pytest.MonkeyPatch) -> None:
    url = "https://example.test/privacy"
    monkeypatch.setattr(httpx, "get", _http(httpx.Response(403, request=httpx.Request("GET", url))))
    monkeypatch.setattr(sources, "render_with_browser", lambda u: None)
    assert fetch_policy(url).reason == "http_403"
    monkeypatch.setattr(sources, "render_with_browser", lambda u: (RENDERED, u))
    assert fetch_policy(url).status == "ok"


# ------------------------------------------------------------------ report sources


def test_demo_report_says_where_each_source_came_from() -> None:
    rep = run_pipeline("in.example.chaiwallet")["report"]
    src = rep["sources"]
    assert src["policy"]["method"] == "fixture" and src["policy"]["url"].startswith("https://")
    assert src["data_safety"]["method"] == "fixture"
    assert "reason" not in src["policy"]


# ------------------------------------------------------------------ precision guards


def _claim(text: str, pol: Polarity, dt: str = "contacts", action: Action = Action.USE, start: int = 0,
           conf: float = 0.9) -> ClaimTuple:
    return ClaimTuple(actor="first_party", action=action, data_type=dt, polarity=pol, source_kind=SourceKind.POLICY,
                      evidence=EvidenceSpan(text=text, char_start=start, char_end=start + len(text)),
                      confidence=conf, extractor="rule", extractor_version="test", ontology_version="test",
                      negation_method=NegationMethod.ADJACENT if pol == Polarity.DENY else None)


def _ic(deny: ClaimTuple, affirm: ClaimTuple) -> list[Any]:
    return [f for f in Engine().run([deny, affirm], apk_ok=False).findings if not f.suppressed]


def test_a_plain_contradiction_is_still_found() -> None:
    deny = _claim("We do not use your contacts.", Polarity.DENY)
    affirm = _claim("We use your contacts to suggest friends.", Polarity.AFFIRM, start=100)
    assert len(_ic(deny, affirm)) == 1


@pytest.mark.parametrize("deny_text", [
    "We don't use your contacts lists for ad targeting or other commercial purposes.",
    "We do not use contacts unless you turn on sync.",
    "You may choose not to share your contacts with us.",
    "Our vendors are not permitted to use contacts for their own purposes.",
    "We do not use their contacts.",
    "In this case, we do not use your contacts.",
    "We do not use contacts of children under 13.",
])
def test_scoped_denials_never_conflict(deny_text: str) -> None:
    affirm = _claim("We use your contacts to suggest friends.", Polarity.AFFIRM, start=500)
    assert _ic(_claim(deny_text, Polarity.DENY), affirm) == []


def test_a_negated_affirm_is_not_evidence() -> None:
    deny = _claim("We do not use your contacts.", Polarity.DENY)
    affirm = _claim("No contents of your contacts lists are mined to show ads.", Polarity.AFFIRM, start=100)
    assert _ic(deny, affirm) == []


def test_low_confidence_reads_never_contradict_each_other() -> None:
    deny = _claim("We do not use your contacts.", Polarity.DENY)
    affirm = _claim("We use your contacts to suggest friends.", Polarity.AFFIRM, start=100, conf=0.65)
    assert _ic(deny, affirm) == []


def test_one_finding_per_denial_sentence() -> None:
    deny = _claim("We do not use your personal information.", Polarity.DENY, dt="personal_info")
    affirms = [_claim(f"We use your {w} to run the service.", Polarity.AFFIRM, dt=d, start=100 * (i + 1))
               for i, (w, d) in enumerate([("email", "email"), ("name", "name"), ("phone", "phone")])]
    found = [f for f in Engine().run([deny, *affirms], apk_ok=False).findings if not f.suppressed]
    assert len(found) == 1
