# PROMPT.md: build prompts for SahamatiCheck

These are the prompts used to build SahamatiCheck with three parallel agents. Re-run any section to rebuild or extend that part. Every agent must first read `CLAUDE.md` (rules), `PLAN.md` (design), `packages/contracts/src/index.ts` and `packages/contracts/fixtures/report.sample.json` (the contract).

---

## 0. Master prompt

> Build the SahamatiCheck MVP foundation described in `PLAN.md`. Three agents work in parallel on **disjoint directories**:
> - **Agent 1 (backend):** owns `backend/`, `infra/` and `.github/`.
> - **Agent 2 (extension):** owns `apps/extension/`.
> - **Agent 3 (web):** owns `apps/web/`, `packages/ui/` (except `tokens.css`, which may be extended but not renamed) and `packages/i18n/`.
>
> Rules for all agents:
> - Nobody edits another agent's directory, or `packages/contracts/`, `CLAUDE.md`, `PLAN.md`, `PROMPT.md` or the root `package.json` / `pnpm-workspace.yaml`. If a contract change is truly needed, write it to `docs/contract-requests.md` and work around it.
> - The API runs at `http://localhost:8000`. The demo app `in.example.chaiwallet` must produce a full 3-source report **offline** from committed fixtures, so the web and the extension can demo end to end without network access or AndroZoo.
> - "Done" means it builds and its tests pass. Report honestly what works, what is stubbed, and what is untested.

---

## 1. Agent 1: backend, pipeline, engine, API

Build `backend/` as a uv-compatible Python workspace. uv is not installed; use `python3 -m venv backend/.venv` and pip editable installs. It has three packages:

1. **`backend/core` → `sahamati_core`** (pure library)
   - **`schema/`:** Pydantic v2 models for `ClaimTuple`, `EvidenceSpan`, `Finding`, `DisclosureGap`, `Report` and `Job`. They must serialise **exactly** to the shapes in `packages/contracts/src/index.ts`.
   - **`ontology/`:** YAML files in `backend/core/ontology/`:
     - `data_types.yaml`: ~40 nodes as a DAG rooted at `personal_info` plus `app_activity`. It must include every id used in `report.sample.json`.
     - `actors.yaml`: 8 nodes (`any_party > first_party | third_party > ad_network | analytics_provider | service_provider | government | affiliate`).
     - `purposes.yaml`.
     - `ds_vocab.yaml`: the Play data-safety categories → data_type ids.
     - `permissions.yaml`: dangerous permissions → data_type ids.
     - `sdks.yaml`: about 40–100 SDK package prefixes → actor + data_types.

     Every node carries `label_en`, `label_hi` and `aliases`. Loader → `networkx.DiGraph` (edges child→parent). Validator: acyclic, single root per hierarchy, all references exist. Provide `overlaps(a, b)` (subsumption only, siblings never overlap) and `path_to_root()`.
   - **`policy/`:** HTML → clean text, using trafilatura when installed and a BeautifulSoup fallback otherwise. Sentence splitter. **Rule-based extractor** (`extractor="rule"`) that produces claim tuples from sentences:
     - alias matching to ontology ids;
     - action verbs;
     - negation scope (`not`, `never`, `no`, `do not`, `does not`, `will not`);
     - exception clauses (`except`, `unless`, `other than`);
     - a vague class (hedges such as "may", "certain information", "from time to time", where no specific data type is named).

     Design it so a roberta extractor can be plugged in later (an `Extractor` protocol). Optional spaCy path, used only if installed.
   - **`nlp/llm_fallback.py`:**
     - Uses the Anthropic SDK with `claude-haiku-5-5` and structured JSON output constrained to the ontology ids.
     - Escalates to `claude-sonnet-5-5`.
     - Logs every call to the `llm_calls` table.
     - With no `ANTHROPIC_API_KEY` it is a no-op. Tests must not call the network.
   - **`declaration/`:** maps a data-safety JSON (define a documented schema; scraper output gets converted to it) → tuples. It covers collected/shared/"no data shared", plus purposes.
   - **`apk/`:**
     - With androguard installed, read the permissions and the dex class prefixes.
     - Always support a fallback: an `AndroidManifest.xml` plus a `classes.txt` package list (used by the demo fixtures).
     - Map permissions and SDK prefixes → evidence tuples.
     - Report coverage `ok`, `obfuscated` (if apkid is available or heuristic) or `unparseable`.
   - **`engine/`:**
     - The four classes C1–C4 exactly as in PLAN.md §4.3, with `ACTION_IMPLIES`, `reconciled()` for exceptions and purpose, the confidence formula `w_class × min(c_a, c_b) × s_spec × s_neg`, and per-class thresholds in `engine/thresholds.yaml`.
     - Below-threshold findings get `suppressed=True` and are excluded from public reports.
     - Disclosure gaps go only into `disclosure_gaps`.
     - Neutral `summary` templates only.
   - **`report.py`:** builds the full `Report`, including `summary`, `matrix` (one row per data type mentioned by any source, with glyph values), `ontology_path` and `versions`.
   - **`diff/`:** Policy Drift. Semantic diff of two claim sets: added, removed, polarity_flipped, broadened.
   - **`ingest/`:** a throttled Play listing fetcher using `google-play-scraper` (optional import), with a Redis or in-memory token bucket at 1 request per 2 s, plus policy URL fetch with httpx + tenacity. Never fetch APKs from Play. AndroZoo client stub reads `ANDROZOO_API_KEY`.
   - **`demo/fixtures/in.example.chaiwallet/`:** `policy.html`, `data_safety.json`, `AndroidManifest.xml`, `classes.txt`. When run through the real pipeline they must reproduce at least the 3 findings + 1 gap in `report.sample.json` (one IC, one DM, one BM, one gap). Add a second fabricated demo app with **zero** strong findings ("Dosa Notes", `in.example.dosanotes`) to show the agreement case.

