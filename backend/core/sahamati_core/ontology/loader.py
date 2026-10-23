"""Ontology loader. YAML files -> networkx DiGraphs (edges child -> parent).

Overlap is subsumption only: two ids overlap when one is an ancestor-or-self of
the other. Siblings never overlap (precision over recall).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import networkx as nx
import yaml

from sahamati_core import ontology_dir

Kind = Literal["data_type", "actor", "purpose"]

HIERARCHY_FILES: dict[Kind, str] = {
    "data_type": "data_types.yaml",
    "actor": "actors.yaml",
    "purpose": "purposes.yaml",
}


class OntologyError(ValueError):
    pass


@dataclass(frozen=True)
class Node:
    id: str
    kind: Kind
    parents: tuple[str, ...]
    label_en: str
    label_hi: str
    aliases: tuple[str, ...]
    dpdp_sensitive: bool = False
    report_category: str | None = None


@dataclass
class Hierarchy:
    kind: Kind
    version: str
    roots: tuple[str, ...]
    nodes: dict[str, Node]
    graph: nx.DiGraph = field(repr=False)
    report_categories: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        # Per-instance caches (functools.cache on methods would keep `self` alive globally).
        self._anc: dict[str, frozenset[str]] = {}

    def __contains__(self, node_id: object) -> bool:
        return node_id in self.nodes

    def ancestors_or_self(self, n: str) -> frozenset[str]:
        got = self._anc.get(n)
        if got is None:
            if n not in self.graph:
                got = frozenset({n})
            else:
                # edges child -> parent, so nx.descendants() walks up to the root
                got = frozenset(nx.descendants(self.graph, n)) | {n}
            self._anc[n] = got
        return got

    def subsumes(self, ancestor: str, node: str) -> bool:
        """True if `ancestor` is `node` or one of its ancestors."""
        return ancestor in self.ancestors_or_self(node)

    def overlaps(self, a: str, b: str) -> str | None:
        """The more specific node if one subsumes the other; siblings never overlap."""
        if a in self.ancestors_or_self(b):
            return b
        if b in self.ancestors_or_self(a):
            return a
        return None

    def path_to_root(self, n: str) -> list[str]:
        """[n, parent, ..., root] following the primary (first-listed) parent."""
        path = [n]
        seen = {n}
        cur = n
        while cur in self.nodes and self.nodes[cur].parents:
            cur = self.nodes[cur].parents[0]
            if cur in seen:  # defensive; validator rejects cycles
                break
            path.append(cur)
            seen.add(cur)
        return path

    def ontology_path(self, n: str) -> list[str]:
        """root -> ... -> n (the order used in reports)."""
        return list(reversed(self.path_to_root(n)))

    def depth(self, n: str) -> int:
        return len(self.path_to_root(n)) - 1

    def is_root(self, n: str) -> bool:
        return n in self.roots

    def root_of(self, n: str) -> str:
        return self.path_to_root(n)[-1]

    def report_category(self, n: str) -> str | None:
        """The report-card category of `n`: its own, else the nearest ancestor's (primary-parent path)."""
        for x in self.path_to_root(n):
            node = self.nodes.get(x)
            if node is not None and node.report_category:
                return node.report_category
        return None

    def label(self, n: str, lang: str = "en") -> str:
        node = self.nodes.get(n)
        if node is None:
            return n
        return node.label_hi if lang == "hi" else node.label_en


@dataclass
class SdkEntry:
    prefix: str
    name: str
    actor: str
    action: str
    data_types: tuple[str, ...]
    doc: str
    reviewed: bool = False


@dataclass
class PermissionEntry:
    permission: str
    data_types: tuple[str, ...]
    confidence: float = 0.98


@dataclass
class DsVocabEntry:
    category: str
    type: str
    data_type: str


