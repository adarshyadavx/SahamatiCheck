"""Plain "where does my data go" view of a report (Report.data_flows).

One row per data type that any source says is collected, used, kept, shared or sold, or that the
app's code can reach. Each row says *what* (the data type), *why* (purposes), *to whom* (recipients
other than the app developer), *who says so* (sources) and which findings touch it. It only
regroups claims the pipeline already extracted; it adds no new judgement (CLAUDE.md rules 1, 5).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from sahamati_core.engine import EngineFinding
from sahamati_core.ontology import Ontology
from sahamati_core.schema import Action, ClaimTuple, Polarity, SourceKind
from sahamati_core.schema.report import DataFlow, FlowEvidence, Labelled

_FIRST_PARTY = {"first_party", "any_party"}
_KEEP_ACTIONS = {Action.COLLECT, Action.USE, Action.RETAIN}
_GIVE_ACTIONS = {Action.SHARE, Action.SELL}
_SOURCE_ORDER = {"data_safety": 0, "policy": 1, "apk": 2}
# Display labels that differ from the ontology label. Play's own purpose name contains a word
# CLAUDE.md rule 4 keeps out of everything we write, so the plain view says what it means instead.
_DISPLAY_LABELS: dict[str, tuple[str, str]] = {
    "fraud_prevention": ("Security and abuse prevention", "सुरक्षा और दुरुपयोग की रोकथाम"),
}
MAX_QUOTES = 3
MAX_QUOTE_CHARS = 280


def _src(c: ClaimTuple) -> str:
    return "apk" if c.source_kind in (SourceKind.APK_PERMISSION, SourceKind.APK_SDK) else c.source_kind.value


@dataclass
class _Acc:
    collected: bool = False
    shared: bool = False
    sold: bool = False
    collect_purposes: dict[str, None] = field(default_factory=dict)
    share_purposes: dict[str, None] = field(default_factory=dict)
    recipients: dict[str, None] = field(default_factory=dict)
    sources: set[str] = field(default_factory=set)
    denied: set[str] = field(default_factory=set)
    quotes: list[FlowEvidence] = field(default_factory=list)


def _labelled(onto: Ontology, kind: str, ids: Iterable[str]) -> list[Labelled]:
    h = onto.hierarchy(kind)  # type: ignore[arg-type]
    out: list[Labelled] = []
    for i in ids:
        if i in h:
            en, hi = _DISPLAY_LABELS.get(i, (h.label(i, "en"), h.label(i, "hi")))
            out.append(Labelled(id=i, label_en=en, label_hi=hi))
    return out


def build_data_flows(onto: Ontology, claims: list[ClaimTuple],
                     findings: list[tuple[str, EngineFinding]]) -> list[DataFlow]:
    dt = onto.data_types
    acc: dict[str, _Acc] = {}
    for c in claims:
        if c.synthetic or c.polarity == Polarity.VAGUE or c.data_type not in dt:
            continue
        src = _src(c)
        if c.polarity == Polarity.DENY:
            continue  # denials are attached below, only to rows something affirms
        a = acc.setdefault(c.data_type, _Acc())
        a.sources.add(src)
        purposes = c.purposes or ([c.condition] if c.condition else [])
        if c.action in _GIVE_ACTIONS or c.actor not in _FIRST_PARTY:
            a.shared = True
            a.sold = a.sold or c.action == Action.SELL
            a.recipients[c.actor if c.actor not in _FIRST_PARTY else "third_party"] = None
            for p in purposes:
                a.share_purposes[p] = None
            a.collected = True  # Play and the engine both treat sharing as implying collection
        if c.action in _KEEP_ACTIONS or src == "apk":
            a.collected = True
            for p in purposes:
                a.collect_purposes[p] = None
        if len(a.quotes) < MAX_QUOTES and c.evidence.text and not any(
                q.source == src and q.quote == c.evidence.text[:MAX_QUOTE_CHARS] for q in a.quotes):
            a.quotes.append(FlowEvidence(source=src, quote=c.evidence.text[:MAX_QUOTE_CHARS],  # type: ignore[arg-type]
                                         url=c.evidence.url))

    # A broad affirmation ("we collect personal information") only earns its own row when nothing
    # more specific under it is mentioned; otherwise it would duplicate the specific rows.
    keep = [t for t in acc if not (dt.is_root(t) and any(u != t and dt.subsumes(t, u) for u in acc))]

    # "Says it does not": a denial of sharing only speaks to rows that are shared; a denial of
    # collecting or using speaks to every row it covers.
    for c in claims:
        if c.polarity != Polarity.DENY or c.synthetic or c.data_type not in dt:
            continue
        for t in keep:
            if dt.subsumes(c.data_type, t) and (c.action not in _GIVE_ACTIONS or acc[t].shared):
                acc[t].denied.add(_src(c))

    rows: list[DataFlow] = []
    for t in keep:
        a = acc[t]
        # A finding belongs to a row through its specific data types; a broad side ("personal
        # information") would otherwise attach it to every row.
        fids = [fid for fid, f in findings
                if any(x in dt and not dt.is_root(x) and (dt.subsumes(x, t) or dt.subsumes(t, x))
                       for x in (f.overlap, f.a.data_type, f.b.data_type))]
        rows.append(DataFlow(
            data_type=t,
            label_en=dt.label(t, "en"),
            label_hi=dt.label(t, "hi"),
            category=dt.report_category(t),  # type: ignore[arg-type]
            collected=a.collected,
            shared=a.shared,
            sold=a.sold,
            collect_purposes=_labelled(onto, "purpose", a.collect_purposes),
            share_purposes=_labelled(onto, "purpose", a.share_purposes),
            recipients=_labelled(onto, "actor", a.recipients),
            sources=sorted(a.sources, key=_SOURCE_ORDER.__getitem__),  # type: ignore[arg-type]
            denied_by=sorted(a.denied & {"policy", "data_safety"}, key=_SOURCE_ORDER.__getitem__),  # type: ignore[arg-type]
            finding_ids=fids,
            evidence=sorted(a.quotes, key=lambda q: _SOURCE_ORDER[q.source]),
        ))
    # Shared data first (that is what leaves the app), then by category and name.
    rows.sort(key=lambda r: (not r.shared, not r.finding_ids, r.category or "zz", r.label_en))
    return rows


__all__ = ["build_data_flows"]
