"""Export every Hindi string for a native-speaker review (VERIFICATION_GAPS G6).

    .venv/bin/python scripts/export_hindi_review.py            writes review/hi.csv
    .venv/bin/python scripts/export_hindi_review.py --status   prints how many strings are reviewed

Columns: source, key, english, hindi, where_shown, reviewer_status, reviewer_fix.
Reviewed keys are recorded in review/hi-reviewed.json ({"reviewer": ..., "date": ..., "keys": ["web:status.red", ...]});
re-running the export keeps their status. A string whose Hindi text changed after review is shown as `changed`.
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "review" / "hi.csv"
STATE = ROOT / "review" / "hi-reviewed.json"


def flat(node: Any, prefix: str = "") -> Iterator[tuple[str, str]]:
    if isinstance(node, dict):
        for k, v in node.items():
            yield from flat(v, f"{prefix}{k}.")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from flat(v, f"{prefix}{i}.")
    elif isinstance(node, str):
        yield prefix.rstrip("."), node


def rows() -> Iterator[tuple[str, str, str, str, str]]:
    """(source, key, english, hindi, where_shown)"""
    web = {loc: dict(flat(json.loads((ROOT / "packages/i18n" / f"{loc}.json").read_text("utf-8")))) for loc in ("en", "hi")}
    for k, en in web["en"].items():
        yield "web", k, en, web["hi"].get(k, ""), "website (packages/i18n)"
    ext = {loc: json.loads((ROOT / "apps/extension/locales" / f"{loc}.json").read_text("utf-8")) for loc in ("en", "hi")}
    for k, en in ext["en"].items():
        yield "extension", k, en, ext["hi"].get(k, ""), "extension side panel"
    tpl = yaml.safe_load((ROOT / "backend/core/sahamati_core/engine/templates.yaml").read_text("utf-8"))
    t_en, t_hi = dict(flat(tpl["en"])), dict(flat(tpl["hi"]))
    for k, en in t_en.items():
        yield "backend", k, en, t_hi.get(k, ""), "report text written by the server (summaries, card notes, answers)"
    for f in ("P", "D", "T", "A", "C", "S", "AI"):
        raw = yaml.safe_load((ROOT / "backend/core/rules/registry" / f"{f}.yaml").read_text("utf-8"))
        for r in raw["rules"]:
            yield "registry", f"{r['id']}.name", r["name"], r["name_hi"], "rule name (rules page, Rules not evaluated)"
            yield "registry", f"{r['id']}.plain_language", r["plain_language"], r["plain_language_hi"], "rule description (rules page)"


def fingerprint(hindi: str) -> str:
    return hashlib.sha256(hindi.encode("utf-8")).hexdigest()[:10]


def main() -> int:
    state = json.loads(STATE.read_text("utf-8")) if STATE.is_file() else {"reviewer": None, "date": None, "keys": {}}
    reviewed: dict[str, str] = state.get("keys", {})  # "source:key" -> fingerprint of the Hindi text that was approved
    out: list[list[str]] = []
    counts = {"reviewed": 0, "changed": 0, "pending": 0}
    for source, key, en, hi, where in rows():
        sid = f"{source}:{key}"
        status = "pending"
        if sid in reviewed:
            status = "reviewed" if reviewed[sid] == fingerprint(hi) else "changed"
        counts[status] += 1
        out.append([source, key, en, hi, where, status, ""])
    if "--status" in sys.argv:
        total = len(out)
        print(f"{total} Hindi strings: {counts['reviewed']} reviewed, {counts['changed']} changed since review, "
              f"{counts['pending']} pending. Reviewer: {state.get('reviewer') or 'none yet'}")
        return 0
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", encoding="utf-8-sig", newline="") as fh:  # BOM so Excel opens Devanagari correctly
        w = csv.writer(fh)
        w.writerow(["source", "key", "english", "hindi", "where_shown", "reviewer_status", "reviewer_fix"])
        w.writerows(out)
    print(f"wrote {OUT} ({len(out)} strings; {counts})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