@dataclass
class Ontology:
    version: str
    data_types: Hierarchy
    actors: Hierarchy
    purposes: Hierarchy
    ds_types: list[DsVocabEntry]
    ds_purposes: dict[str, str]
    sharing_exemptions: tuple[str, ...]
    permissions: dict[str, PermissionEntry]
    sdks: list[SdkEntry]

    def hierarchy(self, kind: Kind) -> Hierarchy:
        return {"data_type": self.data_types, "actor": self.actors, "purpose": self.purposes}[kind]

    @property
    def sdks_by_prefix_len(self) -> list[SdkEntry]:
        return sorted(self.sdks, key=lambda s: -len(s.prefix))


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise OntologyError(f"missing ontology file: {path}")
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise OntologyError(f"{path.name}: top level must be a mapping")
    return data


def _build_hierarchy(kind: Kind, data: dict[str, Any], errors: list[str]) -> Hierarchy:
    fname = HIERARCHY_FILES[kind]
    nodes: dict[str, Node] = {}
    for raw in data.get("nodes") or []:
        nid = str(raw.get("id", "")).strip()
        if not nid:
            errors.append(f"{fname}: node without id")
            continue
        if nid in nodes:
            errors.append(f"{fname}: duplicate id {nid!r}")
            continue
        for req in ("label_en", "label_hi"):
            if not raw.get(req):
                errors.append(f"{fname}: {nid} is missing {req}")
        if "aliases" not in raw:
            errors.append(f"{fname}: {nid} is missing aliases")
        nodes[nid] = Node(
            id=nid,
            kind=kind,
            parents=tuple(raw.get("parents") or []),
            label_en=str(raw.get("label_en", nid)),
            label_hi=str(raw.get("label_hi", nid)),
            aliases=tuple(str(a).lower() for a in (raw.get("aliases") or [])),
            dpdp_sensitive=bool(raw.get("dpdp_sensitive", False)),
            report_category=raw.get("report_category"),
        )
        rc = raw.get("report_category")
        if rc is not None and rc not in (data.get("report_categories") or []):
            errors.append(f"{fname}: {nid} has unknown report_category {rc!r}")
    g = nx.DiGraph()
    g.add_nodes_from(nodes)
    for n in nodes.values():
        for p in n.parents:
            if p not in nodes:
                errors.append(f"{fname}: {n.id} has unknown parent {p!r}")
            else:
                g.add_edge(n.id, p)
    roots = tuple(data.get("roots") or [])
    parentless = {n.id for n in nodes.values() if not n.parents}
    if set(roots) != parentless:
        errors.append(f"{fname}: declared roots {sorted(roots)} != parentless nodes {sorted(parentless)}")
    if not nx.is_directed_acyclic_graph(g):
        errors.append(f"{fname}: graph has a cycle: {nx.find_cycle(g)}")
    else:
        # single root per hierarchy: every weakly connected component has exactly one root
        for comp in nx.weakly_connected_components(g):
            comp_roots = [r for r in comp if r in parentless]
            if len(comp_roots) != 1:
                errors.append(f"{fname}: component {sorted(comp)[:3]}... has roots {comp_roots}")
    return Hierarchy(kind=kind, version=str(data.get("version", "")), roots=roots, nodes=nodes, graph=g,
                     report_categories=tuple(data.get("report_categories") or []))


