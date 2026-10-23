"""Sentence splitter that keeps character offsets into the source text."""

from __future__ import annotations

import re
from dataclasses import dataclass

_ABBREV = {
    "e.g", "i.e", "etc", "inc", "ltd", "pvt", "co", "mr", "mrs", "ms", "dr", "no", "vs", "u.s", "st", "sr", "jr",
}
# Boundary: ., !, ? or the Devanagari danda, followed by whitespace.
_BOUNDARY = re.compile(r"([.!?।])(['\"”’)]*)(\s+)")


@dataclass(frozen=True)
class Sentence:
    start: int
    end: int
    text: str


def _emit(text: str, start: int, end: int, out: list[Sentence]) -> None:
    # trim whitespace while keeping offsets exact
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    if end - start >= 2:
        out.append(Sentence(start, end, text[start:end]))


def split_sentences(text: str) -> list[Sentence]:
    out: list[Sentence] = []
    pos = 0
    for line in text.split("\n"):
        line_start = pos
        line_end = pos + len(line)
        pos = line_end + 1  # skip the newline
        seg_start = line_start
        for m in _BOUNDARY.finditer(line):
            punct_end = line_start + m.end(2)
            # word right before the punctuation
            before = line[: m.start(1)]
            last_word = re.split(r"\s", before)[-1].lower().rstrip(".") if before else ""
            if m.group(1) == "." and last_word in _ABBREV:
                continue
            if m.group(1) == "." and re.fullmatch(r"[a-z]", last_word or "x"):
                continue  # initials like "A. Sharma"
            nxt = line[m.end():m.end() + 1]
            if nxt and nxt.islower():
                continue
            _emit(text, seg_start, punct_end, out)
            seg_start = line_start + m.end()
        _emit(text, seg_start, line_end, out)
    return out
