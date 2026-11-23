"""Policy sentence -> claim tuples.

`RuleExtractor` (extractor="rule") is the default. Any other extractor (a
fine-tuned roberta, an LLM) plugs in by implementing the `Extractor` protocol.

Rule pipeline per sentence:
  1. cut out exception clauses ("except", "unless", "other than", ...); the ids
     found inside them become `exceptions` (carve-outs) on every tuple;
  2. alias-match data types, actors and purposes against the ontology YAML
     (longest match first, no overlapping matches);
  3. find action verbs; resolve negation per verb (cue words in a short window
     before the verb, inside the same clause; or a negative determiner "no"
     directly before the data type). spaCy dependency arcs override the
     heuristic when spaCy and a model are installed;
  4. vague class: a hedge ("may", "certain information", "from time to time",
     ...) with no specific (non-root) data type, or a generic object such as
     "information" with no ontology match at all.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Protocol
from urllib.parse import quote

from sahamati_core import EXTRACTOR_VERSION
from sahamati_core.ontology import Hierarchy, Ontology, load_ontology
from sahamati_core.schema import (
    Action,
    ClaimTuple,
    EvidenceSpan,
    NegationMethod,
    Polarity,
    SourceKind,
)

from .segment import Sentence, split_sentences

# ------------------------------------------------------------------ lexicon

# optional auxiliary + cue + optional "ever", then the verb: the unambiguous negation shapes
_ADJ_NEG = re.compile(
    r"(?<![\w-])(?:(?:do|does|did|will|would|shall|can|could)\s+)?(?:not|never|cannot)(?:\s+ever)?\s*$"
    r"|n['\u2019]t\s*$"
)

ACTION_PATTERNS: dict[Action, str] = {
    Action.SELL: r"sell|sells|selling|sold",
    Action.SHARE: r"share|shares|shared|sharing|disclose|discloses|disclosed|disclosing|transfer|transfers|"
    r"transferred|transferring|make\s+available|made\s+available",
    Action.COLLECT: r"collect|collects|collected|collecting|gather|gathers|gathered|gathering|obtain|obtains|"
    r"obtained|receive|receives|received|record|records|recorded|capture|captures|captured|"
    r"access|accesses|accessed|acquire|acquires|acquired|ask\s+for|asks\s+for",
    Action.USE: r"use|uses|used|using|process|processes|processed|processing|analy[sz]e|analy[sz]es|analy[sz]ed",
    Action.RETAIN: r"retain|retains|retained|retaining|store|stores|stored|storing|keep|keeps|kept|preserve|preserved",
}
_VERB_RE = {a: re.compile(rf"(?<![\w-])(?:{p})(?![\w-])") for a, p in ACTION_PATTERNS.items()}

_NEG_CUE = re.compile(r"(?<![\w-])(not|never|no\s+longer|neither|nor|cannot)(?![\w-])|n['’]t(?![\w-])")
_YOU_BEFORE = re.compile(r"(?<![\w-])you(?:\s+(?:do|does|did|will|would|can|may))?\s*$")
_NEG_DET = re.compile(r"(?<![\w-])(no|none\s+of(?:\s+your)?|nothing\s+about(?:\s+your)?)\s+(?:\w+\s+)?$")
_CLAUSE_BREAK = re.compile(r"[,;:]|\bbut\b|\bhowever\b|\bwhile\b|\bwhereas\b")
_EXC_CUE = re.compile(
    r"(?<![\w-])(except|unless|other\s+than|excluding|apart\s+from|with\s+the\s+exception\s+of|save\s+for)(?![\w-])"
)
_EXC_END = re.compile(r";|\bbut\b|\bhowever\b")
_HEDGE = re.compile(
    r"(?<![\w-])(may|might|could|from\s+time\s+to\s+time|certain|some|various|other\s+information|"
    r"as\s+needed|where\s+appropriate|including\s+but\s+not\s+limited\s+to|as\s+necessary|"
    r"and\s+the\s+like|among\s+other\s+things)(?![\w-])"
)
_GENERIC_OBJ = re.compile(r"(?<![\w-])(information|data|details)(?![\w-])")
_NOUN_MARKERS = {
    "the", "a", "an", "this", "that", "your", "our", "their", "its", "grant", "give", "allow", "have",
    "provide", "deny", "revoke", "request", "permission", "camera", "location", "storage",
}
# words that make a "we/our" subject explicit; third-party subjects come from actor aliases
_FIRST_PARTY_IDS = {"first_party", "any_party"}
# "we / us / our" marks the app itself as the subject. Without it (and without a named actor),
# defaulting to first_party is a guess: real policies say "the bot can see…", "payment providers
# store…", "engineers cannot access…". Such reads are kept but with lower confidence.
_FIRST_PERSON = re.compile(r"(?<![\w-])(?:we|us|our|ours|ourselves)(?![\w-])", re.I)
UNATTRIBUTED_PENALTY = 0.25


@dataclass(frozen=True)
class Match:
    start: int
    end: int
    node_id: str


@dataclass
class SentenceResult:
    sentence: Sentence
    tuples: list[ClaimTuple] = field(default_factory=list)
    vague: bool = False
    confidence: float = 0.0
    needs_fallback: bool = False  # hard case: negation + exception, or low confidence


class Extractor(Protocol):
    name: str
    version: str

    def extract_sentence(self, sentence: Sentence, *, ctx: ExtractContext) -> SentenceResult: ...


@dataclass
class ExtractContext:
    source_id: str = ""
    url: str | None = None
    captured_at: str = ""


# ------------------------------------------------------------------ alias index


@dataclass
class _AliasIndex:
    regex: re.Pattern[str]
    lookup: dict[str, str]


def _build_index(h: Hierarchy, *, include_ids: bool = True, skip: set[str] | None = None) -> _AliasIndex:
    lookup: dict[str, str] = {}
    for node in h.nodes.values():
        if skip and node.id in skip:
            continue
        phrases = list(node.aliases)
        if include_ids:
            phrases.append(node.id.replace("_", " "))
        for ph in phrases:
            ph = ph.strip().lower()
            if ph and ph not in lookup:
                lookup[ph] = node.id
    alts = sorted(lookup, key=len, reverse=True)
    body = "|".join(re.escape(a).replace(r"\ ", r"\s+") for a in alts)
    return _AliasIndex(regex=re.compile(rf"(?<![\w-])(?:{body})(?![\w-])"), lookup=lookup)


@lru_cache(maxsize=4)
def _indices(version: str, ident: int) -> tuple[_AliasIndex, _AliasIndex, _AliasIndex]:
    onto = _ONTO_REGISTRY[ident]
    return (
        _build_index(onto.data_types, include_ids=False),
        _build_index(onto.actors, include_ids=False, skip=_FIRST_PARTY_IDS),
        _build_index(onto.purposes, include_ids=False),
    )


_ONTO_REGISTRY: dict[int, Ontology] = {}


def _match_all(idx: _AliasIndex, text: str) -> list[Match]:
    out: list[Match] = []
    for m in idx.regex.finditer(text):
        key = re.sub(r"\s+", " ", m.group(0))
        nid = idx.lookup.get(key)
        if nid:
            out.append(Match(m.start(), m.end(), nid))
    return out  # regex alternation is longest-first and finditer is non-overlapping


def _mask(text: str, spans: list[tuple[int, int]]) -> str:
    chars = list(text)
    for s, e in spans:
        for i in range(s, e):
            chars[i] = " "
    return "".join(chars)


def text_fragment(quote_text: str, words: int = 8) -> str:
    toks = quote_text.split()
    start = " ".join(toks[:words]).rstrip(".,;:")
    return "#:~:text=" + quote(start, safe="")


# ------------------------------------------------------------------ optional spaCy


@lru_cache(maxsize=1)
def _spacy_nlp():  # type: ignore[no-untyped-def]
    try:
        import spacy  # type: ignore[import-not-found]

        return spacy.load("en_core_web_sm")
    except Exception:  # noqa: BLE001 - optional
        return None


def _spacy_negated_verbs(text: str) -> dict[int, bool] | None:
    """char offset of each verb token -> negated (via a `neg` dependency arc)."""
    nlp = _spacy_nlp()
    if nlp is None:
        return None
    doc = nlp(text)
    out: dict[int, bool] = {}
    for tok in doc:
        if tok.pos_ in ("VERB", "AUX"):
            neg = any(c.dep_ == "neg" for c in tok.children)
            # negation on an auxiliary/head propagates to xcomp / conj verbs
            head = tok.head
            if not neg and tok.dep_ in ("conj", "xcomp") and head is not tok:
                neg = any(c.dep_ == "neg" for c in head.children)
            out[tok.idx] = neg
    return out


# ------------------------------------------------------------------ rule extractor


class RuleExtractor:
    name = "rule"
    version = EXTRACTOR_VERSION

    def __init__(self, ontology: Ontology | None = None, *, use_spacy: bool = True) -> None:
        self.onto = ontology or load_ontology()
        _ONTO_REGISTRY[id(self.onto)] = self.onto
        self.dt_idx, self.actor_idx, self.purpose_idx = _indices(self.onto.version, id(self.onto))
        self.use_spacy = use_spacy

    # -- helpers
    def _verbs(self, text: str) -> list[tuple[int, int, Action]]:
        found: list[tuple[int, int, Action]] = []
        taken: list[tuple[int, int]] = []
        for action, rx in _VERB_RE.items():
            for m in rx.finditer(text):
                if any(not (m.end() <= s or m.start() >= e) for s, e in taken):
                    continue
                prev = re.findall(r"[\w']+", text[: m.start()])
                if prev and prev[-1] in _NOUN_MARKERS:
                    continue  # "grant access", "the use of", "a record": noun, not an action
                found.append((m.start(), m.end(), action))
                taken.append((m.start(), m.end()))
        return sorted(found)

    @staticmethod
    def _cue_adjacent(text: str, vstart: int) -> bool:
        """True when the negation cue sits directly before the verb ("never share", "do not collect")."""
        return bool(_ADJ_NEG.search(text[max(0, vstart - 32):vstart]))

    @staticmethod
    def _verb_negated(text: str, vstart: int) -> bool:
        window_start = max(0, vstart - 32)
        window = text[window_start:vstart]
        # stop at the last clause break inside the window
        last_break = None
        for m in _CLAUSE_BREAK.finditer(window):
            last_break = m.end()
        if last_break is not None:
            window = window[last_break:]
        for m in _NEG_CUE.finditer(window):
            if m.group(0).startswith("nor"):
                return True
            if _YOU_BEFORE.search(window[: m.start()]):
                continue  # "if you do not ..." negates the user's action, not ours
            # "not only" is not a negation
            if window[m.end():].lstrip().startswith("only"):
                continue
            return True
        return False

    def extract_sentence(self, sentence: Sentence, *, ctx: ExtractContext) -> SentenceResult:
        raw = sentence.text
        low = raw.lower()
        res = SentenceResult(sentence=sentence)
        if len(raw.split()) <= 6 and not raw.rstrip().endswith((".", "!", "?", "\u0964", ";", ":")):
            return res  # a heading ("Information we collect"), not a statement

        # 1. exception clauses
        exc_spans: list[tuple[int, int]] = []
        for m in _EXC_CUE.finditer(low):
            tail = low[m.end():]
            end_m = _EXC_END.search(tail)
            end = m.end() + (end_m.start() if end_m else len(tail))
            exc_spans.append((m.start(), end))
        main = _mask(low, exc_spans)
        exc_text = "".join(low[s:e] for s, e in exc_spans)

        exceptions: list[str] = []
        for s, e in exc_spans:
            seg = low[s:e]
            exceptions += [mm.node_id for mm in _match_all(self.actor_idx, seg)]
            exceptions += [mm.node_id for mm in _match_all(self.dt_idx, seg)]
        exceptions = list(dict.fromkeys(exceptions))

        # 2. alias matches in the main clause
        dts = _match_all(self.dt_idx, main)
        actors = _match_all(self.actor_idx, main)
        purpose_matches = _match_all(self.purpose_idx, main)
        # data-type aliases that are really actor phrases ("advertising partners") are dropped
        actor_spans = [(a.start, a.end) for a in actors]
        dts = [d for d in dts if not any(s <= d.start and d.end <= e for s, e in actor_spans)]
        # purpose phrases are not data types ("to process payments" is not payment_info)
        purpose_spans = [(m.start, m.end) for m in purpose_matches]
        dts = [d for d in dts if not any(s <= d.start and d.end <= e for s, e in purpose_spans)]
        # ...and a data-type phrase is not a purpose ("advertising ID" is not "advertising")
        purpose_matches = [m for m in purpose_matches
                           if not any(d.start <= m.start and m.end <= d.end for d in dts)]
        purpose_spans = [(m.start, m.end) for m in purpose_matches]
        purposes = list(dict.fromkeys(m.node_id for m in purpose_matches))

        # 3. verbs
        masked_for_verbs = _mask(main, [(d.start, d.end) for d in dts] + actor_spans + purpose_spans)
        verbs = self._verbs(masked_for_verbs)
        if not verbs:
            return res

        dt_ids = list(dict.fromkeys(d.node_id for d in dts))
        specific = [d for d in dt_ids if not self.onto.data_types.is_root(d)]
        hedged = bool(_HEDGE.search(main))
        generic_obj = bool(_GENERIC_OBJ.search(_mask(main, [(d.start, d.end) for d in dts])))

        # 4. vague class
        if not dt_ids and not generic_obj:
            return res  # not a data-practice statement
        is_vague = (hedged and not specific) or (not dt_ids and generic_obj)

        spacy_neg = _spacy_negated_verbs(raw) if self.use_spacy else None

        def negated(vstart: int) -> tuple[bool, NegationMethod]:
            if spacy_neg is not None and vstart in spacy_neg:
                return spacy_neg[vstart], NegationMethod.DEPENDENCY
            neg_v = self._verb_negated(main, vstart)
            if neg_v and self._cue_adjacent(main, vstart):
                return True, NegationMethod.ADJACENT
            return neg_v, NegationMethod.HEURISTIC

        def det_negated(d: Match) -> bool:
            return bool(_NEG_DET.search(main[: d.start]))

        n_actions = len({a for _, _, a in verbs})
        base_conf = 0.9
        if hedged:
            base_conf = 0.75
        if len(raw.split()) > 45:
            base_conf -= 0.1
        if n_actions > 1:
            base_conf -= 0.05
        if is_vague:
            base_conf = 0.6

        tuples: list[ClaimTuple] = []
        seen: set[tuple[str, str, str, str]] = set()
        root_dt = self.onto.data_types.roots[0]
        targets = dt_ids if dt_ids else [root_dt]
        if is_vague and not specific:
            targets = [d for d in dt_ids if self.onto.data_types.is_root(d)] or [root_dt]

        any_neg = False
        for vstart, _vend, action in verbs:
            v_neg, method = negated(vstart)
            # actor: third-party subject before the verb, or recipient after a share/sell verb
            before_actors = [a.node_id for a in actors if a.end <= vstart]
            after_actors = [a.node_id for a in actors if a.start >= vstart]
            penalty = 0.0
            if action in (Action.SHARE, Action.SELL):
                actor_ids = after_actors or before_actors or ["third_party"]
            else:
                actor_ids = before_actors[-1:] if before_actors else ["first_party"]
                if not before_actors and not _FIRST_PERSON.search(raw):
                    penalty = UNATTRIBUTED_PENALTY
            for d in targets:
                dmatch = next((m for m in dts if m.node_id == d), None)
                det_neg = dmatch is not None and det_negated(dmatch)
                neg = v_neg or det_neg
                any_neg = any_neg or neg
                tuple_method = method if v_neg else NegationMethod.HEURISTIC
                if is_vague:
                    pol = Polarity.VAGUE
                else:
                    pol = Polarity.DENY if neg else Polarity.AFFIRM
                for actor in actor_ids:
                    k = (actor, action.value, d, pol.value)
                    if k in seen:
                        continue
                    seen.add(k)
                    tuples.append(
                        ClaimTuple(
                            actor=actor,
                            action=action,
                            data_type=d,
                            condition=purposes[0] if purposes else None,
                            purposes=purposes,
                            polarity=pol,
                            exceptions=exceptions,
                            source_kind=SourceKind.POLICY,
                            evidence=EvidenceSpan(
                                source_id=ctx.source_id,
                                char_start=sentence.start,
                                char_end=sentence.end,
                                text=raw[:600],
                                locator="sentence",
                                url=ctx.url,
                                captured_at=ctx.captured_at,
                            ),
                            confidence=round(max(0.05, min(1.0, base_conf - penalty)), 3),
                            extractor="rule",
                            extractor_version=self.version,
                            ontology_version=self.onto.version,
                            negation_method=(tuple_method if pol == Polarity.DENY else None),
                        )
                    )
        res.tuples = tuples
        res.vague = is_vague
        res.confidence = round(max(0.05, min(1.0, base_conf)), 3)
        res.needs_fallback = (any_neg and bool(exc_spans)) or res.confidence < 0.6
        _ = exc_text
        return res


# ------------------------------------------------------------------ helpers for callers


def extract_text(
    text: str,
    *,
    extractor: Extractor | None = None,
    ctx: ExtractContext | None = None,
) -> list[SentenceResult]:
    ex = extractor or RuleExtractor()
    c = ctx or ExtractContext()
    return [ex.extract_sentence(s, ctx=c) for s in split_sentences(text)]


def vague_claim_ratio(results: list[SentenceResult]) -> float:
    claim_sentences = [r for r in results if r.tuples]
    if not claim_sentences:
        return 0.0
    return round(sum(1 for r in claim_sentences if r.vague) / len(claim_sentences), 2)
