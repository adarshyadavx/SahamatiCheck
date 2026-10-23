# SahamatiCheck backend

The backend is a Python 3.11+ workspace with three packages. The pyprojects are uv-workspace compatible, and plain pip + venv works too.

| Package | Import | What it is |
|---|---|---|
| `core/` | `sahamati_core` | Pure library: the schema (the API contract), the ontology loader and validator, policy extraction, the data-safety mapper, APK analysis, the conflict engine, the report builder, Policy Drift diff, ingest, and the DB models |
| `api/` | `sahamati_api` | FastAPI app, `/v1` routes |
| `worker/` | `sahamati_worker` | Pipeline runner. It is a Celery chain; `CELERY_EAGER=1` (the default) runs it inline in a thread, so no Redis is needed |

The ontology lives in YAML in `core/ontology/`. It is the source of truth; no data types are hardcoded in Python. The rules live in YAML in `core/rules/registry/` (see "Rule registry" below); no rule id is hardcoded in Python either.

## Quick start

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e "./core[dev]" -e ./api -e ./worker
.venv/bin/pytest                                   # 287 tests, no network
.venv/bin/uvicorn sahamati_api.main:app --reload --port 8000
```

With uv: `cd backend && uv sync --all-packages --extra dev`.

Try the fabricated demo apps, which run fully offline from `core/sahamati_core/demo/fixtures/`:

```bash
curl -s -XPOST localhost:8000/v1/checks -H 'content-type: application/json' \
     -d '{"package_name":"in.example.chaiwallet"}'          # 202 {kind:"job",...}, or 200 once cached
curl -s 'localhost:8000/v1/checks?wait=true' -XPOST -H 'content-type: application/json' \
     -d '{"package_name":"in.example.chaiwallet"}'          # 200 {kind:"report", report}
curl -s localhost:8000/v1/apps/in.example.chaiwallet/report
curl -s localhost:8000/v1/reports/r_demo_chaiwallet
curl -s localhost:8000/v1/apps/in.example.dosanotes/report # the agreement case: zero strong findings
curl -s localhost:8000/v1/reports/r_demo_shopkart          # the golden-test app: one red category, one orange, one yellow
curl -s 'localhost:8000/v1/rules?family=P'                 # the rule registry
```

Chai Wallet (`in.example.chaiwallet`) produces findings in every class:

| Class | Finding |
|---|---|
| internal contradiction | precise location |
| declaration mismatch | device IDs vs "never share your personal information" |
| behavioural mismatch | contacts declared not collected vs `READ_CONTACTS` |
| disclosure gap | `CAMERA` |

Its summary and matrix equal `packages/contracts/fixtures/report.sample.json` (asserted in the tests), and so do its finding ids, groups, strengths, limitations, indicators and rule runs, except for the documented differences listed in `test_e2e_contract.py` and `../docs/contract-requests.md` (notably `f_dm_01` is `potential_conflict`, not `confirmed_conflict`). Dosa Notes (`in.example.dosanotes`) produces no findings. ShopKart (`in.example.shopkart`) is the golden-test app: `core/tests/golden/shopkart_report.json` is its full expected report.

## Optional extras (the default install stays light)

| Extra | Enables | Fallback without it |
|---|---|---|
| `core[html]` (trafilatura) | Better HTML boilerplate removal | BeautifulSoup |
| `core[nlp]` (spaCy + `en_core_web_sm`) | Negation from dependency arcs (s_neg = 1.0) | Cue-window negation (s_neg = 0.8, or 1.0 for a cue directly before the verb) |
| `core[apk]` (androguard) | Parsing real `.apk` uploads | `AndroidManifest.xml` + `classes.txt`; an `.apk` upload reports `apk: unparseable` |
| `core[play]` (google-play-scraper) | Play listing fetch for non-demo apps, throttled to 1 request / 2 s | Only the demo apps work; other packages get 422 |
| `core[llm]` (anthropic) + `ANTHROPIC_API_KEY` | LLM fallback for hard sentences (`claude-haiku-5-5`, escalating to `claude-sonnet-5-5`), with structured JSON constrained to ontology ids and every call logged to `llm_calls` | No-op |
| `core[ml]` (torch, transformers) | Reserved for the roberta extractor (implements the `Extractor` protocol) | The rule extractor |
| `core[pdf]`, `core[redis]`, `core[postgres]` | PDF policies, a shared Redis token bucket, Postgres | Skip PDFs, an in-process bucket, SQLite |

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | SQLite at `backend/.data/sahamati.db` | Postgres: `postgresql+psycopg://…` |
| `SAHAMATI_DATA_DIR` | `backend/.data` | Where the SQLite file lives |
| `CELERY_EAGER` | `1` | `0` sends jobs to Celery via `REDIS_URL` |
| `REDIS_URL` | unset | Celery broker and the shared Play token bucket |
| `SAHAMATI_CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Web origins |
| `SAHAMATI_CORS_ORIGIN_REGEX` | `chrome-extension://[a-p]{32}` | Pin your extension id in production |
| `SAHAMATI_RATE_CHECKS_PER_HOUR` / `SAHAMATI_RATE_READS_PER_MIN` | `10` / `120` | Per-IP limits. Demo apps are exempt from the checks limit |
| `SAHAMATI_RATE_LIMIT_DISABLED` | `0` | Set to `1` to disable rate limits |
| `ANTHROPIC_API_KEY` | unset | Enables the LLM fallback |
| `ANDROZOO_API_KEY` | unset | AndroZoo client (stub; downloads are not wired yet) |

