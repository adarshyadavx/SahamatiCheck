# SahamatiCheck: App Privacy Claims Verifier

> **सहमति (sahamati) = consent.** SahamatiCheck compares what an Android app says in its **privacy policy**, what it declares in its **Play Store data-safety section**, and what its **APK** actually contains. It then shows you, with evidence, where the three disagree.

Delivered as a **Chrome extension** and a **website**. Both use one backend.
Derived from *Project_Plan_Policy_Consistency_Checker.pdf* (6 months, team of 3, B.Tech main project). Synthesised from three planning tracks: extension, backend, and web/strategy.

---

## 0. Decisions locked in this plan

| # | Decision | Why |
|---|---|---|
| D1 | **Tool route that still produces the study.** The 500-app corpus run is just the backend's batch mode. The public `/audit` dashboard is the study's results table. | This avoids "a weak version of both": one pipeline, one DB, one report schema. |
| D2 | **Clients are display-only.** The extension and the website never contain analysis logic. | Three surfaces must not split the research effort. |
| D3 | **No per-app score or grade.** Reports show tier counts, coverage, and vagueness rate. The Consistency Index exists only as an aggregate in the audit study. | A score is a verdict, and a verdict contradicts precision-first. |
| D4 | **Below-threshold findings are never shown publicly.** They are visible only in the developer **self-check** for the developer's own app. | A false positive is an accusation. |
| D5 | **Disclosure gaps live in their own array and section ("Not mentioned anywhere").** They are never counted as conflicts. | Silence is not a denial. |
| D6 | **APKs come from AndroZoo, or from a developer's own upload in self-check.** Never from Play. The extension never uploads. | Play ToS and Chrome Web Store safety. |
| D7 | **Corpus frozen at 500 apps. Gold set frozen at 100 apps by the end of Month 4.** | Spend the extra time on rigour, not sample size. |
| D8 | **Cut order if late:** ① on-device model → ② DPDP rights helper → ③ ontology explorer → ④ extension shrinks to "open website report" | Decided now so nobody argues about it in Month 5. |

---

## 1. What makes it unique

1. **Checks claims against each other instead of summarising them.**
   - ToS;DR and nutrition-label tools only restate what a policy says.
   - PolicyLint checks a policy only against itself.
   - PoliCheck predates the 2022 data-safety section and no longer runs.
   - SahamatiCheck checks **three sources against each other**, and one of them is the declaration that carries Play-policy consequences.
2. **Evidence on every finding, graded by strength.** Each finding shows:
   - the exact sentence it is based on,
   - the declaration row,
   - the permission or SDK,
   - the ontology path between them (`personal_info › identifiers › device_id › advertising_id`),
   - one of four conflict classes, shown in visually separate evidence tiers.
3. **Lives where the claims are made.** The extension annotates the Play data-safety section *in place*, and highlights policy sentences on the live policy page with the tuple each one produced.
4. **Consent Receipts + Policy Drift.**
   - The extension keeps a local, hashed snapshot of what an app claimed on the day you looked.
   - The backend versions every policy and diffs the *claims*, not the text, to detect silent changes ("Since 12 Mar the declaration stopped saying 'not shared' for Device ID").
   - No prior tool does this, and it gives the project a longitudinal research result.
5. **Built for India.** Indian app corpus, DPDP Act 2023 framing, Hindi + English from day one, and a free developer self-check before publishing.

---

## 2. System overview

```
             ┌──────────────── Chrome extension (WXT) ───────────────┐
             │ Play annotator │ Policy highlighter │ Side panel │ Receipts │
             └───────┬─────────────────────────────────────────────┬──┘
                     │        /v1 REST + SSE (shared contract)       │
 Website (Next.js) ──┤                                               │
                     ▼                                               │
   FastAPI ──► Celery chain ─► Postgres (claims, findings, snapshots) │
      │        ingest → {policy | declaration | APK} → extract →      │
      │        normalise → detect_conflicts → snapshot_diff           │
      └── Redis (queue, pub/sub → SSE, rate limits)                   │
   sahamati_core: ontology DAG + extractors + conflict engine (pure Python)
```

The core abstraction, unchanged from the PDF, is the **claim tuple**: `(actor, action, data_type, condition)` + polarity + exceptions + evidence + confidence.

---

## 3. Monorepo layout

pnpm + Turborepo for TypeScript. uv workspace for Python.

