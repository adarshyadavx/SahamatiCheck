"""Pipeline stages (PLAN.md §4.5), as pure functions over a JSON-serialisable state dict.

ingest_listing -> fetch_policy -> map_declaration -> analyse_apk -> extract_claims
-> detect_conflicts -> snapshot_diff

The worker runs them as a Celery chain (or inline with CELERY_EAGER=1); the
self-check endpoint calls `analyse_inputs()` directly with uploaded sources.
Every stage degrades instead of failing: a missing source only reduces coverage.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sahamati_core import ENGINE_VERSION, EXTRACTOR_VERSION
from sahamati_core.apk import evidence_from_facts, facts_from_apk, facts_from_fallback
from sahamati_core.declaration import map_declaration as _map_ds
from sahamati_core.engine import Engine, EngineResult
from sahamati_core.ingest import (
    IngestError,
    demo_apk_files,
    demo_dir,
    demo_listing,
    demo_policy,
    fetch_play_listing,
)
from sahamati_core.ingest import (
    fetch_policy as _fetch_policy,
)
from sahamati_core.nlp.llm_fallback import LLMFallback
from sahamati_core.ontology import load_ontology
from sahamati_core.policy import (
    ExtractContext,
    RuleExtractor,
    html_to_text,
    split_sentences,
    vague_claim_ratio,
)
from sahamati_core.policy.extractor import SentenceResult
from sahamati_core.policy.html import find_last_updated, looks_like_html
from sahamati_core.report import ReportInputs, build_report_full, suppressed_finding_views
from sahamati_core.report_card import derive_facts
from sahamati_core.schema import ClaimTuple, Coverage, CoverageMap, Finding, Report

STAGES = [
    "ingest_listing",
    "fetch_policy",
    "map_declaration",
    "analyse_apk",
    "extract_claims",
    "detect_conflicts",
    "snapshot_diff",
]

ProgressFn = Callable[[str, float], None]


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def sha256(s: str | bytes) -> str:
    return hashlib.sha256(s.encode("utf-8") if isinstance(s, str) else s).hexdigest()


def demo_report_id(package: str) -> str:
    return "r_demo_" + package.rsplit(".", 1)[-1]


def cache_key(package: str, version_code: int | None, ds_hash: str, policy_hash: str) -> str:
    onto = load_ontology()
    return sha256(json.dumps([package, version_code, ds_hash, policy_hash, ENGINE_VERSION, onto.version]))


def _dump(claims: list[ClaimTuple]) -> list[dict[str, Any]]:
    return [c.model_dump(mode="json") for c in claims]


def _load(claims: list[dict[str, Any]]) -> list[ClaimTuple]:
    return [ClaimTuple.model_validate(c) for c in claims]


# ------------------------------------------------------------------ stages


def stage_ingest_listing(state: dict[str, Any]) -> dict[str, Any]:
    pkg = state["package"]
    if demo_dir(pkg):
        lst = demo_listing(pkg)
    else:
        lst = fetch_play_listing(pkg)  # raises IngestError when unavailable
    state["listing"] = {
        "package": lst.package, "title": lst.title, "developer": lst.developer, "category": lst.category,
        "policy_url": lst.policy_url, "version_code": lst.version_code, "is_demo": lst.is_demo,
        "captured_at": lst.captured_at or today(), "data_safety": lst.data_safety,
    }
    return state


def policy_from_content(content: str, url: str | None, captured_at: str) -> dict[str, Any]:
    if looks_like_html(content):
        text, method = html_to_text(content)
    else:
        text, method = content.strip(), "plain"
    status = "ok" if text.strip() else "unparseable"
    return {"url": url, "text": text, "status": status, "method": method,
            "content_sha256": sha256(text), "last_updated": find_last_updated(text), "captured_at": captured_at}


def stage_fetch_policy(state: dict[str, Any]) -> dict[str, Any]:
    lst = state["listing"]
    pkg = state["package"]
    captured = lst["captured_at"]
    if lst.get("is_demo") and demo_dir(pkg):
        fp = demo_policy(pkg)
    elif lst.get("policy_url"):
        fp = _fetch_policy(lst["policy_url"])
    else:
        state["policy"] = {"url": None, "text": "", "status": "unavailable", "content_sha256": "", "captured_at": captured}
        return state
    if fp.status != "ok":
        state["policy"] = {"url": fp.url, "text": "", "status": fp.status, "content_sha256": "", "captured_at": captured}
        return state
    state["policy"] = policy_from_content(fp.content, fp.url, captured)
    return state


def stage_map_declaration(state: dict[str, Any]) -> dict[str, Any]:
    ds = state["listing"].get("data_safety")
    if not ds:
        state["ds"] = {"status": "unavailable", "claims": [], "hash": "", "unmapped": []}
        return state
    res = _map_ds(ds, source_id="data_safety")
    state["ds"] = {"status": "ok", "claims": _dump(res.tuples), "hash": sha256(json.dumps(ds, sort_keys=True)),
                   "unmapped": res.unmapped}
    return state


def apk_state_from_facts(facts: Any, captured_at: str) -> dict[str, Any]:
    res = evidence_from_facts(facts, captured_at=captured_at, source_id="apk")
    return {"coverage": res.coverage.value, "claims": _dump(res.tuples), "version_code": facts.version_code,
            "label": facts.label, "sdks": res.sdks_found, "method": facts.method, "notes": facts.notes,
            # SDK absence only means something when the whole class list was read (AI09)
            "sdk_scan": res.coverage == Coverage.OK and bool(facts.class_names)}


def stage_analyse_apk(state: dict[str, Any]) -> dict[str, Any]:
    pkg = state["package"]
    captured = state["listing"]["captured_at"]
    files = demo_apk_files(pkg) if demo_dir(pkg) else None
    if files is None:
        # AndroZoo download is not wired in the MVP; the report degrades to two sources.
        state["apk"] = {"coverage": "unavailable", "claims": [], "version_code": None, "sdks": [],
                        "notes": ["APK not in corpus; 2-source report"]}
        return state
    state["apk"] = apk_state_from_facts(facts_from_fallback(*files), captured)
    return state


def extract_policy_claims(
    text: str, *, url: str | None, captured_at: str, llm: LLMFallback | None = None
) -> tuple[list[ClaimTuple], list[SentenceResult], str]:
    ex = RuleExtractor()
    ctx = ExtractContext(source_id="policy", url=url, captured_at=captured_at)
    results = [ex.extract_sentence(s, ctx=ctx) for s in split_sentences(text)]
    extractor_version = EXTRACTOR_VERSION
    if llm is not None and llm.enabled:
        for r in results:
            if r.needs_fallback and r.tuples:
                got = llm.extract(r.sentence.text, char_start=r.sentence.start, char_end=r.sentence.end,
                                  url=url, captured_at=captured_at, source_id="policy")
                if got is not None:
                    r.tuples = got
                    extractor_version = f"{EXTRACTOR_VERSION}+llm"
    claims = [t for r in results for t in r.tuples]
    return claims, results, extractor_version


def stage_extract_claims(state: dict[str, Any], *, llm: LLMFallback | None = None) -> dict[str, Any]:
    pol = state["policy"]
    if pol.get("status") != "ok":
        state["policy_claims"], state["vague_ratio"], state["extractor_version"] = [], 0.0, EXTRACTOR_VERSION
        return state
    claims, results, ver = extract_policy_claims(pol["text"], url=pol.get("url"), captured_at=pol["captured_at"], llm=llm)
    state["policy_claims"] = _dump(claims)
    state["vague_ratio"] = vague_claim_ratio(results)
    state["extractor_version"] = ver
    return state


def _coverage(state: dict[str, Any]) -> CoverageMap:
    ps = state["policy"].get("status", "unavailable")
    pol = {"ok": Coverage.OK, "unavailable": Coverage.UNAVAILABLE, "unparseable": Coverage.UNPARSEABLE}.get(
        ps, Coverage.UNREACHABLE)
    ds = Coverage.OK if state["ds"]["status"] == "ok" else Coverage.UNAVAILABLE
    return CoverageMap(policy=pol, data_safety=ds, apk=Coverage(state["apk"]["coverage"]))


def stage_detect_conflicts(state: dict[str, Any]) -> dict[str, Any]:
    lst = state["listing"]
    claims = _load(state["policy_claims"]) + _load(state["ds"]["claims"]) + _load(state["apk"]["claims"])
    coverage = _coverage(state)
    result = Engine().run(claims, apk_ok=coverage.apk == Coverage.OK)
    version_code = lst.get("version_code") or state["apk"].get("version_code")
    key = cache_key(state["package"], version_code, state["ds"]["hash"], state["policy"].get("content_sha256", ""))
    report_id = state.get("report_id") or (
        demo_report_id(state["package"]) if lst.get("is_demo") else "r_" + key[:16]
    )
    onto = load_ontology()
    sdk_scan = bool(state["apk"].get("sdk_scan", False))
    facts = derive_facts(onto=onto, claims=claims, coverage=coverage, policy_text=state["policy"].get("text"),
                         ds=lst.get("data_safety"), sdk_scan=sdk_scan)
    built = build_report_full(ReportInputs(
        report_id=report_id, package=state["package"], title=lst["title"], version_code=version_code,
        developer=lst.get("developer"), is_demo=bool(lst.get("is_demo")), generated_at=now_iso(),
        coverage=coverage, claims=claims, engine_result=result, vague_claim_ratio=state["vague_ratio"],
        extractor_version=state.get("extractor_version", EXTRACTOR_VERSION), sdk_scan=sdk_scan, facts=facts,
    ))
    state["cache_key"] = key
    state["report"] = built.report.model_dump(mode="json")
    state["facts"] = built.facts.model_dump(mode="json")
    state["ai09_guard_events"] = built.evaluation.guard_events
    state["engine"] = _engine_summary(result)
    state["suppressed"] = [f.model_dump(mode="json") for f in suppressed_finding_views(load_ontology(), result)]
    return state


def _engine_summary(result: EngineResult) -> list[dict[str, Any]]:
    """Every finding including suppressed ones, for the `findings` table."""
    return [
        {"class": f.cls.value, "tier": f.tier.value, "rule_id": f.rule_id, "confidence": f.confidence,
         "overlap_node": f.overlap, "suppressed": f.suppressed,
         "claim_a": f.a.model_dump(mode="json"), "claim_b": f.b.model_dump(mode="json")}
        for f in result.findings
    ]


# ------------------------------------------------------------------ whole runs


def run_pipeline(package: str, *, progress: ProgressFn | None = None, llm: LLMFallback | None = None,
                 report_id: str | None = None) -> dict[str, Any]:
    """Run every stage except snapshot_diff (which needs the DB). Returns the final state."""
    state: dict[str, Any] = {"package": package}
    if report_id:
        state["report_id"] = report_id
    steps: list[tuple[str, Callable[[dict[str, Any]], dict[str, Any]]]] = [
        ("ingest_listing", stage_ingest_listing),
        ("fetch_policy", stage_fetch_policy),
        ("map_declaration", stage_map_declaration),
        ("analyse_apk", stage_analyse_apk),
        ("extract_claims", lambda s: stage_extract_claims(s, llm=llm)),
        ("detect_conflicts", stage_detect_conflicts),
    ]
    for i, (name, fn) in enumerate(steps):
        if progress:
            progress(name, i / len(STAGES))
        state = fn(state)
    return state


def report_from_state(state: dict[str, Any]) -> Report:
    return Report.model_validate(state["report"])


@dataclass
class SelfCheckResult:
    report: Report
    suppressed: list[Finding]
    state: dict[str, Any]


def analyse_inputs(
    *,
    package: str,
    report_id: str,
    title: str | None = None,
    policy_content: str | None = None,
    policy_url: str | None = None,
    data_safety: dict[str, Any] | None = None,
    manifest_xml: str | None = None,
    classes_txt: str | None = None,
    apk_path: str | None = None,
    llm: LLMFallback | None = None,
) -> SelfCheckResult:
    """Self-check: run the same pipeline on developer-supplied sources."""
    captured = today()
    state: dict[str, Any] = {"package": package, "report_id": report_id}
    state["listing"] = {"package": package, "title": title or package, "developer": None, "category": None,
                        "policy_url": policy_url, "version_code": None, "is_demo": False,
                        "captured_at": captured, "data_safety": data_safety}
    if policy_content:
        state["policy"] = policy_from_content(policy_content, policy_url, captured)
    elif policy_url:
        fp = _fetch_policy(policy_url)
        state["policy"] = (policy_from_content(fp.content, policy_url, captured) if fp.status == "ok" else
                           {"url": policy_url, "text": "", "status": fp.status, "content_sha256": "", "captured_at": captured})
    else:
        state["policy"] = {"url": None, "text": "", "status": "unavailable", "content_sha256": "", "captured_at": captured}
    state = stage_map_declaration(state)
    if apk_path:
        state["apk"] = apk_state_from_facts(facts_from_apk(apk_path), captured)
    elif manifest_xml:
        state["apk"] = apk_state_from_facts(facts_from_fallback(manifest_xml, classes_txt), captured)
    else:
        state["apk"] = {"coverage": "unavailable", "claims": [], "version_code": None, "sdks": []}
    if state["apk"].get("version_code"):
        state["listing"]["version_code"] = state["apk"]["version_code"]
    state = stage_extract_claims(state, llm=llm)
    state = stage_detect_conflicts(state)
    return SelfCheckResult(
        report=report_from_state(state),
        suppressed=[Finding.model_validate(f) for f in state["suppressed"]],
        state=state,
    )


__all__ = [
    "STAGES", "IngestError", "SelfCheckResult", "analyse_inputs", "cache_key", "demo_report_id",
    "extract_policy_claims", "now_iso", "policy_from_content", "report_from_state", "run_pipeline", "sha256",
    "stage_analyse_apk", "stage_detect_conflicts", "stage_extract_claims", "stage_fetch_policy",
    "stage_ingest_listing", "stage_map_declaration", "today",
]
