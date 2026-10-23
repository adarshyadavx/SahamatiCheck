"""HTML -> clean text. Uses trafilatura when installed, else a BeautifulSoup fallback.

Character offsets in claims refer to the text returned here.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

BLOCK_TAGS = {
    "p", "div", "section", "article", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
    "tr", "td", "th", "table", "br", "blockquote", "dd", "dt", "main", "pre", "hr",
}
DROP_TAGS = ["script", "style", "noscript", "nav", "footer", "header", "svg", "form", "button", "iframe"]

_LAST_UPDATED = re.compile(
    r"(last\s+updated|effective\s+(?:date|from)|updated\s+on)\s*[:\-]?\s*([^\n.]{4,40})", re.I
)


def _bs4_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(DROP_TAGS):
        tag.decompose()
    for tag in soup.find_all(BLOCK_TAGS):
        tag.insert_before("\n")
        tag.insert_after("\n")
    body = soup.body or soup
    raw = body.get_text("")
    lines = [re.sub(r"[ \t\r\f\v ]+", " ", ln).strip() for ln in raw.split("\n")]
    out: list[str] = []
    for ln in lines:
        if ln:
            out.append(ln)
    return "\n".join(out)


def html_to_text(html: str, *, prefer_trafilatura: bool = True) -> tuple[str, str]:
    """Return (text, method). method is 'trafilatura' or 'bs4'."""
    if prefer_trafilatura:
        try:
            import trafilatura  # type: ignore[import-not-found]

            txt = trafilatura.extract(html, include_comments=False, include_tables=True, favor_recall=True)
            if txt and len(txt) > 200:
                return txt.strip(), "trafilatura"
        except Exception:  # noqa: BLE001 - optional dependency, any failure falls back
            pass
    return _bs4_text(html), "bs4"


def find_last_updated(text: str) -> str | None:
    m = _LAST_UPDATED.search(text)
    return m.group(2).strip() if m else None


def looks_like_html(content: str) -> bool:
    head = content.lstrip()[:500].lower()
    return head.startswith("<!doctype") or "<html" in head or "<body" in head or "<p" in head
