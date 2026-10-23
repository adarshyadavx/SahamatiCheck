"""Play data-safety declaration -> claim tuples.

Documented input schema: `sahamati.data_safety/v1`
------------------------------------------------
{
  "schema": "sahamati.data_safety/v1",
  "package": "in.example.chaiwallet",
  "captured_at": "2026-10-19",            # ISO date the declaration was read
  "source": "play_listing" | "self_check" | "fixture",
  "no_data_collected": false,             # Play: "No data collected"
  "no_data_shared": false,                # Play: "No data shared with third parties"
  "data_types": [
    {
      "category": "Location",             # Play category label (optional; helps disambiguate)
      "type": "Precise location",         # Play type label (ds_vocab.yaml)
      "collected": true,                  # true / false (false + shared false = declared NOT collected)
      "shared": false,
      "optional": false,
      "ephemeral": false,
      "purposes_collected": ["Fraud prevention, security, and compliance"],
      "purposes_shared": []
    }
  ],
  "security_practices": {"encrypted_in_transit": true, "deletion_request": true}
}

An entry with `collected: false` and `shared: false` is an explicit declaration
that the type is not collected (from the developer's own Play Console answers in
self-check, or a fixture). Types that are absent are *silent*, never a denial.

Play does not count transfers to service providers or for legal reasons as
"sharing", so every "not shared" denial carries those actors as exceptions.

`from_play_scraper()` converts the node `google-play-scraper` `datasafety()`
shape ({sharedData, collectedData, securityPractices}) into this schema.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sahamati_core.ontology import Ontology, load_ontology
from sahamati_core.schema import Action, ClaimTuple, EvidenceSpan, NegationMethod, Polarity, SourceKind

SCHEMA_ID = "sahamati.data_safety/v1"
DS_CONFIDENCE = 0.98  # deterministic mapping
DASH = " — "


@dataclass
class DeclarationResult:
    tuples: list[ClaimTuple] = field(default_factory=list)
    unmapped: list[str] = field(default_factory=list)
    captured_at: str = ""


def _norm(s: str) -> str:
    return " ".join(str(s).lower().replace(",", " ").split())


def _lookup_type(onto: Ontology, category: str | None, type_label: str) -> str | None:
    t = _norm(type_label)
    cands = [e for e in onto.ds_types if _norm(e.type) == t]
    if category and len(cands) > 1:
        c = _norm(category)
        cands = [e for e in cands if _norm(e.category) == c] or cands
    if cands:
        return cands[0].data_type
    # tolerate a data-type id or an ontology alias
    if type_label in onto.data_types:
        return type_label
    for node in onto.data_types.nodes.values():
        if t in node.aliases or t == _norm(node.label_en):
            return node.id
    return None


def _purpose_ids(onto: Ontology, labels: list[str]) -> list[str]:
    out: list[str] = []
    norm_map = {_norm(k): v for k, v in onto.ds_purposes.items()}
    for lab in labels or []:
        pid = norm_map.get(_norm(lab)) or (lab if lab in onto.purposes else None)
        if pid and pid not in out:
            out.append(pid)
    return out


def map_declaration(ds: dict[str, Any], *, ontology: Ontology | None = None, source_id: str = "") -> DeclarationResult:
    onto = ontology or load_ontology()
    captured = str(ds.get("captured_at", ""))
    res = DeclarationResult(captured_at=captured)
    exemptions = list(onto.sharing_exemptions)

    def mk(
        *, actor: str, action: Action, dt: str, pol: Polarity, label: str, locator: str,
        purposes: list[str] | None = None, exceptions: list[str] | None = None, synthetic: bool = False,
    ) -> ClaimTuple:
        p = purposes or []
        return ClaimTuple(
            actor=actor, action=action, data_type=dt, condition=p[0] if p else None, purposes=p,
            polarity=pol, exceptions=exceptions or [], source_kind=SourceKind.DATA_SAFETY,
            evidence=EvidenceSpan(source_id=source_id, text=label, locator=locator, captured_at=captured),
            confidence=DS_CONFIDENCE, extractor="mapping", extractor_version="ds-mapping@0.1.0",
            ontology_version=onto.version,
            negation_method=NegationMethod.MAPPING if pol == Polarity.DENY else None, synthetic=synthetic,
        )

    for i, entry in enumerate(ds.get("data_types") or []):
        type_label = str(entry.get("type", ""))
        dt = _lookup_type(onto, entry.get("category"), type_label)
        if dt is None:
            res.unmapped.append(type_label)
            continue
        collected = bool(entry.get("collected", False))
        shared = bool(entry.get("shared", False))
        p_col = _purpose_ids(onto, entry.get("purposes_collected") or [])
        p_sh = _purpose_ids(onto, entry.get("purposes_shared") or [])
        loc = f"data_types[{i}]"
        if collected:
            label = DASH.join([type_label, "Collected"] + list(entry.get("purposes_collected") or [])[:1])
            res.tuples.append(mk(actor="first_party", action=Action.COLLECT, dt=dt, pol=Polarity.AFFIRM,
                                 label=label, locator=f"{loc}.collected", purposes=p_col))
        if shared:
            label = DASH.join([type_label, "Shared"] + list(entry.get("purposes_shared") or [])[:1])
            res.tuples.append(mk(actor="third_party", action=Action.SHARE, dt=dt, pol=Polarity.AFFIRM,
                                 label=label, locator=f"{loc}.shared", purposes=p_sh))
        if not collected and not shared:
            res.tuples.append(mk(actor="first_party", action=Action.COLLECT, dt=dt, pol=Polarity.DENY,
                                 label=DASH.join([type_label, "Not collected"]), locator=f"{loc}.not_collected"))
        elif collected and not shared and ds.get("no_data_shared") is not True and entry.get("shared") is False:
            # an explicit "shared": false on a collected type is a per-type "not shared"
            res.tuples.append(mk(actor="third_party", action=Action.SHARE, dt=dt, pol=Polarity.DENY,
                                 label=DASH.join([type_label, "Not shared"]), locator=f"{loc}.not_shared",
                                 exceptions=exemptions, synthetic=True))

    for root in onto.data_types.roots:
        if ds.get("no_data_shared") is True:
            res.tuples.append(mk(actor="third_party", action=Action.SHARE, dt=root, pol=Polarity.DENY,
                                 label="No data shared with third parties", locator="no_data_shared",
                                 exceptions=exemptions, synthetic=True))
        if ds.get("no_data_collected") is True:
            res.tuples.append(mk(actor="first_party", action=Action.COLLECT, dt=root, pol=Polarity.DENY,
                                 label="No data collected", locator="no_data_collected", synthetic=True))
    return res


def from_play_scraper(raw: dict[str, Any], *, package: str, captured_at: str) -> dict[str, Any]:
    """Convert node google-play-scraper `datasafety()` output into sahamati.data_safety/v1."""
    by_type: dict[str, dict[str, Any]] = {}

    def ingest(items: list[dict[str, Any]] | None, kind: str) -> None:
        for it in items or []:
            t = str(it.get("data", "")).strip()
            if not t:
                continue
            e = by_type.setdefault(t, {"category": it.get("type"), "type": t, "collected": False, "shared": False,
                                       "optional": bool(it.get("optional", False)), "purposes_collected": [],
                                       "purposes_shared": []})
            purposes = [p.strip() for p in str(it.get("purpose", "")).split(",") if p.strip()]
            # Play joins purposes with ", " but one purpose itself contains commas
            joined = ", ".join(purposes)
            fixed = joined.replace("Fraud prevention, security, and compliance", "\u0000").split(", ")
            purposes = [p.replace("\u0000", "Fraud prevention, security, and compliance") for p in fixed if p]
            e[kind] = True
            e[f"purposes_{kind}"] = purposes

    ingest(raw.get("collectedData"), "collected")
    ingest(raw.get("sharedData"), "shared")
    # Play lists only declared types; we never synthesise "collected: false" for absent types.
    out = {
        "schema": SCHEMA_ID,
        "package": package,
        "captured_at": captured_at,
        "source": "play_listing",
        "no_data_collected": not raw.get("collectedData"),
        "no_data_shared": not raw.get("sharedData"),
        "data_types": list(by_type.values()),
        "security_practices": {},
    }
    # an entry present only in sharedData stays collected=False, shared=True (Play semantics)
    return out
