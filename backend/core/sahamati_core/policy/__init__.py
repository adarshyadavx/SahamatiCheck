"""Privacy-policy text processing."""

from .extractor import (
    ExtractContext,
    Extractor,
    RuleExtractor,
    SentenceResult,
    extract_text,
    text_fragment,
    vague_claim_ratio,
)
from .html import find_last_updated, html_to_text
from .segment import Sentence, split_sentences

__all__ = ["ExtractContext", "Extractor", "RuleExtractor", "Sentence", "SentenceResult", "extract_text", "find_last_updated", "html_to_text", "split_sentences", "text_fragment", "vague_claim_ratio"]
