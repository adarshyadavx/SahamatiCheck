"""Internal claim model (PLAN.md §4.1). Not part of the public JSON contract;
the public view of a tuple is `ClaimTupleView` in report.py."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .enums import Action, NegationMethod, Polarity, SourceKind


class EvidenceSpan(BaseModel):
    source_id: str = ""
    char_start: int | None = None
    char_end: int | None = None
    text: str = Field(default="", max_length=600)  # verbatim quote / label / permission / sdk prefix
    locator: str | None = None  # "uses-permission[3]", "data_types[2].shared"
    url: str | None = None
    captured_at: str = ""  # ISO date


class ClaimTuple(BaseModel):
    actor: str  # actor ontology id, e.g. "third_party"
    action: Action
    data_type: str  # data-type ontology id, e.g. "advertising_id"
    condition: str | None = None  # purpose ontology id, e.g. "advertising"
    purposes: list[str] = Field(default_factory=list)  # all purposes; condition == purposes[0]
    polarity: Polarity
    exceptions: list[str] = Field(default_factory=list)  # actor / data-type ids carved out
    source_kind: SourceKind
    evidence: EvidenceSpan
    confidence: float = Field(ge=0, le=1)
    extractor: Literal["roberta", "llm", "rule", "mapping"]
    extractor_version: str
    ontology_version: str
    negation_method: NegationMethod | None = None
    synthetic: bool = False  # e.g. expanded from a data-safety "No data shared" statement

    def key(self) -> tuple[str, str, str, str]:
        return (self.source_kind.value, self.actor, self.action.value, self.data_type)

    def evidence_key(self) -> tuple[str, int | None, str]:
        return (self.source_kind.value, self.evidence.char_start, self.evidence.text)