```
sahamaticheck/
  backend/
    core/                       # pure Python, no web deps
      sahamati_core/{schema,ontology,ingest,policy,declaration,apk,nlp,engine,diff}/
      ontology/{data_types,actors,purposes,ds_vocab,permissions,sdks}.yaml
      tests/fixtures/
    api/                        # FastAPI (routes/v1.py)
    worker/                     # Celery (tasks/pipeline.py)
    ml/                         # training/eval, OPP-115 mapping, model cards (not deployed)
  apps/
    web/                        # Next.js App Router
    extension/                  # WXT + React MV3
  packages/
    contracts/                  # TS types + zod, GENERATED from FastAPI OpenAPI
    ui/                         # Mudra tokens + FindingCard, TriSourceTriangle, ClaimMatrix, TierBadge…
    i18n/                       # en.json, hi.json, banned-wording list
  infra/docker-compose.yml  infra/Dockerfile.{api,worker}  infra/Caddyfile
  .github/workflows/{ci.yml,contracts.yml,nightly-eval.yml}
```

- **Contract rule:** Pydantic is the single source of truth. Types flow Pydantic → OpenAPI → `openapi-typescript` → `packages/contracts`. CI fails if the generated file is stale.
- **CI checks:**
  - ruff, `mypy --strict backend/core`, pytest with a Postgres service container
  - ontology validator
  - pnpm lint/build/Vitest
  - Playwright on saved Play/policy HTML fixtures, with axe accessibility checks
  - wording linter over both language catalogs
  - nightly gold-set evaluation

---

## 4. Backend foundation

### 4.1 Data model

```python
class SourceKind(StrEnum): POLICY="policy"; DATA_SAFETY="data_safety"; APK_PERMISSION="apk_permission"; APK_SDK="apk_sdk"
class Action(StrEnum):     COLLECT="collect"; SHARE="share"; SELL="sell"; USE="use"; RETAIN="retain"
class Polarity(StrEnum):   AFFIRM="affirm"; DENY="deny"; VAGUE="vague"

class EvidenceSpan(BaseModel):
    source_id: UUID
    char_start: int; char_end: int
    text: str                       # verbatim quote, ≤600 chars
    locator: str | None = None      # "uses-permission[3]", "dataSafety.shared[2]"

class ClaimTuple(BaseModel):
    actor: str                      # "actor:ad_network"
    action: Action
    data_type: str                  # "dt:advertising_id"
    condition: str | None = None    # "purpose:advertising"
    polarity: Polarity
    exceptions: list[str] = []      # ids carved out by "except …"/"unless …"
    source_kind: SourceKind
    evidence: EvidenceSpan
    confidence: float = Field(ge=0, le=1)
    extractor: Literal["roberta","llm","rule","mapping"]
    extractor_version: str
    ontology_version: str
```

**Postgres tables** (SQLAlchemy 2.0 + Alembic):
- `apps`
- `app_versions`, unique on (app, version_code, ds_hash, policy_hash)
- `sources`, with `fetch_status ok|unreachable|blocked|unparseable`
- `claims`
- `findings`: `class`, `tier`, `confidence`, `claim_a/b`, `overlap_node`, `rule_id`, `engine_version`, `suppressed`, `verdict`
- `jobs`
- `ontology_nodes`, keyed (id, version)
- `policy_snapshots`
- `llm_calls`: the full request/response log, for reproducibility
- `disputes`

### 4.2 Ontology as code (built in Month 1; the most important logic)

- **Source files.** YAML files are compiled into a `networkx` DAG with child→parent edges. They cover ~40 data types, 8 actors, and the purposes. Each node has `label_en`, `label_hi`, `aliases` and `dpdp_sensitive`.
- **Versioning.** Semver, e.g. `2026.10.1`. Removing or re-parenting a node is a major bump.
- **CI validator.** Checks that the graph is acyclic, has a single root per hierarchy, and that every id referenced by a mapping table exists.
- **Mapping tables.** `ds_vocab.yaml` (Play terms), `permissions.yaml` (dangerous permissions only), and `sdks.yaml` (~100 package prefixes, each with a doc citation).

```python
@cache
def ancestors_or_self(g, n): return frozenset(nx.descendants(g, n)) | {n}   # edges child→parent

def overlaps(g, a, b) -> str | None:
    """More specific node if one subsumes the other; siblings never overlap (precision)."""
    if a in ancestors_or_self(g, b): return b
    if b in ancestors_or_self(g, a): return a
    return None
```

