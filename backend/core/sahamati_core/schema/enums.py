from __future__ import annotations

from enum import StrEnum


class SourceKind(StrEnum):
    POLICY = "policy"
    DATA_SAFETY = "data_safety"
    APK_PERMISSION = "apk_permission"
    APK_SDK = "apk_sdk"


class Action(StrEnum):
    COLLECT = "collect"
    SHARE = "share"
    SELL = "sell"
    USE = "use"
    RETAIN = "retain"


class Polarity(StrEnum):
    AFFIRM = "affirm"
    DENY = "deny"
    VAGUE = "vague"


class Coverage(StrEnum):
    OK = "ok"
    UNAVAILABLE = "unavailable"
    UNREACHABLE = "unreachable"
    OBFUSCATED = "obfuscated"
    UNPARSEABLE = "unparseable"


class ConflictClass(StrEnum):
    INTERNAL_CONTRADICTION = "internal_contradiction"
    DECLARATION_MISMATCH = "declaration_mismatch"
    BEHAVIOURAL_MISMATCH = "behavioural_mismatch"
    DISCLOSURE_GAP = "disclosure_gap"  # engine-internal; never appears in findings[]


class Tier(StrEnum):
    STRONG = "strong"
    INDICATIVE = "indicative"
    NOT_MENTIONED = "not_mentioned"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


class NegationMethod(StrEnum):
    """How a DENY polarity was resolved. Heuristic scope gets s_neg = 0.8; adjacent and dependency get 1.0."""

    DEPENDENCY = "dependency"
    HEURISTIC = "heuristic"
    ADJACENT = "adjacent"  # a negation cue directly before the verb ("never share"); as certain as an arc
    MAPPING = "mapping"
    LLM = "llm"
