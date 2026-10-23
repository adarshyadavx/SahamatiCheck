"""Renders neutral finding summaries and benign explanations from templates.yaml."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from sahamati_core.ontology import Ontology

_PATH = Path(__file__).with_name("templates.yaml")


@lru_cache(maxsize=1)
def _templates() -> dict[str, Any]:
    with _PATH.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def inline_label(onto: Ontology, data_type: str, lang: str = "en") -> str:
    label = onto.data_types.label(data_type, lang)
    if lang != "en":
        return label
    # keep acronyms ("Advertising ID", "IMEI number"), lower-case ordinary labels
    words = label.split()
    if any(sum(ch.isupper() for ch in w) >= 2 for w in words):
        return label
    return label[:1].lower() + label[1:]


def _is_are(label: str) -> str:
    last = label.split()[-1].lower() if label else ""
    return "are" if last.endswith("s") and not last.endswith("ss") else "is"


def render_summary(onto: Ontology, rule_id: str, data_type: str, *, action: str = "collect",
                   sdk: str | None = None, lang: str = "en") -> str:
    t = _templates().get(lang) or _templates()["en"]
    tpl = t["summary"].get(rule_id) or _templates()["en"]["summary"][rule_id]
    label = inline_label(onto, data_type, lang)
    return tpl.format(
        label=label,
        is_are=_is_are(label),
        action_past=t["action_past"].get(action, action),
        sdk=sdk or "",
    )


def benign_explanations(rule_id: str, *, lang: str = "en") -> list[str]:
    t = _templates().get(lang) or _templates()["en"]
    b = t["benign"]
    if rule_id.startswith("IC"):
        return list(b["IC"])
    if rule_id.startswith("DM"):
        return list(b["DM"])
    if rule_id in ("BM-01", "BM-03"):
        return list(b["BM_permission"])
    return list(b["BM_sdk"])


# ------------------------------------------------------------------ report card and indicators


def text(lang: str, *path: str) -> str:
    """A template string by path (e.g. "card", "not_checked"); falls back to English."""
    for lg in (lang, "en"):
        node: Any = _templates().get(lg) or {}
        for p in path:
            node = node.get(p) if isinstance(node, dict) else None
        if isinstance(node, str):
            return node
    raise KeyError("/".join(path))


def has_text(*path: str) -> bool:
    try:
        text("en", *path)
    except KeyError:
        return False
    return True


def render_indicator(onto: Ontology, rule_id: str, data_type: str, *, sdk: str | None = None, lang: str = "en") -> str:
    return text(lang, "indicator", rule_id).format(label=inline_label(onto, data_type, lang), sdk=sdk or "")


def join_labels(labels: list[str], lang: str) -> str:
    """"a", "a and b", "a, b and c" (en) with the same shape in hi."""
    word = text(lang, "answers", "and_word")
    if len(labels) <= 1:
        return "".join(labels)
    return f"{', '.join(labels[:-1])} {word} {labels[-1]}"
