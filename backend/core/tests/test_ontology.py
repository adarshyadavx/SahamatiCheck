from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from sahamati_core import ontology_dir
from sahamati_core.ontology import load_ontology, overlaps, path_to_root, validate_ontology

SAMPLE = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures" / "report.sample.json"


def test_ontology_validates() -> None:
    assert validate_ontology() == []


def test_sizes() -> None:
    onto = load_ontology()
    assert 35 <= len(onto.data_types.nodes) <= 60
    assert len(onto.actors.nodes) == 8
    assert 40 <= len(onto.sdks) <= 100
    assert set(onto.data_types.roots) == {"personal_info", "app_activity"}
    assert onto.actors.roots == ("any_party",)


def test_every_node_has_labels() -> None:
    onto = load_ontology()
    for kind in ("data_type", "actor", "purpose"):
        for n in onto.hierarchy(kind).nodes.values():  # type: ignore[arg-type]
            assert n.label_en and n.label_hi, n.id


def test_sample_ids_exist() -> None:
    onto = load_ontology()
    sample = json.loads(SAMPLE.read_text())
    ids: set[str] = set()
    for f in sample["findings"]:
        ids.update(f["ontology_path"])
        for side in f["sides"]:
            ids.add(side["tuple"]["data_type"])
    for g in sample["disclosure_gaps"]:
        ids.update(g["ontology_path"])
    for r in sample["matrix"]:
        ids.update(r["ontology_path"])
    missing = {i for i in ids if i not in onto.data_types}
    assert not missing
    for f in sample["findings"]:
        for side in f["sides"]:
            assert side["tuple"]["actor"] in onto.actors


@pytest.mark.parametrize(
    "a,b,expected",
    [
        ("personal_info", "advertising_id", "advertising_id"),
        ("advertising_id", "personal_info", "advertising_id"),
        ("device_id", "device_id", "device_id"),
        ("location", "precise_location", "precise_location"),
        ("precise_location", "approximate_location", None),  # siblings never overlap
        ("contacts", "contact_info", None),
        ("email", "phone_number", None),
        ("crash_logs", "personal_info", None),  # different hierarchies
        ("diagnostics", "crash_logs", "crash_logs"),
    ],
)
def test_overlaps(a: str, b: str, expected: str | None) -> None:
    assert overlaps(a, b) == expected


def test_actor_overlap_is_subsumption_only() -> None:
    assert overlaps("third_party", "ad_network", "actor") == "ad_network"
    assert overlaps("ad_network", "analytics_provider", "actor") is None
    assert overlaps("first_party", "third_party", "actor") is None


def test_path_to_root() -> None:
    assert path_to_root("advertising_id") == ["advertising_id", "device_id", "identifiers", "personal_info"]
    onto = load_ontology()
    assert onto.data_types.ontology_path("crash_logs") == ["app_activity", "diagnostics", "crash_logs"]
    assert onto.data_types.depth("personal_info") == 0


def _copy_ontology(tmp_path: Path) -> Path:
    d = tmp_path / "onto"
    shutil.copytree(ontology_dir(), d)
    return d


def test_validator_rejects_cycle(tmp_path: Path) -> None:
    d = _copy_ontology(tmp_path)
    p = d / "actors.yaml"
    txt = p.read_text().replace("  - id: any_party\n    parents: []", "  - id: any_party\n    parents: [ad_network]")
    txt = txt.replace("roots: [any_party]", "roots: []")
    p.write_text(txt)
    errors = validate_ontology(d)
    assert any("cycle" in e for e in errors)


def test_validator_rejects_unknown_reference(tmp_path: Path) -> None:
    d = _copy_ontology(tmp_path)
    p = d / "permissions.yaml"
    p.write_text(p.read_text() + "  - {permission: android.permission.FAKE, data_types: [no_such_type]}\n")
    errors = validate_ontology(d)
    assert any("no_such_type" in e for e in errors)


def test_validator_rejects_second_root(tmp_path: Path) -> None:
    d = _copy_ontology(tmp_path)
    p = d / "actors.yaml"
    p.write_text(p.read_text() + "  - id: orphan\n    parents: []\n    label_en: O\n    label_hi: O\n    aliases: []\n")
    errors = validate_ontology(d)
    assert any("roots" in e for e in errors)