## API (`/v1`, see `openapi.json`)

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/checks` | `{package_name \| play_url}`. Returns 200 `{kind:"report"}` from the cache (24 h), or 202 `{kind:"job", job_id, status_url, events_url}`. `?wait=true` runs inline |
| GET | `/v1/jobs/{id}` | `Job`, with `Retry-After` while running |
| GET | `/v1/jobs/{id}/events` | SSE: `progress` events, then `done` or `error`. `data` is a `Job` |
| GET | `/v1/apps/{package}/report` | `?version=&hl=hi`, with ETag / 304 and `X-Robots-Tag: noindex` |
| GET | `/v1/reports/{report_id}` | *Extension of the contract* (web `/r/[id]`). Demo ids resolve offline |
| GET | `/v1/apps/{package}/policy-history` | Snapshots plus semantic claim diffs (added / removed / polarity_flipped / broadened, and silent) |
| POST | `/v1/policy/segments` | `{url, text, text_sha256, lang}` returns sentence spans with tuples (for the extension highlighter) |
| POST | `/v1/self-check` | Multipart. Private result with `suppressed_findings`, deleted after 30 days. The APK is never stored |
| GET | `/v1/ontology`, `/v1/ontology/{version}` | All data_type, actor and purpose nodes |
| GET | `/v1/rules` | *Extension of the contract.* The rule registry (`?family=P\|D\|T\|A\|C\|S\|AI`), with names and plain-language text in en and hi |
| POST | `/v1/findings/{id}/feedback` | 202 |
| POST | `/v1/disputes` | 201 |
| GET | `/v1/audit/aggregates` | Computed from public non-demo reports, with k ≥ 5 per cell. Fabricated aggregates with `is_demo: true` when the DB is empty |
| GET | `/healthz` | Liveness and versions |

To regenerate the spec, run `.venv/bin/python scripts/export_openapi.py`. CI runs it with `--check`.

Contract extensions are listed in `../docs/contract-requests.md`.

## How the engine decides (precision first)

- **Claim tuples.** Each one is `(actor, action, data_type, condition)` plus polarity, exceptions, evidence and confidence.
  - Policy sentences go through the rule extractor in `core/sahamati_core/policy/extractor.py`. It does alias matching against the ontology YAML, finds action verbs, applies per-verb negation scope, cuts out exception clauses, and assigns the vague class (a hedge with no specific type).
  - The data-safety JSON (`sahamati.data_safety/v1`, documented in `declaration/mapper.py`) and the APK permissions/SDKs map deterministically (c = 0.98; SDKs 0.85).
- **Overlap is subsumption only** (`ontology/loader.py`). Siblings never overlap. A DENY conflicts with an AFFIRM only when it **covers** it:
  - the denied type is ancestor-or-self of the affirmed type;
  - the denied actor is ancestor-or-self of the affirmed actor;
  - the affirmed action equals or implies the denied action (`sell ⇒ share ⇒ collect`);
  - and the pair is not `reconciled()` by an exception or a different purpose.
- **Four classes** are implemented in `engine/rules.py`:
  - IC-01 and DM-01/02/03 are `strong`;
  - BM-01..04 are `indicative`;
  - disclosure gaps are `not_mentioned` and go only into `disclosure_gaps[]`.

  A cross-source conflict whose policy DENY is already contradicted inside the policy is reported once, as the internal contradiction.
- **Confidence** is `w_class × min(c_a, c_b) × s_spec × s_neg`. Weights, thresholds and `ACTION_IMPLIES` are in `engine/thresholds.yaml`. `s_neg` is 0.8 when the negation scope was found loosely in a window, and 1.0 when a cue sits directly before the verb ("never share", "do not collect") or a dependency arc found it.
  - The τ values are provisional until the PR curves exist.
  - Findings below τ are stored with `suppressed=true` and only appear in self-check.
- **Summaries** come from the neutral templates in `engine/templates.yaml` (en + hi), which `packages/i18n/check-wording.mjs` scans.
- **No per-app score** exists anywhere.

## Rule registry, statuses and the report card (PLAN.md §4.9)

The engine (`engine/rules.py`) finds contradictions. The registry decides what each one *means*. Rules are data:

```
core/rules/registry/{P,D,T,A,C,S,AI}.yaml   the rules (Phase 1: P05 P06 P07 P12, D01 D03, T01 T02 T05 T08, A01, C03 C07, S06, and the AI09 guard)
core/rules/registry/reasons.yaml            coverage state -> inconclusive reason code
core/rules/registry/registry.lock.json      version + content hash per rule
core/sahamati_core/rules/                   models.py (strict schema), registry.py (loader, lock), predicates.py, evaluator.py
core/sahamati_core/report_card.py           10 categories, roll-up, 5 answers, grouping, plain facts
core/sahamati_core/engine/thresholds.yaml   `status:` section: confirm_threshold 0.85, min_claim_confidence 0.70, ceilings, strength weights
core/sahamati_core/engine/templates.yaml    every neutral sentence, en + hi (also scanned by check-wording.mjs)
```

- **Statuses.** A finding starts at its rule's `result_on_match` and only moves down: an `exclude_if` hit is one step, a ceiling is an absolute cap (permission-only or SDK-only evidence, a conditional denial, a claim read below `min_claim_confidence`). `confirmed_conflict` also needs tier `strong`, `confidence >= confirm_threshold` and `declaration` or `code_path` evidence on the weaker side. Severity and status come only from here, never from a client or an LLM.
- **Missing evidence never passes (AI09).** A rule whose required source is not `ok` (or none of its `any_of` sources) reports `inconclusive` with a reason code. An obfuscated APK, or one whose class list was not read, makes the SDK-absence rules (T01, T02) `inconclusive / apk_partial_coverage`. A post-evaluation guard rewrites any illegal pass to `missing_source_false_pass_prevented`; `test_ai09.py` proves it never fires and that removing any required source never yields `no_issue_detected`.
- **Indicators.** D01, D03, T02, T08 and A01 are investigation rules: they emit `indicators[]` (`needs_review`), never `findings[]`, and are not counted in `summary`. Findings and indicators on the same (category, recipient root) share a `group_id`.
- **Report card.** Red only for `confirmed_conflict`; grey is "could not check" or "not checked in this version"; green needs every enabled rule for the category to have run on usable sources. There is no overall colour, score or grade.

**Add a rule.** Edit the family file, with no Python change unless it needs a new predicate:

1. Add the rule with `id`, `version: 1`, `name`/`name_hi`, `evidence_sources`, `engine_rules`, `conditions`, `result_on_match`, `inconclusive_reasons` (every reason its sources and `requires` can produce), `categories`, `plain_language`/`plain_language_hi` and `tests` (a `positive`, a `negative` and, if it reads a source, an `inconclusive` case; claims use the same shorthand as `tests/fixtures/engine_cases.yaml`). An investigation rule also needs an `indicator:` sentence in `templates.yaml` (en + hi).
2. A new check goes in `rules/predicates.py` as a `@predicate`, then is named in YAML. Unknown predicates, unknown arguments, a ceiling above `result_on_match` and a rule without tests are load errors.
3. Changing an existing rule needs a `version` bump. Then run `.venv/bin/python -m sahamati_core.rules --update-lock`.
4. `.venv/bin/python -m sahamati_core.rules` is the registry lint (CI runs it); `pytest core/tests/test_registry_cases.py` runs every rule's own cases.

A **golden test** (`core/tests/golden/`) compares the full ShopKart report with `shopkart_report.json`, ignoring only `report_id`, `generated_at`, `captured_at` (and `checked_at`, which equals `generated_at`). After an intended change: `UPDATE_GOLDEN=1 .venv/bin/pytest core/tests/golden`, then review the diff.

## Tests

`.venv/bin/pytest` runs 287 tests. A root `conftest.py` blocks non-localhost sockets, and each run uses a temporary SQLite DB. The tests cover:
- the ontology validator, including cycle, unknown-reference and second-root cases;
- `overlaps()` cases;
- 25 YAML engine fixtures (`core/tests/fixtures/engine_cases.yaml`);
- Hypothesis properties: C1 symmetry, exceptions never add findings, and overlap monotonicity and symmetry;
- extractor negation, exception and vague cases;
- the declaration, APK and drift-diff modules;
- the LLM fallback with a fake client (no network);
- end to end chaiwallet → report, validated against `packages/contracts/src/index.ts` by a small TS-interface checker, and compared with the extended sample;
- the rule registry: loader strictness, version lock, 59 per-rule cases (positive, negative, inconclusive, guard), the AI09 property tests, the status ladder and confirm gate, grouping, the report card, hiding a disputed finding, the ShopKart golden;
- the API via TestClient, including SSE, ETag, self-check, CORS and the rate limit;
- the worker, with eager threads and the Celery chain run eagerly.

## Layout

```
core/ontology/*.yaml              data_types (46, each under one of 10 report categories), actors (8), purposes, ds_vocab, permissions, sdks (53)
core/sahamati_core/schema/        Pydantic v2 models = the contract
core/sahamati_core/engine/        rules.py, thresholds.yaml, templates.yaml, facts.yaml
core/sahamati_core/rules/         the registry layer: models, registry (loader, lock), predicates, evaluator
core/rules/registry/              the rules (YAML), reasons.yaml, registry.lock.json
core/sahamati_core/report_card.py the report card, grouping and plain facts
core/sahamati_core/pipeline.py    stages: ingest_listing → fetch_policy → map_declaration → analyse_apk
                                  → extract_claims → detect_conflicts → snapshot_diff
core/sahamati_core/db/            SQLAlchemy 2.0 models + repo helpers (shared by api and worker)
core/sahamati_core/demo/fixtures/ in.example.chaiwallet, in.example.dosanotes, in.example.shopkart (fabricated apps only)
scripts/export_openapi.py         writes openapi.json
```
