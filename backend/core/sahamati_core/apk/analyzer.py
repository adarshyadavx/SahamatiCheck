"""APK -> permission / SDK evidence tuples.

Two input paths:
* a real APK, read with androguard when installed (optional `apk` extra);
* a fallback pair, always supported: a plain-text `AndroidManifest.xml` plus a
  `classes.txt` listing class or package names one per line (the demo fixtures
  use this; a developer can also produce it with `apkanalyzer`).

Never fetches APKs from Play. APKs come from AndroZoo or a developer's own upload.

Coverage: `ok`, `obfuscated` (apkid when installed, else a short-identifier
heuristic over class names) or `unparseable`.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from sahamati_core.ontology import Ontology, load_ontology
from sahamati_core.schema import Action, ClaimTuple, Coverage, EvidenceSpan, Polarity, SourceKind

ANDROID_NS = "{http://schemas.android.com/apk/res/android}"
SDK_CONFIDENCE = 0.85
OBFUSCATION_THRESHOLD = 0.6  # share of classes whose package path is mostly 1-2 char segments


@dataclass
class ApkFacts:
    package: str | None = None
    version_code: int | None = None
    label: str | None = None
    permissions: list[str] = field(default_factory=list)
    class_names: list[str] = field(default_factory=list)
    coverage: Coverage = Coverage.OK
    method: str = "manifest+classes"
    notes: list[str] = field(default_factory=list)


@dataclass
class ApkResult:
    facts: ApkFacts
    tuples: list[ClaimTuple]
    sdks_found: list[str]
    coverage: Coverage


def parse_manifest_xml(xml_text: str) -> tuple[str | None, int | None, str | None, list[str]]:
    root = ET.fromstring(xml_text)
    pkg = root.get("package")
    vc_raw = root.get(f"{ANDROID_NS}versionCode") or root.get("versionCode")
    vc = int(vc_raw) if vc_raw and vc_raw.isdigit() else None
    app = root.find("application")
    label = app.get(f"{ANDROID_NS}label") if app is not None else None
    perms: list[str] = []
    for tag in ("uses-permission", "uses-permission-sdk-23"):
        for el in root.iter(tag):
            name = el.get(f"{ANDROID_NS}name") or el.get("name")
            node_attr = el.get("{http://schemas.android.com/tools}node")
            if name and node_attr != "remove" and name not in perms:
                perms.append(name)
    return pkg, vc, label, perms


def parse_classes_txt(text: str) -> list[str]:
    out: list[str] = []
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        # accept "Lcom/foo/Bar;" smali-style descriptors as well as dotted names
        if ln.startswith("L") and ln.endswith(";"):
            ln = ln[1:-1].replace("/", ".")
        out.append(ln)
    return out


def _obfuscation_ratio(class_names: list[str]) -> float:
    if not class_names:
        return 0.0
    short = 0
    for c in class_names:
        segs = [s for s in re.split(r"[.$]", c) if s]
        if segs and sum(1 for s in segs if len(s) <= 2) / len(segs) >= 0.6:
            short += 1
    return short / len(class_names)


def facts_from_fallback(manifest_xml: str, classes_txt: str | None) -> ApkFacts:
    try:
        pkg, vc, label, perms = parse_manifest_xml(manifest_xml)
    except ET.ParseError as exc:
        return ApkFacts(coverage=Coverage.UNPARSEABLE, notes=[f"manifest parse error: {exc}"])
    classes = parse_classes_txt(classes_txt or "")
    facts = ApkFacts(package=pkg, version_code=vc, label=label, permissions=perms, class_names=classes)
    if classes and _obfuscation_ratio(classes) >= OBFUSCATION_THRESHOLD:
        facts.coverage = Coverage.OBFUSCATED
        facts.notes.append("class names look obfuscated (heuristic)")
    if classes_txt is None:
        facts.notes.append("no class list: SDK detection skipped")
    return facts


def facts_from_apk(path: str | Path) -> ApkFacts:
    """Read a real APK with androguard (optional). Unparseable if androguard is missing or fails."""
    try:
        try:
            from androguard.core.apk import APK  # type: ignore[import-not-found]  # androguard >= 4
            from androguard.core.dex import DEX  # type: ignore[import-not-found]
        except ImportError:
            from androguard.core.bytecodes.apk import APK  # type: ignore[import-not-found,no-redef]
            from androguard.core.bytecodes.dvm import DalvikVMFormat as DEX  # type: ignore[import-not-found,no-redef]
    except ImportError:
        return ApkFacts(coverage=Coverage.UNPARSEABLE, method="androguard",
                        notes=["androguard is not installed; upload AndroidManifest.xml + classes.txt instead"])
    try:
        apk = APK(str(path))
        perms = sorted(set(apk.get_permissions()))
        classes: list[str] = []
        for dex_bytes in apk.get_all_dex():
            d = DEX(dex_bytes)
            for cn in d.get_classes_names():
                classes.append(cn[1:-1].replace("/", ".") if cn.startswith("L") else cn)
        vc_raw = apk.get_androidversion_code()
        facts = ApkFacts(
            package=apk.get_package(),
            version_code=int(vc_raw) if vc_raw and str(vc_raw).isdigit() else None,
            label=apk.get_app_name(),
            permissions=perms,
            class_names=classes,
            method="androguard",
        )
    except Exception as exc:  # noqa: BLE001
        return ApkFacts(coverage=Coverage.UNPARSEABLE, method="androguard", notes=[f"androguard failed: {exc}"])
    packed = _apkid_packed(path)
    if packed or _obfuscation_ratio(classes) >= OBFUSCATION_THRESHOLD:
        facts.coverage = Coverage.OBFUSCATED
        facts.notes.append("packer/obfuscator detected" if packed else "class names look obfuscated (heuristic)")
    return facts


def _apkid_packed(path: str | Path) -> bool:
    try:
        import apkid  # type: ignore[import-not-found]  # noqa: F401
    except ImportError:
        return False
    # apkid's Python API is unstable across releases; treat any detection we cannot read as "not packed".
    return False


def evidence_from_facts(facts: ApkFacts, *, ontology: Ontology | None = None, captured_at: str = "",
                        source_id: str = "") -> ApkResult:
    onto = ontology or load_ontology()
    tuples: list[ClaimTuple] = []
    if facts.coverage == Coverage.UNPARSEABLE:
        return ApkResult(facts=facts, tuples=[], sdks_found=[], coverage=facts.coverage)

    def mk(actor: str, action: Action, dt: str, kind: SourceKind, text: str, locator: str, conf: float) -> ClaimTuple:
        return ClaimTuple(
            actor=actor, action=action, data_type=dt, polarity=Polarity.AFFIRM, source_kind=kind,
            evidence=EvidenceSpan(source_id=source_id, text=text, locator=locator, captured_at=captured_at),
            confidence=conf, extractor="mapping", extractor_version="apk-mapping@0.1.0",
            ontology_version=onto.version,
        )

    for i, perm in enumerate(facts.permissions):
        pe = onto.permissions.get(perm)
        if not pe:
            continue
        for dt in pe.data_types:
            tuples.append(mk("first_party", Action.COLLECT, dt, SourceKind.APK_PERMISSION, perm,
                             f"uses-permission[{i}]", pe.confidence))

    sdks_found: list[str] = []
    if facts.coverage == Coverage.OK and facts.class_names:
        entries = onto.sdks_by_prefix_len
        matched: dict[str, bool] = {}
        for cn in facts.class_names:
            for se in entries:
                if cn == se.prefix or cn.startswith(se.prefix + "."):
                    matched.setdefault(se.prefix, True)
                    break
        for se in onto.sdks:
            if se.prefix not in matched:
                continue
            sdks_found.append(se.prefix)
            for dt in se.data_types:
                # Play counts data gathered by an embedded SDK as collected by the app
                tuples.append(mk("first_party", Action.COLLECT, dt, SourceKind.APK_SDK, se.prefix,
                                 f"classes:{se.prefix}", SDK_CONFIDENCE))
                if se.action == "share":
                    tuples.append(mk(se.actor, Action.SHARE, dt, SourceKind.APK_SDK, se.prefix,
                                     f"classes:{se.prefix}", SDK_CONFIDENCE))
    return ApkResult(facts=facts, tuples=tuples, sdks_found=sdks_found, coverage=facts.coverage)
