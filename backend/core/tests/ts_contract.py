"""Tiny structural checker that validates JSON values against the interfaces and
type aliases in packages/contracts/src/index.ts (no TS toolchain needed)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

TS_PATH = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "src" / "index.ts"


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"//[^\n]*", "", src)


def _match_brace(s: str, i: int, open_c: str = "{", close_c: str = "}") -> int:
    depth = 0
    for j in range(i, len(s)):
        if s[j] == open_c:
            depth += 1
        elif s[j] == close_c:
            depth -= 1
            if depth == 0:
                return j
    raise ValueError("unbalanced")


def _split_top(s: str, seps: str) -> list[str]:
    parts, depth, cur = [], 0, []
    for ch in s:
        if ch in "{[<(":
            depth += 1
        elif ch in "}]>)":
            depth -= 1
        if ch in seps and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def parse_fields(body: str) -> dict[str, tuple[bool, str]]:
    fields: dict[str, tuple[bool, str]] = {}
    for part in _split_top(body, ";\n,"):
        m = re.match(r"^(\w+)(\?)?\s*:\s*(.+)$", part, flags=re.S)
        if m:
            fields[m.group(1)] = (bool(m.group(2)), m.group(3).strip())
    return fields


class Contract:
    def __init__(self, path: Path = TS_PATH) -> None:
        src = _strip_comments(path.read_text(encoding="utf-8"))
        self.interfaces: dict[str, dict[str, tuple[bool, str]]] = {}
        self.aliases: dict[str, str] = {}
        for m in re.finditer(r"export\s+interface\s+(\w+)\s*\{", src):
            end = _match_brace(src, m.end() - 1)
            self.interfaces[m.group(1)] = parse_fields(src[m.end():end])
        for m in re.finditer(r"export\s+type\s+(\w+)\s*=\s*", src):
            end = src.index(";", m.end())
            # aliases containing braces (CheckResponse) span further; take to the matching ';' at depth 0
            body = src[m.end():]
            depth = 0
            for j, ch in enumerate(body):
                if ch in "{[<(":
                    depth += 1
                elif ch in "}]>)":
                    depth -= 1
                elif ch == ";" and depth == 0:
                    end = m.end() + j
                    break
            self.aliases[m.group(1)] = src[m.end():end].strip()

    def literals(self, t: str) -> set[str]:
        t = t.strip()
        if t in self.aliases:
            return self.literals(self.aliases[t])
        out: set[str] = set()
        for alt in _split_top(t, "|"):
            if alt.startswith('"'):
                out.add(alt.strip('"'))
            elif alt in self.aliases:
                out |= self.literals(alt)
        return out

    def check(self, t: str, v: Any, path: str = "$") -> list[str]:
        t = t.strip()
        alts = _split_top(t, "|")
        if len(alts) > 1:
            results = [self.check(a, v, path) for a in alts]
            return [] if any(not r for r in results) else results[0]
        if t == "string":
            return [] if isinstance(v, str) else [f"{path}: expected string, got {v!r}"]
        if t == "number":
            return [] if isinstance(v, (int, float)) and not isinstance(v, bool) else [f"{path}: expected number"]
        if t == "boolean":
            return [] if isinstance(v, bool) else [f"{path}: expected boolean"]
        if t == "null":
            return [] if v is None else [f"{path}: expected null"]
        if t.startswith('"'):
            return [] if v == t.strip('"') else [f"{path}: expected {t}, got {v!r}"]
        if t.endswith("[]"):
            if not isinstance(v, list):
                return [f"{path}: expected array"]
            return [e for i, x in enumerate(v) for e in self.check(t[:-2], x, f"{path}[{i}]")]
        if t.startswith("[") and t.endswith("]"):
            items = _split_top(t[1:-1], ",")
            if not isinstance(v, list) or len(v) != len(items):
                return [f"{path}: expected tuple of {len(items)}"]
            return [e for i, (it, x) in enumerate(zip(items, v, strict=True)) for e in self.check(it, x, f"{path}[{i}]")]
        if t.startswith("{"):
            return self.check_object(parse_fields(t[1:-1]), v, path)
        m = re.match(r"^Record<(.+?),(.+)>$", t)
        if m:
            keys = self.literals(m.group(1))
            if not isinstance(v, dict):
                return [f"{path}: expected record"]
            errs = [f"{path}: missing key {k}" for k in keys - set(v)]
            errs += [f"{path}: unexpected key {k}" for k in set(v) - keys]
            return errs + [e for k, x in v.items() for e in self.check(m.group(2), x, f"{path}.{k}")]
        m = re.match(r"^Exclude<(\w+),\s*(.+)>$", t)
        if m:
            allowed = self.literals(m.group(1)) - self.literals(m.group(2))
            return [] if v in allowed else [f"{path}: {v!r} not in {sorted(allowed)}"]
        if t in self.interfaces:
            return self.check_object(self.interfaces[t], v, path)
        if t in self.aliases:
            return self.check(self.aliases[t], v, path)
        return [f"{path}: unknown type {t}"]

    def check_object(self, fields: dict[str, tuple[bool, str]], v: Any, path: str) -> list[str]:
        if not isinstance(v, dict):
            return [f"{path}: expected object"]
        errs: list[str] = []
        for name, (optional, t) in fields.items():
            if name not in v:
                if not optional:
                    errs.append(f"{path}: missing required field {name}")
                continue
            errs += self.check(t, v[name], f"{path}.{name}")
        errs += [f"{path}: extra field {k}" for k in v if k not in fields]
        return errs