### 4.3 Conflict engine (plain Python, one function per class)

`ACTION_IMPLIES = {sell: {share, collect}, share: {collect}}`. A DENY of `collect` also denies `share` and `sell`.

| Class | Rule (sketch) | Tier | w_class |
|---|---|---|---|
| **C1 Internal contradiction** | policy × policy: opposite polarity, actions conflict, `overlaps(data_type)`, actor overlap, not `reconciled()` by exceptions/purpose | strong | 1.0 |
| **C2 Declaration mismatch** | policy × data-safety, both directions. Includes policy AFFIRM-share vs DS "No data shared" | strong | 1.0 |
| **C3 Behavioural mismatch** | DENY (policy or DS) × APK evidence (permission/SDK) on an overlapping type | indicative | 0.7 |
| **C4 Disclosure gap** | APK evidence with no non-vague claim on an overlapping type anywhere | not mentioned | 0.4 |

**Confidence:**

`conf = w_class × min(c_a, c_b) × s_spec × s_neg`

- `s_spec = 1/(1+0.15·depth_gap)` penalises a broad DENY like `personal_info` matched against a deep node.
- `s_neg = 0.8` when negation scope was resolved heuristically rather than by a dependency arc.
- Deterministic mappings get c = 0.98. SDK evidence gets 0.85.
- Findings below a per-class threshold τ_class (set from PR curves in Month 5) are stored as `suppressed=true`.

**Tests:**
- ~40 YAML fixtures (mini-apps listing their tuples and expected findings). Examples: the canonical `personal_info` DENY vs `advertising_id` share, an "except service providers" carve-out, sibling non-overlap, a vague claim that must not hide a gap.
- Hypothesis property tests: C1 is symmetric, adding an exception never adds findings, overlap is monotone in ancestry.
- Golden files for 5 anonymised real apps.

### 4.4 ML

1. **OPP-115 → tuples.** First Party Collection/Use → collect/use. Third Party Sharing → share, with the actor taken from the entity attribute. Retention → retain. Personal-info type → `dt:` via `ml/opp_map.yaml`. Purpose → condition. Does/Does Not → polarity. "Unspecified"/generic labels plus hedges → **vague**.
2. **roberta-base multi-head** classifier (action, data_type multi-label, actor, purpose, polarity).
   - Split 75/10/15, stratified by policy.
   - One run on a T4 (Colab/Kaggle).
   - Temperature-scaled so confidences are meaningful.
3. **spaCy negation and exception handling.**
   - Negation: `neg` arcs and negative determiners in the action verb's subtree.
   - Exceptions: `except/unless/other than` → the attached noun phrases are alias-matched to ontology ids.
   - When this rule resolves scope via a dependency arc, it overrides the model's polarity.
4. **LLM fallback.** Used when roberta's max confidence is < 0.6, when negation and an exception co-occur, or for Hinglish phrasing.
   - Model: **Claude Haiku 5.5** (`claude-haiku-5-5`) by default, escalating to **Claude Sonnet 5.5** (`claude-sonnet-5-5`) for hard sentences and for the gold-set comparison.
   - Structured JSON output is constrained to a schema whose enums are ontology ids.
   - The corpus run uses the Message Batches API.
   - **Every call is logged** to `llm_calls`.
5. **Evaluation:** per-field F1 on held-out OPP-115, negation accuracy on a 200-sentence set, roberta vs LLM vs hybrid on the gold set, and cost per app.

### 4.9 Rule registry, statuses and report card (ported from the pcc plan)

The four classes and three tiers of §4.3 stay. This section adds a rule-level layer on top. It is additive: nothing in §4.3 is removed.

**Registry.** `backend/core/rules/registry/{P,D,T,A,C,S,AI}.yaml`. One loader (`sahamati_core/rules/registry.py`, `extra="forbid"`) and one evaluator (`sahamati_core/rules/evaluator.py`) over named predicates (`sahamati_core/rules/predicates.py`). Rule logic is data. Never write `if rule_id == "P06"`. Each rule has: `id`, `name`, `family`, `phase`, `enabled`, `investigation`, `severity` (high|medium|low|info), `score_track` (privacy|security), `evidence_sources.required`, `evidence_sources.any_of`, `engine_rules` (the engine ids it reads, e.g. `[DM-01]`), `requires`, `conditions`, `exclude_if`, `status_ceiling`, `result_on_match`, `inconclusive_reasons`, `user_category`, `plain_language`, `tests`. The loader rejects unknown predicates, a ceiling above `result_on_match`, and a rule with no tests. A rule whose content changes needs a `version` bump (CI hashes the registry).

