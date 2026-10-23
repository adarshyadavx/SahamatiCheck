"""Conflict engine: four classes, three tiers (PLAN.md §4.3, CLAUDE.md rules 1-2, 7).

C1 internal_contradiction  policy x policy           strong        IC-01
C2 declaration_mismatch    policy x data-safety      strong        DM-01 policy DENY vs DS AFFIRM
                                                                   DM-02 DS DENY vs policy AFFIRM
                                                                   DM-03 policy AFFIRM-share vs DS "No data shared"
C3 behavioural_mismatch    DENY (policy|DS) x APK    indicative    BM-01..04
C4 disclosure_gap          APK evidence, no non-vague claim on an overlapping type   not_mentioned

A DENY conflicts with an AFFIRM only when the denial *covers* the affirmation:
  * data types overlap by subsumption and the denied type is ancestor-or-self of
    the affirmed type (siblings never overlap; a broad AFFIRM does not contradict a
    narrow DENY);
  * the denied actor is ancestor-or-self of the affirmed actor;
  * the affirmed action equals or implies the denied action (ACTION_IMPLIES);
  * and the pair is not `reconciled()` by an exception carve-out or by purpose.

Cross-source findings whose policy DENY is already contradicted inside the
policy by a statement that agrees with the other source are folded into the
internal contradiction (reported once, as C1).
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from sahamati_core.ontology import Ontology, load_ontology
from sahamati_core.schema import Action, ClaimTuple, ConflictClass, NegationMethod, Polarity, SourceKind, Tier

_CFG_PATH = Path(__file__).with_name("thresholds.yaml")

TIER_OF: dict[ConflictClass, Tier] = {
    ConflictClass.INTERNAL_CONTRADICTION: Tier.STRONG,
    ConflictClass.DECLARATION_MISMATCH: Tier.STRONG,
    ConflictClass.BEHAVIOURAL_MISMATCH: Tier.INDICATIVE,
    ConflictClass.DISCLOSURE_GAP: Tier.NOT_MENTIONED,
}

APK_KINDS = (SourceKind.APK_PERMISSION, SourceKind.APK_SDK)


@dataclass(frozen=True)
class EngineConfig:
    version: str
    weights: dict[str, float]
    thresholds: dict[str, float]
    s_spec_alpha: float
    s_neg_heuristic: float
    s_neg_adjacent: float
    gap_ignore_root_claims: bool
    action_implies: dict[str, frozenset[str]]

    def w(self, c: ConflictClass) -> float:
        return float(self.weights[c.value])

    def tau(self, c: ConflictClass) -> float:
        return float(self.thresholds[c.value])


@lru_cache(maxsize=4)
def load_config(path: str | None = None) -> EngineConfig:
    with open(path or _CFG_PATH, encoding="utf-8") as fh:
        raw: dict[str, Any] = yaml.safe_load(fh)
    return EngineConfig(
        version=str(raw["version"]),
        weights={k: float(v) for k, v in raw["weights"].items()},
        thresholds={k: float(v) for k, v in raw["thresholds"].items()},
        s_spec_alpha=float(raw["s_spec_alpha"]),
        s_neg_heuristic=float(raw["s_neg_heuristic"]),
        s_neg_adjacent=float(raw.get("s_neg_adjacent", 1.0)),
        gap_ignore_root_claims=bool(raw.get("gap_ignore_root_claims", True)),
        action_implies={k: frozenset(v) for k, v in (raw.get("action_implies") or {}).items()},
    )


@dataclass
class EngineFinding:
    cls: ConflictClass
    rule_id: str
    a: ClaimTuple  # first side shown (policy side for C2; the DENY for C1/C3)
    b: ClaimTuple
    overlap: str  # most specific overlapping data-type node
    confidence: float
    suppressed: bool

    @property
    def tier(self) -> Tier:
        return TIER_OF[self.cls]


@dataclass
class EngineGap:
    data_type: str
    evidence: ClaimTuple
    confidence: float
    suppressed: bool


@dataclass
class EngineResult:
    findings: list[EngineFinding] = field(default_factory=list)
    gaps: list[EngineGap] = field(default_factory=list)
    skipped_classes: list[str] = field(default_factory=list)

    @property
    def public_findings(self) -> list[EngineFinding]:
        return [f for f in self.findings if not f.suppressed]

    @property
    def public_gaps(self) -> list[EngineGap]:
        return [g for g in self.gaps if not g.suppressed]


class Engine:
    def __init__(self, ontology: Ontology | None = None, config: EngineConfig | None = None) -> None:
        self.onto = ontology or load_ontology()
        self.cfg = config or load_config()
        self.dt = self.onto.data_types
        self.actors = self.onto.actors
        self.purposes = self.onto.purposes

    # ------------------------------------------------------------ predicates
    def action_conflicts(self, denied: Action, affirmed: Action) -> bool:
        """An AFFIRM of `affirmed` contradicts a DENY of `denied`."""
        return affirmed == denied or denied.value in self.cfg.action_implies.get(affirmed.value, frozenset())

    def actions_agree(self, x: Action, y: Action) -> bool:
        return self.action_conflicts(x, y) or self.action_conflicts(y, x)

    def covers(self, deny: ClaimTuple, affirm: ClaimTuple) -> str | None:
        """Overlap node if `deny` covers `affirm` (ignoring exceptions/purpose), else None."""
        if deny.polarity != Polarity.DENY or affirm.polarity != Polarity.AFFIRM:
            return None
        if not self.action_conflicts(deny.action, affirm.action):
            return None
        node = self.dt.overlaps(deny.data_type, affirm.data_type)
        if node is None or not self.dt.subsumes(deny.data_type, affirm.data_type):
            return None
        if not self.actors.subsumes(deny.actor, affirm.actor):
            return None
        return node

    def _exception_hits(self, exceptions: list[str], other: ClaimTuple) -> bool:
        for e in exceptions:
            if e in self.actors and self.actors.overlaps(e, other.actor):
                return True
            if e in self.dt and self.dt.overlaps(e, other.data_type):
                return True
        return False

    def reconciled(self, deny: ClaimTuple, affirm: ClaimTuple) -> bool:
        """True when an exception carve-out or the purpose makes the pair consistent."""
        if self._exception_hits(deny.exceptions, affirm) or self._exception_hits(affirm.exceptions, deny):
            return True
        deny_p = deny.purposes or ([deny.condition] if deny.condition else [])
        if deny_p:
            aff_p = affirm.purposes or ([affirm.condition] if affirm.condition else [])
            if not aff_p:
                return True  # a purpose-limited denial cannot be shown to conflict
            if not any(self.purposes.overlaps(p, q) for p in deny_p for q in aff_p):
                return True
        return False

    def agrees(self, x: ClaimTuple, y: ClaimTuple) -> bool:
        """Two AFFIRMs that describe the same practice (used for folding)."""
        return (
            x.polarity == Polarity.AFFIRM
            and y.polarity == Polarity.AFFIRM
            and self.dt.overlaps(x.data_type, y.data_type) is not None
            and self.actions_agree(x.action, y.action)
            and self.actors.overlaps(x.actor, y.actor) is not None
        )

    def confidence(self, cls: ConflictClass, deny: ClaimTuple, affirm: ClaimTuple) -> float:
        gap = abs(self.dt.depth(deny.data_type) - self.dt.depth(affirm.data_type))
        s_spec = 1.0 / (1.0 + self.cfg.s_spec_alpha * gap)
        s_neg = {NegationMethod.HEURISTIC: self.cfg.s_neg_heuristic,
                 NegationMethod.ADJACENT: self.cfg.s_neg_adjacent}.get(deny.negation_method, 1.0)  # type: ignore[arg-type]
        return round(self.cfg.w(cls) * min(deny.confidence, affirm.confidence) * s_spec * s_neg, 2)

    # ------------------------------------------------------------ classes
    def _mk(self, cls: ConflictClass, rule: str, a: ClaimTuple, b: ClaimTuple, deny: ClaimTuple,
            affirm: ClaimTuple, node: str) -> EngineFinding:
        conf = self.confidence(cls, deny, affirm)
        return EngineFinding(cls=cls, rule_id=rule, a=a, b=b, overlap=node, confidence=conf,
                             suppressed=conf < self.cfg.tau(cls))

    def _folded(self, deny: ClaimTuple, other: ClaimTuple, same_source: list[ClaimTuple]) -> bool:
        """The DENY is contradicted inside its own policy by a statement agreeing with `other`."""
        if deny.source_kind != SourceKind.POLICY:
            return False
        for s in same_source:
            if s is deny or s.polarity != Polarity.AFFIRM:
                continue
            if self.covers(deny, s) and self.agrees(s, other):
                return True
        return False

    def internal_contradictions(self, policy: list[ClaimTuple]) -> list[EngineFinding]:
        out: list[EngineFinding] = []
        claims = [c for c in policy if c.polarity != Polarity.VAGUE]
        for x, y in itertools.combinations(claims, 2):
            if x.evidence.char_start is not None and x.evidence.char_start == y.evidence.char_start:
                continue  # same sentence
            for deny, affirm in ((x, y), (y, x)):
                node = self.covers(deny, affirm)
                if node and not self.reconciled(deny, affirm):
                    out.append(self._mk(ConflictClass.INTERNAL_CONTRADICTION, "IC-01", deny, affirm,
                                        deny, affirm, node))
        return out

    def declaration_mismatches(self, policy: list[ClaimTuple], ds: list[ClaimTuple]) -> list[EngineFinding]:
        out: list[EngineFinding] = []
        for p in policy:
            if p.polarity == Polarity.VAGUE:
                continue
            for d in ds:
                if p.polarity == Polarity.DENY and d.polarity == Polarity.AFFIRM:
                    node = self.covers(p, d)
                    if node and not self.reconciled(p, d) and not self._folded(p, d, policy):
                        out.append(self._mk(ConflictClass.DECLARATION_MISMATCH, "DM-01", p, d, p, d, node))
                elif p.polarity == Polarity.AFFIRM and d.polarity == Polarity.DENY:
                    node = self.covers(d, p)
                    if node and not self.reconciled(d, p):
                        rule = "DM-03" if (d.synthetic and d.evidence.locator == "no_data_shared") else "DM-02"
                        out.append(self._mk(ConflictClass.DECLARATION_MISMATCH, rule, p, d, d, p, node))
        return out

    def behavioural_mismatches(self, policy: list[ClaimTuple], ds: list[ClaimTuple],
                               apk: list[ClaimTuple]) -> list[EngineFinding]:
        out: list[EngineFinding] = []
        for deny in [c for c in policy + ds if c.polarity == Polarity.DENY]:
            same = policy if deny.source_kind == SourceKind.POLICY else ds
            for e in apk:
                node = self.covers(deny, e)
                if not node or self.reconciled(deny, e) or self._folded(deny, e, same):
                    continue
                from_ds = deny.source_kind == SourceKind.DATA_SAFETY
                perm = e.source_kind == SourceKind.APK_PERMISSION
                rule = {(True, True): "BM-01", (True, False): "BM-02", (False, True): "BM-03",
                        (False, False): "BM-04"}[(from_ds, perm)]
                out.append(self._mk(ConflictClass.BEHAVIOURAL_MISMATCH, rule, deny, e, deny, e, node))
        return out

    def disclosure_gaps(self, policy: list[ClaimTuple], ds: list[ClaimTuple],
                        apk: list[ClaimTuple]) -> list[EngineGap]:
        mentions = [c for c in policy + ds if c.polarity != Polarity.VAGUE]
        if self.cfg.gap_ignore_root_claims:
            mentions = [c for c in mentions if not self.dt.is_root(c.data_type)]
        by_type: dict[str, EngineGap] = {}
        w = self.cfg.w(ConflictClass.DISCLOSURE_GAP)
        tau = self.cfg.tau(ConflictClass.DISCLOSURE_GAP)
        for e in apk:
            if any(self.dt.overlaps(m.data_type, e.data_type) for m in mentions):
                continue
            conf = round(w * e.confidence, 2)
            cur = by_type.get(e.data_type)
            better = cur is None or (
                (e.source_kind == SourceKind.APK_PERMISSION, conf)
                > (cur.evidence.source_kind == SourceKind.APK_PERMISSION, cur.confidence)
            )
            if better:
                by_type[e.data_type] = EngineGap(data_type=e.data_type, evidence=e, confidence=conf,
                                                 suppressed=conf < tau)
        return list(by_type.values())

    # ------------------------------------------------------------ entry point
    def run(self, claims: list[ClaimTuple], *, apk_ok: bool = True) -> EngineResult:
        policy = [c for c in claims if c.source_kind == SourceKind.POLICY]
        ds = [c for c in claims if c.source_kind == SourceKind.DATA_SAFETY]
        apk = [c for c in claims if c.source_kind in APK_KINDS and c.polarity == Polarity.AFFIRM]
        res = EngineResult()
        found = self.internal_contradictions(policy) + self.declaration_mismatches(policy, ds)
        if apk_ok:
            found += self.behavioural_mismatches(policy, ds, apk)
            res.gaps = self.disclosure_gaps(policy, ds, apk)
        else:
            res.skipped_classes = [ConflictClass.BEHAVIOURAL_MISMATCH.value, ConflictClass.DISCLOSURE_GAP.value]
        res.findings = _dedupe(found)
        return res


def _side_key(c: ClaimTuple) -> tuple[str, int | None, str]:
    return (c.source_kind.value, c.evidence.char_start, c.evidence.text)


def _dedupe(findings: list[EngineFinding]) -> list[EngineFinding]:
    """One finding per (class, both evidence spans, overlap node); keep the most confident.

    BM findings are further collapsed per (deny evidence, overlap node) so several
    permissions for the same type produce one finding.
    """
    best: dict[tuple[Any, ...], EngineFinding] = {}
    for f in findings:
        if f.cls == ConflictClass.BEHAVIOURAL_MISMATCH:
            key: tuple[Any, ...] = (f.cls, _side_key(f.a), f.overlap, f.b.source_kind.value)
        else:
            pair = tuple(sorted([_side_key(f.a), _side_key(f.b)], key=str))
            key = (f.cls, pair, f.overlap)
        cur = best.get(key)
        if cur is None or f.confidence > cur.confidence:
            best[key] = f
    order = {ConflictClass.DECLARATION_MISMATCH: 0, ConflictClass.INTERNAL_CONTRADICTION: 1,
             ConflictClass.BEHAVIOURAL_MISMATCH: 2}
    return sorted(best.values(), key=lambda f: (order.get(f.cls, 9), -f.confidence, f.overlap))