2. **`backend/api` → `sahamati_api`** (FastAPI)
   - Endpoints, per PLAN.md §4.6:
     - `POST /v1/checks`
     - `GET /v1/jobs/{id}`
     - `GET /v1/jobs/{id}/events` (SSE)
     - `GET /v1/apps/{package}/report`
     - `GET /v1/apps/{package}/policy-history`
     - `POST /v1/policy/segments`
     - `POST /v1/self-check` (multipart; private result; mark for 30-day deletion)
     - `GET /v1/ontology`
     - `POST /v1/findings/{id}/feedback`
     - `POST /v1/disputes`
     - `GET /v1/audit/aggregates` (computed from the DB; serve fabricated demo aggregates when empty, clearly flagged `"is_demo": true`)
     - `GET /healthz`
   - SQLAlchemy 2.0 models, per PLAN.md §4.1. SQLite by default, Postgres via `DATABASE_URL`.
   - CORS for `http://localhost:3000` and `chrome-extension://*`.
   - A simple per-IP rate limit.
   - Write `backend/openapi.json` via a script.

3. **`backend/worker` → `sahamati_worker`**
   - A Celery chain of the pipeline stages, with progress published for SSE.
   - With `CELERY_EAGER=1` (the default in dev) it runs inline in a thread, so no Redis is needed.

**Tests (pytest):**
- ontology validator;
- `overlaps` cases;
- ~20 YAML engine fixtures, including the canonical `personal_info` DENY vs `advertising_id` share, an exception carve-out, sibling non-overlap, and a vague claim that does not hide a gap;
- Hypothesis property tests: C1 symmetry, and exceptions never add findings;
- an extractor negation test;
- an end-to-end test of chaiwallet → report validated against the contract shape;
- API tests via httpx TestClient.

**Infra:** `infra/docker-compose.yml` (postgres:16, redis:7, api, worker), Dockerfiles, and `.github/workflows/ci.yml` (backend tests + JS build + wording check).

Keep heavy dependencies (torch, transformers, spaCy, androguard) as optional extras. The default install must stay light and fast.

---

## 2. Agent 2: Chrome extension (WXT + React + TypeScript, Manifest V3)

Build `apps/extension/` as package `@sahamati/extension`. It depends on `@sahamati/contracts` (`workspace:*`) and imports `packages/ui/src/tokens.css`. Put its own components in `apps/extension/components/`. Do not edit `packages/ui`; Agent 3 is building shared components in parallel.

- **Manifest (via `wxt.config.ts`):**
  - Required permissions: `storage`, `sidePanel`, `activeTab`, `scripting`, `alarms`, `offscreen`, plus host `https://play.google.com/*`.
  - Optional: `notifications`, `https://*/*`.
  - CSP `'wasm-unsafe-eval'` for extension pages.
  - Command `Alt+Shift+S` = analyse the current page as a policy.
  - The side panel opens when the toolbar action is clicked. **No popup.**
- **`entrypoints/background.ts`:**
  - typed message router;
  - API client (base URL configurable in the options page, default `http://localhost:8000`, `credentials: 'omit'`);
  - report cache in `storage.local` (24 h, with ETag);
  - in-flight jobs in `storage.session`;
  - `chrome.alarms` polling fallback at 30 s;
  - action badge with the count of strong findings;
  - a context-menu item "Analyse this privacy policy".
- **`entrypoints/play.content.ts`:**
  - Matches `https://play.google.com/store/apps/details*` and `https://play.google.com/store/apps/datasafety*`.
  - Reads `?id=` and handles SPA URL changes.
  - Anchors to data-safety rows **by matching the fixed DS vocabulary text** (never by CSS classes).
  - Mounts seal markers in Shadow DOM next to rows that have findings.
  - Clicking a marker opens the side panel focused on that finding.
  - If anchoring fails, degrade quietly.
- **`entrypoints/policy-highlighter.ts`:**
  - Injected only on a user gesture through `chrome.scripting`.
  - Extracts the visible text with offsets, then calls `POST /v1/policy/segments`, using the on-device preliminary result first if available.
  - Highlights with the **CSS Custom Highlight API** (`CSS.highlights`; no DOM mutation of the page text): a separate highlight per tier, dotted for vague.
  - Hover tooltip in a shadow-root overlay shows the tuple.
