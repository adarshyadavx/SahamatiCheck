"""SahamatiCheck core library: ontology, extractors, conflict engine and report builder.

Pure Python: no web framework imports. All analysis logic lives here (CLAUDE.md rule 5).
"""

from __future__ import annotations

import os
from pathlib import Path

# 0.2.0: adjacent-negation certainty, purpose/data-type phrase fix, rule registry and report card (PLAN.md §4.9).
# Reports stored by an older engine have the old payload shape and are not served (see repo.get_report_row).
ENGINE_VERSION = "0.2.0"
EXTRACTOR_VERSION = "rules@0.1.0"

_PKG_DIR = Path(__file__).resolve().parent


def ontology_dir() -> Path:
    """Directory holding the ontology YAML files.

    Resolution order: $SAHAMATI_ONTOLOGY_DIR, the source checkout (backend/core/ontology),
    then the copy bundled into the wheel (sahamati_core/_ontology_data).
    """
    env = os.environ.get("SAHAMATI_ONTOLOGY_DIR")
    if env:
        return Path(env)
    src = _PKG_DIR.parent / "ontology"
    if src.is_dir():
        return src
    return _PKG_DIR / "_ontology_data"


def registry_dir() -> Path:
    """Directory holding the rule registry YAML (backend/core/rules/registry), or the wheel copy."""
    env = os.environ.get("SAHAMATI_REGISTRY_DIR")
    if env:
        return Path(env)
    src = _PKG_DIR.parent / "rules" / "registry"
    if src.is_dir():
        return src
    return _PKG_DIR / "_registry_data"


def package_dir() -> Path:
    return _PKG_DIR


def demo_fixtures_dir() -> Path:
    return _PKG_DIR / "demo" / "fixtures"