**Phase 1 rules (enabled).** P05 collection contradiction, P06 sharing contradiction, P07 data-safety mismatch, P12 conflicting statements within policy, T01 undisclosed analytics SDK, T02 advertising SDK, T08 advertising ID access, D01 location indicator, D03 camera indicator, A01 sensitive permission without apparent purpose, plus the runtime stubs C03, T05, C07, S06. All 86 ids from the pcc catalogue may be listed with `enabled: false`; they appear in `rule_runs` as `inconclusive` / `not_enabled_in_this_version` only if cheap, otherwise omit them. Only enabled rules appear in `rule_runs`.

**Mapping to the engine.** P12 reads IC-01. P05 and P06 read DM-01..03 and BM-01..04, split by action (collect vs share/sell). P07 reads DM-02, DM-03 and BM-01/BM-02 (data-safety side is the denial). T01 reads the apk_sdk claims with actor `analytics_provider` against policy and data safety. Investigation rules read APK claims plus the disclosure state.

**Status ladder.** `confirmed_conflict` > `potential_conflict` > `needs_review`. A finding starts at the rule's `result_on_match` and only moves down: `exclude_if` hit = one step; `status_ceiling` = absolute cap. Ceilings: evidence `capability` (permission only) -> potential_conflict; `presence` (SDK only) -> potential_conflict; denial claim is conditional or the affirm side is broader than the denial -> needs_review; claim confidence below `min_claim_confidence` (0.70) -> needs_review. Gate: `confirmed_conflict` also needs `confidence >= confirm_threshold` (0.85), otherwise potential_conflict. All numbers live in `engine/thresholds.yaml`.

**Missing evidence never passes (AI09).** Per rule: if any `required` source has coverage other than `ok`, or no `any_of` source is usable, the `RuleRun` is `inconclusive` with the reason from `inconclusive_reasons` (`policy_unavailable`, `data_safety_unavailable`, `apk_unavailable`, `apk_unparseable`, `runtime_evidence_unavailable`, `test_account_unavailable`). `obfuscated` APK coverage counts as partial: SDK-absence rules (T01) become inconclusive `apk_partial_coverage`, never `no_issue_detected`. `no_issue_detected` is a `RuleRun` outcome only. A post-evaluation guard rewrites any illegal pass to `inconclusive` / `missing_source_false_pass_prevented` and the CI fails if it ever fires. S06 static proxy with no leads stays inconclusive.

**Indicators and dedup (AI11).** Investigation rules produce `indicators[]`. Group key is `(user_category, recipient root)`. If a finding exists on the same key, the indicator and finding share a `group_id` and the finding lists `related_finding_ids`. Parent order: P12, P06, P05, P07, T01, other.

**Report card.** `sahamati_core/report_card.py` builds `Report.card`: 10 fixed categories in this order: location, contacts, photos_files, camera_mic, messages_calls, money_payments, identity, health, ads_tracking, account_profile. Roll-up in order: any confirmed_conflict -> red; else any potential_conflict -> orange; else any needs_review (finding or indicator) -> yellow; else if any rule relevant to the category is inconclusive, a source it needs is not `ok`, or no enabled rule covers the category -> grey (note "Not checked in this version." when no rule covers it); else green. Findings map to categories through the `report_category` attribute on `data_types.yaml` nodes (nearest ancestor that carries it; `personal_info` findings take the category of the evidence side). Five answers: location, sharing, ads, deletion, grievance, assembled from findings and facts, never free text. Notes use the neutral templates in `engine/templates.yaml` (en + hi). Labels shown by clients: red "Difference found", orange "Possible difference", yellow "Unclear, needs a closer look", grey "Couldn't check", green "No issue found in what we could check" (never "safe" or "compliant").

**Golden test.** Fabricated app ShopKart (`in.example.shopkart`) is committed under `backend/core/sahamati_core/demo/fixtures/in.example.shopkart/` (policy says it never collects precise location and does not share personal information with third parties; data safety declares Device or other IDs shared for advertising and no location; manifest has ACCESS_FINE_LOCATION, CAMERA, AD_ID and the AdMob prefix `com.google.android.gms.ads`). `backend/core/tests/golden/shopkart_report.json` is the expected report, compared ignoring only `report_id`, `generated_at` and `captured_at`. Expected outcome: ads_tracking red (P06 + P07 grouped, D-style T02/T08 indicators attached), location orange (P05 potential_conflict, permission only; D01 and A01 attached), camera_mic yellow, account_profile grey, categories without an enabled rule grey, no green.

