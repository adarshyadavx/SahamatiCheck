"""The registry is the single source of truth for the 86-rule catalogue (docs/RULE_CATALOGUE.md is generated)."""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from sahamati_core.rules import load_registry

HERE = Path(__file__).resolve().parent
CATALOGUE: dict[str, str] = json.loads((HERE / "catalogue.json").read_text(encoding="utf-8"))


def test_registry_has_all_86_rules_with_catalogue_names() -> None:
    reg = load_registry()
    assert len(CATALOGUE) == 86
    assert {r.id for r in reg.rules} == set(CATALOGUE)
    for r in reg.rules:
        assert r.name == CATALOGUE[r.id], r.id


def test_catalogue_totals_match_the_plan() -> None:
    reg = load_registry()
    assert Counter(r.catalogue.static_check for r in reg.rules) == {"yes": 35, "partial": 40, "no_inconclusive": 11}
    phase1 = [r.id for r in reg.rules if r.catalogue.phase_note.split()[0].strip(",") == "1"]
    assert len(phase1) == 16
    assert Counter(r.family for r in reg.rules) == {"P": 12, "D": 12, "T": 12, "A": 14, "C": 12, "S": 12, "AI": 12}


def test_disabled_rules_never_run_and_are_marked_unavailable() -> None:
    reg = load_registry()
    disabled = [r for r in reg.rules if not r.enabled]
    assert len(disabled) == 71 and not {r.id for r in disabled} & {r.id for r in reg.runnable()}
    assert all(r.plain_language.startswith("This check is not available") for r in disabled)
    # a runtime-only static check can never be settled statically
    assert all(r.catalogue.max_status_static.startswith("inconclusive") for r in reg.rules
               if r.catalogue.static_check == "no_inconclusive" and r.id not in {"S12"} and r.id != "S06")


def test_rule_catalogue_markdown_is_up_to_date() -> None:
    md = HERE.parents[2] / "docs" / "RULE_CATALOGUE.md"
    out = subprocess.run([sys.executable, "-m", "sahamati_core.rules", "--check-catalogue-md", str(md)],
                         capture_output=True, text=True, check=False)
    assert out.returncode == 0, out.stdout + out.stderr
