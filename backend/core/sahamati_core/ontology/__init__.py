from .loader import (
    DsVocabEntry,
    Hierarchy,
    Node,
    Ontology,
    OntologyError,
    PermissionEntry,
    SdkEntry,
    load_ontology,
    load_ontology_uncached,
    validate_ontology,
)


def overlaps(a: str, b: str, kind: str = "data_type") -> str | None:
    """Subsumption-only overlap on the default ontology. Siblings never overlap."""
    return load_ontology().hierarchy(kind).overlaps(a, b)  # type: ignore[arg-type]


def path_to_root(n: str, kind: str = "data_type") -> list[str]:
    return load_ontology().hierarchy(kind).path_to_root(n)  # type: ignore[arg-type]


__all__ = [
    "DsVocabEntry", "Hierarchy", "Node", "Ontology", "OntologyError", "PermissionEntry", "SdkEntry",
    "load_ontology", "load_ontology_uncached", "overlaps", "path_to_root", "validate_ontology",
]