def load_ontology_uncached(directory: Path | None = None) -> tuple[Ontology, list[str]]:
    """Load and validate. Returns (ontology, errors). Never raises on content errors."""
    d = Path(directory) if directory else ontology_dir()
    errors: list[str] = []
    hier: dict[Kind, Hierarchy] = {}
    versions: dict[str, str] = {}
    for kind, fname in HIERARCHY_FILES.items():
        data = _read_yaml(d / fname)
        if data.get("kind") != kind:
            errors.append(f"{fname}: kind must be {kind!r}")
        hier[kind] = _build_hierarchy(kind, data, errors)
        versions[fname] = str(data.get("version", ""))

    dt, actors, purposes = hier["data_type"], hier["actor"], hier["purpose"]

    ds = _read_yaml(d / "ds_vocab.yaml")
    versions["ds_vocab.yaml"] = str(ds.get("version", ""))
    ds_types: list[DsVocabEntry] = []
    for raw in ds.get("types") or []:
        e = DsVocabEntry(category=str(raw["category"]), type=str(raw["type"]), data_type=str(raw["data_type"]))
        if e.data_type not in dt:
            errors.append(f"ds_vocab.yaml: {e.type!r} -> unknown data_type {e.data_type!r}")
        ds_types.append(e)
    ds_purposes = {str(k): str(v) for k, v in (ds.get("purposes") or {}).items()}
    for k, v in ds_purposes.items():
        if v not in purposes:
            errors.append(f"ds_vocab.yaml: purpose {k!r} -> unknown id {v!r}")
    exemptions = tuple(ds.get("sharing_exemptions") or [])
    for a in exemptions:
        if a not in actors:
            errors.append(f"ds_vocab.yaml: unknown sharing exemption actor {a!r}")

    perm_data = _read_yaml(d / "permissions.yaml")
    versions["permissions.yaml"] = str(perm_data.get("version", ""))
    permissions: dict[str, PermissionEntry] = {}
    for raw in perm_data.get("permissions") or []:
        pe = PermissionEntry(
            permission=str(raw["permission"]),
            data_types=tuple(raw.get("data_types") or []),
            confidence=float(raw.get("confidence", 0.98)),
        )
        for t in pe.data_types:
            if t not in dt:
                errors.append(f"permissions.yaml: {pe.permission} -> unknown data_type {t!r}")
        if pe.permission in permissions:
            errors.append(f"permissions.yaml: duplicate {pe.permission}")
        permissions[pe.permission] = pe

    sdk_data = _read_yaml(d / "sdks.yaml")
    versions["sdks.yaml"] = str(sdk_data.get("version", ""))
    sdks: list[SdkEntry] = []
    seen_prefix: set[str] = set()
    for raw in sdk_data.get("sdks") or []:
        se = SdkEntry(
            prefix=str(raw["prefix"]),
            name=str(raw.get("name", raw["prefix"])),
            actor=str(raw.get("actor", "")),
            action=str(raw.get("action", "collect")),
            data_types=tuple(raw.get("data_types") or []),
            doc=str(raw.get("doc", "")),
            reviewed=bool(raw.get("reviewed", False)),
        )
        if se.prefix in seen_prefix:
            errors.append(f"sdks.yaml: duplicate prefix {se.prefix}")
        seen_prefix.add(se.prefix)
        if se.actor not in actors:
            errors.append(f"sdks.yaml: {se.prefix} -> unknown actor {se.actor!r}")
        if se.action not in ("collect", "share"):
            errors.append(f"sdks.yaml: {se.prefix} -> action must be collect|share")
        if not se.doc:
            errors.append(f"sdks.yaml: {se.prefix} has no doc citation")
        for t in se.data_types:
            if t not in dt:
                errors.append(f"sdks.yaml: {se.prefix} -> unknown data_type {t!r}")
        sdks.append(se)

    distinct = set(versions.values())
    if len(distinct) != 1:
        errors.append(f"ontology files disagree on version: {versions}")
    version = sorted(distinct)[0] if distinct else ""

    onto = Ontology(
        version=version,
        data_types=dt,
        actors=actors,
        purposes=purposes,
        ds_types=ds_types,
        ds_purposes=ds_purposes,
        sharing_exemptions=exemptions,
        permissions=permissions,
        sdks=sdks,
    )
    return onto, errors


@lru_cache(maxsize=8)
def _load_cached(directory: str) -> Ontology:
    onto, errors = load_ontology_uncached(Path(directory))
    if errors:
        raise OntologyError("ontology validation failed:\n  " + "\n  ".join(errors))
    return onto


def load_ontology(directory: Path | str | None = None) -> Ontology:
    """Load the validated ontology (cached). Raises OntologyError if invalid."""
    return _load_cached(str(Path(directory) if directory else ontology_dir()))


def validate_ontology(directory: Path | str | None = None) -> list[str]:
    _, errors = load_ontology_uncached(Path(directory) if directory else None)
    return errors
