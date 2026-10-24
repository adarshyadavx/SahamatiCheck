# Testing

| Layer | What it proves | Where | Run |
|---|---|---|---|
| Backend unit | Pure logic: ontology, extractor, engine, rule registry, predicates, APK parsing, ingest (HTTP, robots.txt, retries, Play scraper and Redis faked), throttling, LLM fallback, repo helpers, CLIs | `backend/core/tests`, `backend/worker/tests` | `cd backend && .venv/bin/pytest` |
| Backend rule fixtures | Every enabled rule has a positive, a negative and an inconclusive case; AI09 never lets a missing source pass | `backend/core/rules/registry/*.yaml` (`tests:`), `test_registry_cases.py`, `test_ai09.py` | same |
| Backend integration | HTTP API -> pipeline -> engine -> database -> report, nothing mocked inside the system: checks and jobs, server-sent events, ETags and language, self-check uploads (APK never kept), disputes hiding a finding, feedback, purge of expired private reports, audit k-anonymity | `backend/api/tests/test_integration.py`, `test_api.py`, `test_runtime_rules.py`, `test_i18n_coverage.py` | same |
| Contract | The real API responses match `packages/contracts/src/index.ts` field by field (`ts_contract.py` parses the TS) and the committed OpenAPI file | `backend/core/tests/test_e2e_contract.py`, `backend/api/tests` | same |
| Golden | The ShopKart report equals `backend/core/tests/golden/shopkart_report.json` | `backend/core/tests/golden` | same |
| Web unit | The API client (errors, unreachable vs HTTP error, response shapes, input parsing), status and card components, dates | `apps/web/tests` | `npx pnpm@9.15.0 --filter @sahamati/web test` |
| Web component | Forms with a real DOM: validation, event-stream and polling fallbacks, retry, dispute, self-check | `apps/web/tests/components` (jsdom + Testing Library) | same |
| Extension unit | API client and report cache (per language), job polling, settings, anchoring, card helpers, stale-backend check | `apps/extension/tests` | `npx pnpm@9.15.0 --filter @sahamati/extension test` |
| Client vs live backend | The real client code against a running backend, fixtures off | `apps/*/tests/e2e` | `SAHAMATI_API_URL=http://localhost:8000 npx pnpm@9.15.0 -r --if-present run test:e2e` |
| Browser integration | Real Chromium -> Next.js -> API -> database: check, Hindi, self-check, dispute, 404; the built extension's real side panel | `apps/web/tests/visual/flows.spec.ts`, `apps/extension/tests/panel` | see below |
| Visual and accessibility | Screenshots in light, dark, phone and Hindi; WCAG AA contrast with a negative control; no hydration errors; 200% zoom | `apps/web/tests/visual/report.spec.ts`, `apps/extension/tests/panel` | see below |

## Browser tests (not in CI: they need a browser, running servers and this machine's fonts)

```bash
# servers: the backend must allow the web origin for browser tests
cd backend && SAHAMATI_CORS_ORIGINS=http://localhost:3000,http://localhost:3020 .venv/bin/uvicorn sahamati_api.main:app --port 8020
NEXT_PUBLIC_API_BASE=http://localhost:8020 npx pnpm@9.15.0 --filter @sahamati/web exec next dev -p 3020

cd apps/web && npx playwright install chromium            # once
SAHAMATI_API_URL=http://localhost:8020 npx playwright test
npx pnpm@9.15.0 --filter @sahamati/extension build
cd apps/extension && SAHAMATI_API_URL=http://localhost:8020 npx playwright test
```

Update baselines with `--update-snapshots` only after looking at the new images.

## Coverage (2026-10-24)

- Backend: **94%** of lines (`pytest --cov`); CI fails below 90%. The two command-line modules (`ontology/__main__`, `rules/__main__`) show 0% because their tests run them as subprocesses.
- Web and extension libraries: the API client, settings, jobs, play, sentences and the form components are covered. Not covered by unit tests: `apps/extension/entrypoints/background.ts` and the side-panel views (they need the `chrome.*` APIs; the Playwright panel tests exercise them in a real browser), and the Next.js page files and server components (exercised by the Playwright flows).

## Known gaps

- No mutation testing, load testing or fuzzing of the policy extractor beyond the Hypothesis properties in `test_properties.py`.
- Real Play listings, AndroZoo and real APK parsing with androguard are never exercised: tests must not touch the network, and androguard is an optional extra (its code path is tested with a fake).
- A few SQLite `ResourceWarning`s (unclosed connections) appear when warnings are shown with `-W default`; they come from the app's engine pool in the upload tests and predate this document.