### 4.5 Job pipeline

**Request path.** `POST /v1/checks` responds synchronously in under 300 ms: either a cached report (cache key `(package, version_code, ds_hash, policy_hash, engine_version, ontology_version)`, 24 h freshness) or `202 {job_id}`.

**Celery chain:** `ingest_listing → group(fetch_policy, map_declaration, analyse_apk) → extract_claims → normalise → detect_conflicts → snapshot_diff`.
- Every stage publishes progress to Redis pub/sub, which feeds SSE.
- Claims are cached per `source.content_hash + extractor_version`.

**Degrade instead of failing:**
- An unreachable policy still produces a DS-vs-APK report.
- A packed or unparseable APK (detected by androguard/apkid) skips C3/C4 and the report says "coverage: partial".
- A PDF policy goes through pypdf.

**Scraping etiquette:**
- Global token bucket of 1 Play request per 2 s, with an honest User-Agent.
- Respect robots.txt on policy hosts.
- Fetch only for user-requested apps and the fixed corpus.

**Novel feature: Policy Drift Monitor.**
- A weekly Celery beat job re-fetches corpus policies.
- Changed hashes produce a new `policy_snapshot`.
- The diff is semantic, per `(actor, action, data_type)`: added, removed, polarity-flipped, or broadened (the type moved to an ancestor).
- A change is flagged as **silent** if the "last updated" date did not move, or if the policy and the declaration changed without each other.

### 4.6 Public API v1 (one contract for both clients)

| Method | Path | Used by |
|---|---|---|
| POST | `/v1/checks` `{package_name \| play_url}` → 200 report / 202 job | web, ext |
| GET | `/v1/jobs/{id}` (with `Retry-After`) · `/v1/jobs/{id}/events` (SSE) | web, ext |
| GET | `/v1/apps/{package}/report?version=&hl=` (ETag) | web, ext |
| GET | `/v1/apps/{package}/policy-history` | web, ext (receipts) |
| POST | `/v1/policy/segments` `{url, text, text_sha256, lang}` → sentence spans + tuples | ext highlighter |
| POST | `/v1/self-check` (multipart APK + policy + DS answers) → private report, deleted after 30 days | web only |
| GET | `/v1/ontology/{version}` | web, ext |
| POST | `/v1/findings/{id}/feedback` · `/v1/disputes` | web, ext |
| GET | `/v1/audit/aggregates` | web `/audit` |

**Report shape (the contract that matters most):**

```json
{
  "app": {"package": "com.example", "version_code": 123, "title": "…"},
  "coverage": {"policy": "ok", "data_safety": "ok", "apk": "ok|unavailable|obfuscated"},
  "summary": {"strong": 2, "indicative": 1, "not_mentioned": 4, "agree_types": 11, "vague_claim_ratio": 0.31},
  "findings": [{
    "id": "f_8c1", "class": "declaration_mismatch", "tier": "strong",
    "confidence": 0.91, "rule_id": "DM-03",
    "summary": "The policy and the data-safety section appear inconsistent about Advertising ID",
    "ontology_path": ["personal_info", "identifiers", "device_id", "advertising_id"],
    "sides": [
      {"source": "policy", "tuple": {"actor": "third_party", "action": "share", "polarity": "deny", "data_type": "personal_info"},
       "evidence": {"quote": "We never share your personal information…", "url": "https://…",
                    "char_start": 1204, "char_end": 1262, "text_fragment": "#:~:text=We%20never%20share", "captured_at": "2026-10-02"}},
      {"source": "data_safety", "tuple": {"actor": "third_party", "action": "share", "polarity": "affirm",
                    "data_type": "advertising_id", "condition": "advertising"},
       "evidence": {"label": "Device or other IDs — Shared — Advertising", "captured_at": "2026-10-02"}}
    ],
    "benign_explanations": ["An exception clause elsewhere may permit this"]
  }],
  "disclosure_gaps": [{"data_type": "contacts", "evidence": {"permission": "READ_CONTACTS"}}],
  "versions": {"engine": "0.6.2", "ontology": "2026.10.1", "extractor": "roberta-opp115@v3"}
}
```

