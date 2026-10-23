"""`python -m sahamati_core.ontology` validates the ontology YAML (used in CI)."""

import sys

from .loader import load_ontology_uncached


def main() -> int:
    onto, errors = load_ontology_uncached()
    if errors:
        print("ontology INVALID:")
        for e in errors:
            print("  -", e)
        return 1
    print(
        f"ontology {onto.version} OK: {len(onto.data_types.nodes)} data types, "
        f"{len(onto.actors.nodes)} actors, {len(onto.purposes.nodes)} purposes, "
        f"{len(onto.ds_types)} DS terms, {len(onto.permissions)} permissions, {len(onto.sdks)} SDKs"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
