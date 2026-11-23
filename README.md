# SahamatiCheck (सहमति = consent)

SahamatiCheck compares an Android app's **privacy policy**, its **Play data-safety declaration** and its **APK**, and shows with evidence where they appear inconsistent. It ships as a Chrome extension and a website that share one backend. All analysis runs in the backend; the clients only display the report.

It is automated static analysis. It may be wrong, it reports a snapshot of one app version on one date, and it is not legal advice.

| Path | What |
|---|---|
| `backend/` | Python: analysis library, rule registry, FastAPI `/v1`, worker. See `backend/README.md` |
| `apps/web/` | Next.js website |
| `apps/extension/` | Chrome (Manifest V3) extension |
| `apps/android/` | Android app: shows the website and adds a Play Store Share target. See `apps/android/README.md` |
| `packages/` | `contracts` (the API types and sample report), `ui` (Mudra design system), `i18n` (en + hi) |
| `docs/` | `RULE_CATALOGUE.md` (generated), `VERIFICATION_GAPS.md`, `contract-requests.md`, `HINDI_GLOSSARY.md` |

Design: `PLAN.md`. Rules for contributors and agents: `CLAUDE.md`.

## Run it

```bash
# backend (port 8000); the fabricated demo apps work offline
cd backend && python3 -m venv .venv && .venv/bin/pip install -e "./core[dev,render,apk]" -e ./api -e ./worker && .venv/bin/python -m playwright install chromium
.venv/bin/uvicorn sahamati_api.main:app --port 8000

# website (port 3000) and extension
npx -y pnpm@9.15.0 install
npx pnpm@9.15.0 --filter @sahamati/web dev
npx pnpm@9.15.0 --filter @sahamati/extension build      # load apps/extension/.output/chrome-mv3 as an unpacked extension
```

Open `http://localhost:3000/en/r/r_demo_shopkart`. Ready-made builds of the extension and the Android app are on the website's Download page (`/en/download`). Demo apps are fabricated (`in.example.shopkart`, `in.example.chaiwallet`).

## Checks

```bash
cd backend && .venv/bin/pytest && .venv/bin/ruff check core api worker \
  && .venv/bin/mypy core/sahamati_core api/sahamati_api worker/sahamati_worker \
  && .venv/bin/mypy --strict core/sahamati_core/rules core/sahamati_core/engine
node packages/i18n/check-wording.mjs
npx pnpm@9.15.0 -r test                                                   # unit tests (web, extension)
SAHAMATI_API_URL=http://localhost:8000 npx pnpm@9.15.0 -r --if-present run test:e2e   # clients against a live backend
cd apps/web && npx playwright test                                         # visual + contrast (needs web + backend running)
cd apps/extension && SAHAMATI_API_URL=http://localhost:8000 npx playwright test   # real side panel (build first)
```

`GET /version` tells you which backend build you are talking to; both clients warn when it is older than they are.

## Limitations

Static-first: nothing runs the app. Four rules (C03 tracking before consent, T05 endpoint mismatch, C07 account deletion, S06 sensitive data in logs) always answer "couldn't check" and say why. Only 15 of 86 catalogued rules are enabled. See `backend/README.md` for the full list.
