# CLAUDE.md: SahamatiCheck

SahamatiCheck (सहमति = consent) checks an Android app's **privacy policy**, its **Play data-safety declaration**, and its **APK** (permissions + SDKs) against each other, and reports contradictions with evidence. It ships as a Chrome extension and a website, both backed by one backend. The full design is in `PLAN.md`; the build prompts are in `PROMPT.md`.

## Layout
```
backend/            Python 3.11+ (uv-compatible pyproject; venv at backend/.venv)
  core/sahamati_core/   pure library: schema, ontology, policy, declaration, apk, nlp, engine, diff
  core/ontology/*.yaml  data-type / actor / purpose DAGs + mapping tables (source of truth)
  api/                  FastAPI app, routes under /v1
  worker/               Celery tasks (CELERY_EAGER=1 runs inline, no Redis needed)
apps/web/           Next.js App Router website
apps/extension/     WXT + React Manifest V3 extension
apps/android/       Android app (WebView shell + Share target); built by build.sh, no Gradle
packages/contracts/ TS types for the API + fixtures/report.sample.json (THE contract)
packages/ui/        Mudra design tokens (tokens.css) + shared React components
packages/i18n/      en.json, hi.json, banned-words.json
```

## Commands
- Backend: `cd backend && python3 -m venv .venv && .venv/bin/pip install -e "./core[dev,render,apk]" -e ./api -e ./worker && .venv/bin/python -m playwright install chromium`
  - Tests: `cd backend && .venv/bin/pytest`
  - API: `cd backend && .venv/bin/uvicorn sahamati_api.main:app --reload --port 8000`
- JS (pnpm is not installed globally): `npx -y pnpm@9.15.0 install` at the repo root
  - Web: `npx pnpm@9.15.0 --filter @sahamati/web dev` (port 3000)
  - Extension: `npx pnpm@9.15.0 --filter @sahamati/extension dev`, then build with `... build`
- Lint the wording: `node packages/i18n/check-wording.mjs`

## Non-negotiable rules
1. **Precision over recall.** A finding reads as an accusation. Every finding carries `confidence`, `tier`, and verbatim evidence from **both** sides. Findings below the class threshold are stored with `suppressed=true` and never shown publicly.
2. **Four classes, three tiers.** `internal_contradiction` and `declaration_mismatch` are tier `strong`. `behavioural_mismatch` is tier `indicative`. `disclosure_gap` is tier `not_mentioned` and goes in its own `disclosure_gaps[]` array, never in `findings[]`.
3. **No per-app score or grade** anywhere in the UI.
4. **Wording.** Use templates such as "The policy states… The data-safety section declares… These appear inconsistent." Never write "violates", "lies", "illegal", "fraud", "non-compliant", "cheat" or "scam", in either language. `packages/i18n/banned-words.json` is enforced by `check-wording.mjs`.
5. **Clients are display-only.** All analysis logic lives in `backend/core`. The web and the extension only render the report JSON.
6. **The contract.** Pydantic models in `backend/core/sahamati_core/schema/` define the API. `packages/contracts/src/index.ts` and `fixtures/report.sample.json` must match them. If you change one, change all three in the same commit.
7. **Ontology overlap is subsumption only** (ancestor or descendant). Siblings never overlap. The ontology lives in YAML; never hardcode data types in Python.
8. **Data sourcing.** APKs come only from AndroZoo or a developer's own self-check upload, never from Play. The extension never uploads APKs. Throttle Play listing fetches.
9. **Demos and fixtures use fabricated apps only** (e.g. "Chai Wallet", `in.example.chaiwallet`; "ShopKart", `in.example.shopkart`, is the golden-test app). Never name a real app as inconsistent in committed content.
10. **Extension minimalism.** Required permissions are only `storage, sidePanel, activeTab, scripting, alarms, offscreen` plus host `https://play.google.com/*`. No analytics and no remote code.
11. **LLM fallback.** Use `claude-haiku-5-5` by default and `claude-sonnet-5-5` for hard cases. Every call is logged to `llm_calls`. The fallback is optional: with no `ANTHROPIC_API_KEY`, skip it.
12. **Five statuses, orthogonal to classes and tiers.** Every finding also carries `status` (`confirmed_conflict` | `potential_conflict` | `needs_review`), set by the registry rules in `backend/core/rules/registry/*.yaml`. `confirmed_conflict` needs a `strong` tier, confidence at or above `confirm_threshold` in `engine/thresholds.yaml`, and `declaration` or `code_path` evidence on both sides. Permission-only (`capability`) or SDK-only (`presence`) evidence is capped at `potential_conflict`. Severity and status come only from the registry and engine, never from an LLM or a client.
13. **Missing evidence never passes (AI09).** If a rule's required source is `unavailable`, `unreachable`, `unparseable` or not attempted, the rule's `RuleRun` is `inconclusive` with a reason code. `no_issue_detected` means "nothing found in the evidence we had", never "compliant" or "safe". A report-card category is green only when every enabled rule for it ran with usable sources. Runtime-only rules (C03, T05, C07, S06) return `inconclusive` / `runtime_evidence_unavailable` statically.
14. **Investigation rules are not violations.** D01-D12, T02, T08 and A01 emit `indicators[]` (status `needs_review`), never `findings[]`, and are never counted in `summary`. They share a `group_id` with a contradiction finding on the same category when one exists (dedup, AI11).
15. **Report card.** `Report.card` is built by the backend (`backend/core/sahamati_core/report_card.py`). Red appears only for `confirmed_conflict`; grey means "could not check" or "not checked in this version"; there is no overall colour, score or grade (rule 3).

## Conventions
- Python: ruff + mypy-friendly type hints, Pydantic v2, SQLAlchemy 2.0. SQLite is used when `DATABASE_URL` is unset, Postgres in Compose.
- TypeScript: strict mode, functional React components, Tailwind with Mudra CSS variables (`var(--neel)`, etc.).
- Every UI string goes through i18n (`en` + `hi`).
- Light and dark themes come from the tokens in `packages/ui/src/tokens.css`.