**Auth and limits:**
- No accounts.
- 10 new checks per hour per IP. Cached report reads are limited to 120/min.
- Cloudflare Turnstile on the web forms.
- CORS allows only the web origin and `chrome-extension://<id>`.

---

## 5. Chrome extension

**Stack:** WXT + React + TypeScript + Tailwind (Vite-based, the same toolchain as `packages/ui`). Playwright runs against saved HTML fixtures.

### 5.1 MVP features
| Feature | What it does |
|---|---|
| **A. Inline data-safety annotator** | On `play.google.com/store/apps/details*` and `/datasafety*`, a seal marker appears next to each data-safety row that conflicts. Clicking it opens the side panel at the matching policy sentence. Rows are anchored by the **fixed DS vocabulary text**, never by Play's obfuscated CSS classes. Markers render in Shadow DOM. |
| **B. Policy-page highlighter** | On a user gesture ("Analyse this policy", the context menu, or `Alt+Shift+S`), the highlighter is injected via `activeTab` + `scripting`. It uses the **CSS Custom Highlight API**, so the page DOM is untouched. Hovering a sentence shows its tuple. Vague sentences get a dotted style. |
| **C. Consent Receipts + claim diff** | A local, hashed snapshot of all three sources' claims on the day you looked. On a revisit it shows what changed, combined with the backend's Policy Drift data. Receipts are stored in IndexedDB and never uploaded. They can be exported as JSON/PDF. |
| **D. DPDP rights helper** *(Month 6 stretch)* | Drafts an access, correction, erasure or grievance request to the grievance contact found in the policy, quoting the findings. Labelled "not legal advice; check DPDP Rules commencement status." |

**Rejected:** badges on Play search results (one backend call per card, and it ranks apps), intercepting the Install button (brittle, and a Web Store review risk), and a 0–100 score (see D3).

### 5.2 MV3 architecture
- **Side panel** is the primary UI, and there is no popup. The panel stays open while the user scrolls, sits next to the evidence, and can hold an SSE connection open.
- **Service worker:** API client, cache, `chrome.alarms` polling at 30 s once the panel closes, and the badge on completion.
- **Offscreen document:** an on-device **MiniLM int8 ONNX** model (~25 MB, bundled, run via transformers.js), distilled from the team's roberta.
  - Labelled "Preliminary, on-device". It colours sentences only and **never produces findings**.
- **Caching:**
  - `storage.session`: in-flight jobs.
  - `storage.local`: reports, 24 h, with ETag.
  - IndexedDB: receipts and segment results keyed by `sha256(text)`.

### 5.3 Permissions (the privacy tool must itself be minimal)
- **Required:** `storage`, `sidePanel`, `activeTab`, `scripting`, `alarms`, `offscreen`, and host `https://play.google.com/*`.
  - The only install warning is "Read and change your data on play.google.com".
- **Optional, requested in context:** `notifications`, and `https://*/*` for opt-in auto-highlighting of policy pages.

### 5.4 What the extension sends and never sends
- **Sends:** the package id, the extension version, and the policy text, but only after the user clicks, with a preview of what will be sent. Requests use `credentials: 'omit'` and carry no user id.
- **Never sends:** browsing history, cookies, the user's Google account, or receipts.
- **No analytics. No remote code.** The model is bundled. The ontology and wording are JSON data.
- **Store listing:**
  - Single purpose: "Check whether an app's privacy claims agree with each other."
  - Publish the extension's own privacy policy, and **run SahamatiCheck on it** as a demo.

---

## 6. Website

**Stack:**
- Next.js App Router + TypeScript + Tailwind v4 + shadcn/ui + TanStack Query + next-intl (`/en`, `/hi`) + MDX.
- visx for charts, a hand-written SVG for the triangle, elkjs for the ontology graph.

| Route | Purpose |
|---|---|
| `/` | Pitch, an animated triangle demo on a **fabricated** app ("Chai Wallet"), and three entry points |
| `/check` | Paste a Play link. SSE progress through the pipeline stages, with honest per-stage status ("APK not in corpus, 2-source report") |
| `/r/[id]` | Report page. `noindex`, unlisted, shareable link |
| `/self-check` | Developer uploads APK + policy + DS answers to get a private pre-publication report. Also available as a CLI / GitHub Action (`sahamati-check --apk app.apk --policy URL`) |
| `/audit` | Anonymised aggregate study: conflict rate by category and class, vagueness, SDK prevalence, failure rates. Cells with fewer than 5 apps are merged |
| `/methodology` | Pipeline, classes, precision-first rationale, kappa, PR curves, failure rates, data-sourcing paragraph |
| `/ontology` | Interactive DAG explorer: node → ancestors, descendants, mapped DS terms, permissions, SDKs |
| `/rights` | DPDP Act 2023 guide (Hindi + English) with template letters, reviewed by a law faculty contact |
| `/docs/api` · `/about` | OpenAPI docs. Team, paper, gold-set DOI, citation, dispute policy, version changelog |

