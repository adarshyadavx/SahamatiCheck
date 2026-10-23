"""Evaluation context and rule candidates (PLAN.md §4.9).

A *candidate* is one thing a rule may match: an engine finding, an engine disclosure gap,
or an APK claim (permission or SDK). Predicates look at candidates; they never see rule ids.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from sahamati_core.engine import EngineFinding, EngineGap, EngineResult
from sahamati_core.ontology import Ontology
from sahamati_core.schema import Action, ClaimTuple, ConflictClass, Polarity, SourceKind

if TYPE_CHECKING:
    from .models import StatusConfig

APK_KINDS = (SourceKind.APK_PERMISSION, SourceKind.APK_SDK)
CandidateKind = Literal["finding", "gap", "apk_claim"]


@dataclass
class EvalContext:
    onto: Ontology
    cfg: StatusConfig
    coverage: Mapping[str, str]  # policy | data_safety | apk | runtime | test_account -> coverage value
    claims: list[ClaimTuple]
    result: EngineResult
    sdk_scan: bool = True  # class list was available and read, so SDK absence is meaningful

    def cov(self, source: str) -> str:
        return str(self.coverage.get(source, "not_attempted"))


@dataclass
class Candidate:
    kind: CandidateKind
    engine_rule: str  # IC-01 | DM-0n | BM-0n | GAP | APK-PERM | APK-SDK
    finding: EngineFinding | None = None
    gap: EngineGap | None = None
    claim: ClaimTuple | None = None
    index: int = -1  # position in EngineResult.findings (findings only)

    # -- sides
    @property
    def deny(self) -> ClaimTuple | None:
        f = self.finding
        if f is None:
            return None
        return f.a if f.a.polarity == Polarity.DENY else f.b

    @property
    def affirm(self) -> ClaimTuple | None:
        f = self.finding
        if f is None:
            return None
        return f.b if f.a.polarity == Polarity.DENY else f.a

    @property
    def claims(self) -> list[ClaimTuple]:
        if self.finding is not None:
            return [self.finding.a, self.finding.b]
        if self.gap is not None:
            return [self.gap.evidence]
        return [self.claim] if self.claim is not None else []

    @property
    def apk_claim(self) -> ClaimTuple | None:
        for c in self.claims:
            if c.source_kind in APK_KINDS:
                return c
        return None

    # -- scalar views
    @property
    def action(self) -> Action:
        """The action a rule reasons about: the denied action for findings, else the claim's."""
        d = self.deny
        if d is not None:
            return d.action
        return self.claims[0].action

    @property
    def data_type(self) -> str:
        if self.finding is not None:
            return self.finding.overlap
        if self.gap is not None:
            return self.gap.data_type
        assert self.claim is not None
        return self.claim.data_type

    @property
    def tier(self) -> str | None:
        return self.finding.tier.value if self.finding is not None else None

    @property
    def conflict_class(self) -> ConflictClass | None:
        return self.finding.cls if self.finding is not None else None

    @property
    def confidence(self) -> float:
        if self.finding is not None:
            return self.finding.confidence
        if self.gap is not None:
            return self.gap.confidence
        assert self.claim is not None
        return self.claim.confidence

    @property
    def claim_confidence(self) -> float:
        return min(c.confidence for c in self.claims)

    def source_kinds(self) -> list[SourceKind]:
        return [c.source_kind for c in self.claims]

    def strength(self, cfg: StatusConfig) -> str:
        """The weaker side's evidence strength (by the configured weights)."""
        names = [cfg.evidence_strength_by_source[k.value] for k in self.source_kinds()]
        return min(names, key=lambda n: cfg.evidence_strength_weights[n])
