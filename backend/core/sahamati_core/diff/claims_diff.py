"""Policy Drift: semantic diff of two claim sets, keyed per (actor, action, data_type).

Change kinds:
  added            a key present only in the new set
  removed          a key present only in the old set
  polarity_flipped same key, different polarity
  broadened        an old key was replaced by the same (actor, action, polarity)
                   on an ancestor data type (the claim moved up the ontology)
A change set is *silent* when claims changed but the "last updated" text did not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from sahamati_core.ontology import Ontology, load_ontology
from sahamati_core.schema import ClaimTuple, Polarity

ChangeKind = Literal["added", "removed", "polarity_flipped", "broadened"]
Key = tuple[str, str, str]  # actor, action, data_type


@dataclass(frozen=True)
class ClaimChange:
    kind: ChangeKind
    actor: str
    action: str
    data_type: str
    before: dict[str, str] | None = None
    after: dict[str, str] | None = None


@dataclass
class ClaimDiff:
    changes: list[ClaimChange] = field(default_factory=list)
    silent: bool = False

    def by_kind(self, kind: ChangeKind) -> list[ClaimChange]:
        return [c for c in self.changes if c.kind == kind]


def _index(claims: list[ClaimTuple]) -> dict[Key, ClaimTuple]:
    out: dict[Key, ClaimTuple] = {}
    for c in claims:
        if c.polarity == Polarity.VAGUE:
            continue
        k = (c.actor, c.action.value, c.data_type)
        # if a key appears with both polarities in one version, DENY wins (the more cautious reading)
        if k not in out or c.polarity == Polarity.DENY:
            out[k] = c
    return out


def _view(c: ClaimTuple) -> dict[str, str]:
    return {"polarity": c.polarity.value, "data_type": c.data_type, "quote": c.evidence.text[:300]}


def diff_claims(
    old: list[ClaimTuple],
    new: list[ClaimTuple],
    *,
    old_last_updated: str | None = None,
    new_last_updated: str | None = None,
    ontology: Ontology | None = None,
) -> ClaimDiff:
    onto = ontology or load_ontology()
    dt = onto.data_types
    a, b = _index(old), _index(new)
    changes: list[ClaimChange] = []
    for k in sorted(set(a) & set(b)):
        if a[k].polarity != b[k].polarity:
            changes.append(ClaimChange("polarity_flipped", *k, before=_view(a[k]), after=_view(b[k])))
    removed = {k: a[k] for k in set(a) - set(b)}
    added = {k: b[k] for k in set(b) - set(a)}
    for ak in sorted(added):
        for rk in sorted(removed):
            if (ak[0], ak[1]) == (rk[0], rk[1]) and added[ak].polarity == removed[rk].polarity \
                    and ak[2] != rk[2] and dt.subsumes(ak[2], rk[2]):
                changes.append(ClaimChange("broadened", ak[0], ak[1], ak[2],
                                           before=_view(removed[rk]), after=_view(added[ak])))
                del removed[rk]
                added[ak] = None  # type: ignore[assignment]
                break
    for k, c in sorted(added.items()):
        if c is not None:
            changes.append(ClaimChange("added", *k, after=_view(c)))
    for k, c in sorted(removed.items()):
        changes.append(ClaimChange("removed", *k, before=_view(c)))
    silent = bool(changes) and old_last_updated is not None and old_last_updated == new_last_updated
    return ClaimDiff(changes=changes, silent=silent)