**Report page:**
1. **Header and coverage strip**, with a fixed disclaimer.
2. **Tri-source triangle** (hero):
   - The vertices are Policy, Declaration and APK. Each edge is a pairwise class: P–D is declaration mismatch, P/D–A is behavioural mismatch.
   - A self-loop on P shows internal contradictions. A dashed halo on A shows gaps.
   - Edge thickness is the count. Edge style (solid/dashed/dotted) is the tier.
   - **The centre shows the number of data types on which all three sources agree.** The report opens with agreement before it shows conflicts.
3. **Claim matrix** (accessible, real `<table>`): rows are data types grouped by ontology ancestor. The columns are P/D/A, with glyphs for collects, shares, denies, vague, silent and evidence.
4. **Finding cards:**
   - both quotes verbatim
   - ontology breadcrumbs
   - capture dates
   - a 5-segment confidence meter with a word label
   - "Why this might be fine"
   - "This looks wrong"
5. **Separate section "Not mentioned anywhere"** for gaps. Footer: developer dispute link, versions, JSON export.

---

## 7. Design system: "Mudra" (मुद्रा, seal or stamp, the mark of verification)

Indian material palette (indigo, turmeric, kumkum, neem, khadi). No tricolour and no paisley. Shared by the web and the extension through `packages/ui`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--neel` primary | #2A3A8F | #9DAAF2 | brand, links |
| `--surface` | #FBF8F3 | #12141C | page background |
| `--surface-raised` | #FFFFFF | #1C1F2B | cards |
| `--ink` / `--ink-muted` | #1B1D26 / #5A5E6E | #E8E6E1 / #A3A6B4 | text |
| `--class-internal` (kumkum) | #B3261E | #F2B8B5 | C1 |
| `--class-declaration` | #5B3FA8 | #C9B8F5 | C2 |
| `--class-behaviour` (haldi) | #8A5A00 | #F0C46A | C3 (bright #E0A526 for fills only) |
| `--class-gap` (slate) | #5F6B73 | #AEB8BF | C4 |
| `--agree` (neem) | #2E6B4A | #8FD3AE | agreement |

**Type:** Anek Latin/Devanagari (display), Noto Sans + Noto Sans Devanagari (body), IBM Plex Mono (quotes, package names). Devanagari is set ~1.1× size with line-height 1.7.

**Tiers:** shown by **shape as well as colour** (filled seal = strong, outlined = indicative, dashed = not mentioned), so they still read for colour-blind users and in greyscale print.

**Accessibility:** WCAG 2.2 AA, contrast checked in CI, a keyboard-navigable triangle, `prefers-reduced-motion`, and text equivalents for every visual.

**i18n:**
- Ontology labels carry `label_en`/`label_hi` in the YAML, so the web, the extension and the paper share them.
- Quotes stay in the language of their source.
- Hindi is reviewed by a native speaker.

---

## 8. Responsible presentation and legal posture

- **Wording:**
  - Use fixed templates: "The policy states… The data-safety section declares… These appear inconsistent."
  - A **CI linter** bans "violates / lies / illegal / fraud / non-compliant" in both languages.
  - Every report carries a disclaimer: automated static analysis, may be wrong, a snapshot at a version and date, not legal advice, not affiliated with Google.
- **Public study:** aggregates only, k ≥ 5 per cell, no names, icons or leaderboards. The app-name mapping is kept privately for examiners.
- **On-demand reports:** user-initiated, unlisted, `noindex`, with no gallery. They quote only public sources. Demos use fabricated apps only.
- **Dispute flow:**
  - A developer verifies via the Play contact email domain, or via a token in the policy page or `/.well-known/`.
  - Acknowledge within 72 h and hide the finding while it is under review.
  - Then either fix the ruleset (logged) or attach the developer's response.
  - A public dispute log shows counts only.
- **Data sourcing:**
  - AndroZoo for APKs.
  - Throttled, cached listing fetches.
  - The extension reads the page the user is already viewing.
  - Supervisor sign-off, and an ethics-review query to the department.

---

## 9. Team split (3 members)

| Month | **A: Data, backend, infra, extension** | **B: NLP, then web** | **C: Ontology, rules, evaluation (strongest member)** |
|---|---|---|---|
| 1 | Monorepo/CI, scraper (1,000 IN listings → 500 frozen), AndroZoo request, FastAPI skeleton, report schema v0, WXT scaffold + Play anchoring on fixtures | OPP-115 loader + baseline; Mudra tokens + report wireframe | Ontology DAGs (en/hi), validator, `overlaps()` + tests, novelty searches |
| 2 | Policy fetch (trafilatura), Postgres schema, Celery stages + SSE | roberta multi-head fine-tune, spaCy negation/exceptions, LLM fallback + logging | Conflict rule spec, annotation guidelines, DS vocab mapping |
| 3 | androguard + apkid, permission/SDK tables, corpus run, failure rates | Vagueness class, calibration; `packages/ui` triangle/matrix/cards on mock fixtures | Label Studio setup, rule engine C1–C2 |
| 4 | Public API + caching + Turnstile, VPS deploy; extension wired to real API, receipts | Website `/check`, `/r`, i18n; distil MiniLM for the extension | Engine C3–C4, fixture suite green; **gold set 100 apps + kappa (A annotates part-time)** |
| 5 | Self-check upload + CLI, Policy Drift beat, extension hardening, **unlisted CWS submission** | `/audit`, `/ontology`, a11y pass, usability test (6–8 people) | PR curves → τ_class, full corpus run, **manual verification of every strong finding** |
| 6 | Dispute flow, load test, public CWS listing | `/rights`, docs, demo, polish | Paper (IEEE ConPro; backup SOUPS poster / PrivateNLP), dataset DOI, viva |

---

## 10. Week-1 checklist

1. **Novelty validation** on Google Scholar, GitHub **and the Chrome Web Store**. Record the results in related work. *(All)*
2. Submit the AndroZoo access request with the supervisor's email. *(A)*
3. Record decisions D1–D8 in `docs/decisions.md`. *(All)*
4. Agree the **report JSON schema v0** (§4.6) as the shared contract. *(All)*
5. Monorepo, uv + pnpm workspaces, pre-commit, CI skeleton, `docker compose up` working. *(A)*
6. Draft the data-type and actor DAGs with Hindi labels, plus `overlaps()` and 10 tests. *(C)*
7. Confirm OPP-115 downloads and parses. *(B)*
8. Reserve the domain, a GitHub org and a Chrome Web Store developer account (US$5). Claim the GitHub Student Pack. *(A)*
9. Read the Play ToS, Chrome Web Store program policies and the DPDP Act. Write a one-page legal posture and the banned-words list. *(C)*
10. Find a Hindi reviewer and a law-faculty contact. Check the ConPro and SOUPS deadlines. *(B, C)*

---

## 11. Top risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| AndroZoo access delayed or denied | Medium | The pipeline degrades to 2-source (policy vs DS), which still supports the core contribution. Self-check uploads give full 3-source reports |
| Gold-set annotation slips | **High** | Starts in Month 4 in parallel with the engine. C is accountable. It gates launch |
| Three surfaces dilute the research | Medium | Clients are display-only with a shared `packages/ui`. The cut order in D8. Web work runs on fixtures from Month 3 |
| Many false positives destroy credibility | Medium | Sibling non-overlap, `s_spec` penalty, per-class τ, suppressed findings hidden, manual verification |
| Naming a real app triggers complaints | Medium | Unlisted/noindex reports, wording linter, disclaimer, dispute + suppression, aggregate-only study |
| Play DOM changes or a CWS rejection | Medium | Anchoring by vocabulary text, DOM fixtures in CI, side-panel fallback, minimal permissions, early unlisted submission |
| Demo-day downtime | Low | Compose on one VPS, cached reports, daily Postgres backups, an offline static demo of "Chai Wallet" |
| Scope creep into dynamic analysis | Medium | Static analysis only. Explicitly out of scope |

---

## 12. Deliverables

- An open-source monorepo: pipeline, ontology, rules, API, website, extension, tests and docs.
- The 100-app annotated **gold set** (Zenodo DOI).
- An anonymised audit of **500 Indian apps** with a Policy Drift longitudinal result.
- The public website, plus the Chrome extension on the Web Store.
- The project report, and a workshop paper draft for IEEE ConPro.
