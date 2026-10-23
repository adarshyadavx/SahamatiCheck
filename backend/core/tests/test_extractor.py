from __future__ import annotations

import pytest
from sahamati_core.policy import RuleExtractor, Sentence, extract_text, html_to_text, split_sentences
from sahamati_core.policy.extractor import ExtractContext


def tuples(text: str) -> list[tuple[str, str, str, str]]:
    ex = RuleExtractor(use_spacy=False)
    r = ex.extract_sentence(Sentence(0, len(text), text), ctx=ExtractContext())
    return [(t.actor, t.action.value, t.polarity.value, t.data_type) for t in r.tuples]


@pytest.mark.parametrize(
    "text,expected",
    [
        ("We do not collect your location.", ("first_party", "collect", "deny", "location")),
        ("We never share your personal information with third parties.",
         ("third_party", "share", "deny", "personal_info")),
        ("We will not sell your email address.", ("third_party", "sell", "deny", "email")),
        ("We don't collect your contacts.", ("first_party", "collect", "deny", "contacts")),
        ("We collect no location data.", ("first_party", "collect", "deny", "location")),
        ("We collect your precise GPS location to help prevent fraud.",
         ("first_party", "collect", "affirm", "precise_location")),
    ],
)
def test_negation(text: str, expected: tuple[str, str, str, str]) -> None:
    assert expected in tuples(text)


def test_negation_scope_is_per_verb() -> None:
    got = tuples("We collect your email address but do not share it with advertisers.")
    assert ("first_party", "collect", "affirm", "email") in got
    assert ("ad_network", "share", "deny", "email") in got


def test_user_negation_is_not_our_negation() -> None:
    got = tuples("If you do not grant access, we cannot collect your contacts.")
    assert got == [("first_party", "collect", "deny", "contacts")]


def test_not_only_is_not_negation() -> None:
    got = tuples("We not only collect your email address but also your phone number.")
    assert all(p == "affirm" for _, _, p, _ in got)


def test_exception_clause() -> None:
    ex = RuleExtractor(use_spacy=False)
    s = "We do not share your personal information with third parties, except with service providers."
    r = ex.extract_sentence(Sentence(0, len(s), s), ctx=ExtractContext())
    assert len(r.tuples) == 1
    t = r.tuples[0]
    assert (t.actor, t.action.value, t.polarity.value, t.data_type) == ("third_party", "share", "deny", "personal_info")
    assert t.exceptions == ["service_provider"]
    assert r.needs_fallback  # negation + exception is a hard case for the LLM fallback


def test_vague_class() -> None:
    ex = RuleExtractor(use_spacy=False)
    for s in ("We may collect certain information from time to time.", "We may share some information with our partners."):
        r = ex.extract_sentence(Sentence(0, len(s), s), ctx=ExtractContext())
        assert r.vague and all(t.polarity.value == "vague" for t in r.tuples)
    s = "We may collect your location."
    r = ex.extract_sentence(Sentence(0, len(s), s), ctx=ExtractContext())
    assert not r.vague  # a hedge with a specific type is a (lower-confidence) claim
    assert r.tuples[0].confidence < 0.9


def test_headings_and_non_claims() -> None:
    assert tuples("Information we collect") == []
    assert tuples("All connections to our servers are encrypted.") == []
    assert tuples("This policy was last updated on 1 October 2026.") == []


def test_purpose_condition() -> None:
    ex = RuleExtractor(use_spacy=False)
    s = "We collect your precise GPS location to help prevent fraud."
    r = ex.extract_sentence(Sentence(0, len(s), s), ctx=ExtractContext())
    assert r.tuples[0].condition == "fraud_prevention"


def test_sentence_offsets() -> None:
    text = "We collect your email address. We do not collect your location!\nDr. Rao signs this, e.g. today. We may."
    for s in split_sentences(text):
        assert text[s.start:s.end] == s.text
    assert len(split_sentences(text)) == 4


def test_html_fallback_and_offsets() -> None:
    html = "<html><body><nav>menu</nav><p>We <b>never</b> share your contacts.</p><script>x()</script></body></html>"
    text, method = html_to_text(html, prefer_trafilatura=False)
    assert method == "bs4"
    assert "We never share your contacts." in text and "menu" not in text and "x()" not in text
    res = extract_text(text)
    claim = next(r for r in res if r.tuples)
    t = claim.tuples[0]
    assert text[t.evidence.char_start:t.evidence.char_end] == t.evidence.text


def _neg_method(text: str) -> str | None:
    ex = RuleExtractor(use_spacy=False)
    r = ex.extract_sentence(Sentence(0, len(text), text), ctx=ExtractContext())
    deny = [t for t in r.tuples if t.polarity.value == "deny"]
    return deny[0].negation_method.value if deny and deny[0].negation_method else None


@pytest.mark.parametrize("text,method", [
    ("We never collect your precise location.", "adjacent"),
    ("We do not share your device identifiers with third parties.", "adjacent"),
    ("We will not sell your email address.", "adjacent"),
    ("We don't collect your contacts.", "adjacent"),
    ("We collect your email address but do not share it with advertisers.", "adjacent"),
    ("We do not knowingly collect your location.", "heuristic"),  # the cue is not next to the verb
    ("We collect no location data.", "heuristic"),  # a negative determiner, not a verb cue
])
def test_adjacent_negation_is_certain_loose_negation_is_penalised(text: str, method: str) -> None:
    assert _neg_method(text) == method


def test_a_data_type_phrase_is_not_a_purpose() -> None:
    """"advertising ID" names a data type; it must not also add the purpose "advertising" (a conditional denial)."""
    ex = RuleExtractor(use_spacy=False)
    s = "We never share your device identifiers or advertising ID with third parties."
    r = ex.extract_sentence(Sentence(0, len(s), s), ctx=ExtractContext())
    assert {t.data_type for t in r.tuples} == {"device_id", "advertising_id"}
    assert all(t.condition is None and t.purposes == [] for t in r.tuples)
    s = "We share your advertising ID with partners for advertising."
    r = ex.extract_sentence(Sentence(0, len(s), s), ctx=ExtractContext())
    assert r.tuples and r.tuples[0].purposes == ["advertising"]  # a real purpose phrase still counts