- **`entrypoints/offscreen/`:**
  - An on-device "preliminary" classifier interface.
  - For now, implement a fast keyword/negation heuristic behind the same interface as a future transformers.js MiniLM. Do NOT bundle a model.
  - Label the output "Preliminary, on-device". It never produces findings.
- **`entrypoints/sidepanel/`** (React), with tabs Report | Policy | Receipts:
  - **Report:** coverage strip, tier counts (no score), finding cards with verbatim quotes from both sides, ontology breadcrumbs, a confidence meter, "Why this might be fine", "This looks wrong" (→ feedback endpoint), a separate "Not mentioned anywhere" section, live job progress via EventSource, and a disclaimer.
  - **Policy:** the highlighter's results for the current tab.
  - **Receipts:** consent receipts in IndexedDB (via `idb`): a snapshot of the report claims + sha256 + date per package, a claim diff against the previous receipt, and JSON export.
- **Options page:** API base URL, language (en/hi), and opt-in auto-highlight (which requests the optional host permission at runtime).
- **i18n:** `apps/extension/locales/{en,hi}.json`. Neutral wording only (CLAUDE.md rule 4).
- **Demo:**
  - `in.example.chaiwallet` works when the backend runs.
  - With the backend down, the side panel shows `report.sample.json`, clearly labelled "Demo data".
  - Add `apps/extension/tests/fixtures/play-datasafety.html` (a hand-made page using the DS vocabulary, fabricated app) and a Vitest test that the anchoring code finds the rows.
- **Must pass:** `wxt build` and `vitest run`. Document how to load the unpacked build in `apps/extension/README.md`.

---

## 3. Agent 3: website + shared UI + i18n

Build `apps/web/` (`@sahamati/web`), `packages/ui/` (`@sahamati/ui`) and `packages/i18n/` (`@sahamati/i18n`).

- **`packages/ui`:** React + TypeScript components using the Mudra CSS variables in `src/tokens.css`. Extend that file if needed, but keep the existing token names.
  - `TriSourceTriangle`: SVG. Vertices are P/D/A. Edges: P–D carries declaration mismatches; P–A and D–A carry behavioural mismatches. A self-loop on P shows internal contradictions, a dashed halo on A shows gaps, and the centre shows `agree_types`. Edge thickness is the count and edge style (solid/dashed/dotted) is the tier. Edges are focusable buttons that filter the list. Include a text-equivalent summary.
  - `ClaimMatrix`: a real `<table>`, grouped by ontology ancestor, with glyphs.
  - `FindingCard`
  - `TierBadge`: shape plus colour (filled, outlined or dashed seal).
  - `ConfidenceMeter`: 5 segments plus a word label, with the raw value in the title.
  - `ClassIcon`: one per class.
  - `CoverageStrip`
  - `Disclaimer`

  Export the components from `src/index.ts`.
- **`packages/i18n`:**
  - `en.json` and `hi.json`, with natural Hindi.
  - `banned-words.json` (en + hi terms from CLAUDE.md rule 4).
  - `check-wording.mjs`: scans both catalogs, `apps/*/locales`, and backend summary templates (`backend/core/**/templates*.py|yaml`, if present). Exits non-zero on a hit.
- **`apps/web`:** Next.js (App Router, TypeScript, Tailwind) with locale-prefixed routes `/en` and `/hi`. Use next-intl or a small in-house dictionary loader; either is fine if `/hi` works fully.
  - **Pages:**
    - `/`: pitch, an animated triangle on the fabricated "Chai Wallet", and three CTAs.
    - `/check`: paste a Play URL or package, `POST /v1/checks`, SSE progress per stage, then redirect to the report.
    - `/r/[id]`: the full report page, per PLAN.md §6 (header + coverage + disclaimer → triangle → matrix → finding cards → "Not mentioned anywhere" → dispute link + JSON export). `noindex`.
    - `/self-check`: an upload form for `/v1/self-check`.
    - `/audit`: aggregate charts from `/v1/audit/aggregates`, hand-rolled SVG or a light chart library, with a demo-data banner when `is_demo`.
    - `/methodology`, `/ontology` (searchable node list with ancestor path, from `/v1/ontology`), `/rights` (a DPDP Act 2023 guide, marked not legal advice), `/about` (with the dispute policy), and `/docs/api`.
  - **If the API is unreachable:** fall back to `report.sample.json` with a visible "Demo data" banner.
  - Light and dark themes, plus a theme toggle using `data-theme`.
  - Fonts via `next/font/google`: Anek Latin, Noto Sans, Noto Sans Devanagari, IBM Plex Mono.
  - Accessible: keyboard navigable, labelled, `prefers-reduced-motion`.
- **Must pass:** `next build` and the wording check. Document it in `apps/web/README.md`.
