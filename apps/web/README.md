# @sahamati/web

The SahamatiCheck website: Next.js 15 (App Router, TypeScript, Tailwind 3) with locale-prefixed routes `/en` and `/hi`. The site is display-only. It renders the report JSON from the API and contains no analysis logic.

## Run

From the repo root (pnpm is not installed globally):

```sh
npx -y pnpm@9.15.0 install
npx pnpm@9.15.0 --filter @sahamati/web dev      # http://localhost:3000
npx pnpm@9.15.0 --filter @sahamati/web build
npx pnpm@9.15.0 --filter @sahamati/web start
node packages/i18n/check-wording.mjs            # wording linter + en/hi key parity
```

Environment (see `.env.example`):

| Variable | Default | Used by |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8000` | browser calls, and the server when the next variable is unset |
| `API_BASE_INTERNAL` | (unset) | server-side fetch of `/v1/reports/{id}`, e.g. `http://api:8000` in Compose |

## Routes

`/` redirects to `/en` or `/hi` (cookie `sahamati-locale`, then `Accept-Language`). Every page exists in both locales.

| Route | What it does | API |
|---|---|---|
| `/{l}` | Pitch, animated tri-source triangle on the fabricated "Chai Wallet", three CTAs | none (fixture) |
| `/{l}/check` | Play URL or package → `POST /v1/checks`; SSE progress per stage (falls back to polling `status_url`); redirects to the report | `/v1/checks`, `/v1/jobs/{id}`, `/v1/jobs/{id}/events` |
| `/{l}/r/[id]` | Full report: header, coverage, disclaimer → triangle → claim matrix → finding cards → "Not mentioned anywhere" → dispute link, versions, JSON export. `noindex` meta + `X-Robots-Tag` | `GET /v1/reports/{id}` |
| `/{l}/self-check` | Multipart upload to `/v1/self-check`; private result rendered inline | `/v1/self-check` |
| `/{l}/audit` | Aggregate charts (hand-rolled SVG), table view, demo banner when `is_demo` | `/v1/audit/aggregates` |
| `/{l}/ontology` | Searchable node list with ancestor path and children | `/v1/ontology` |
| `/{l}/methodology`, `/{l}/rights`, `/{l}/about`, `/{l}/docs/api` | Content pages; `/about` holds the dispute policy and form | `/v1/disputes` |

### Offline and demo behaviour

- `/r/[id]`: if the API is unreachable (or returns 5xx), the committed fixture `packages/contracts/fixtures/report.sample.json` is shown with a "Demo data" banner. If the API answers 404 for `r_demo_chaiwallet`, the fixture is shown; any other 404 is a 404 page.
- `/audit` and `/ontology` fall back to bundled demo data (`lib/demo.ts`) with a visible banner.
- `/check` shows a clear "API unreachable" message with a link to the demo report.
- "This looks wrong" and the dispute form report a failure inline when the API is down.

## Structure

```
app/[locale]/…      pages (server components); layout sets <html lang>, fonts, theme
components/         ReportView, CheckForm, SelfCheckForm, AuditView, OntologyExplorer, DisputeForm, header/footer
lib/api.ts          API client (timeouts, credentials: "omit", response normalisation)
lib/demo.ts         fixture report, demo aggregates, bundled ontology subset
lib/i18n.ts         locale resolution and href helper
middleware.ts       locale redirect
```

Shared UI lives in `packages/ui` (`@sahamati/ui`): `TriSourceTriangle`, `ClaimMatrix`, `FindingCard`, `GapList`/`GapCard`, `TierBadge`, `ConfidenceMeter`, `ClassIcon`, `CoverageStrip`, `Disclaimer`, `DemoBanner`, `SummaryCounts`, `OntologyPath`, `TupleChips`, `Seal`, `SealLogo`, `Glyph`. Components take a `locale` prop and style themselves through `components.css` (prefix `mu-`) on top of the Mudra tokens, so the extension can use them without Tailwind.

Strings live in `packages/i18n/{en,hi}.json`. `check-wording.mjs` bans the terms in `banned-words.json` (English on word boundaries, Hindi as substrings) across both catalogs, `apps/*/locales/**/*.json` and `backend/core/**/templates*.{py,yaml,yml}`, and fails if en and hi keys differ.

## Design notes (Mudra)

- Indigo (`--neel`) on a khadi off-white surface with a faint woven texture; dark theme from the same tokens.
- Theme toggle sets `data-theme` on `<html>` and remembers it in `localStorage`; an inline script applies it before paint.
- Fonts via `next/font/google`: Anek Latin + Anek Devanagari (display), Noto Sans + Noto Sans Devanagari (body), IBM Plex Mono (quotes, ids).
- Tiers are shape + colour (filled, outlined, dashed seal). No score or grade appears anywhere.
- Accessibility: skip link, labelled landmarks, real `<table>` for the matrix, triangle edges are keyboard buttons mirrored by HTML buttons plus a text summary, `prefers-reduced-motion` disables animation.
- The audit chart palette (`--chart-1..3`) was checked with a colour-vision validator in light and dark.

## Notes

- `tsconfig.json` maps `react`/`react-dom` types to this package's `@types` copy. The extension uses React 18, and without the mapping Next's own `.d.ts` files resolve pnpm's hoisted React 18 types.
- The request bodies for `/v1/findings/{id}/feedback` (`{verdict: "looks_wrong", report_id}`), `/v1/disputes` (`{report_id, finding_id?, contact_email, message}`) and the `/v1/self-check` multipart fields (`apk`, `package_name`, `policy_url`, `policy_text`, `data_safety`, `owner_confirmed`) are not in `packages/contracts`. They are assumptions; see `docs/contract-requests.md` if present.

## Report card, statuses and rules (round 2)

- `/{l}/r/[id]` order: header and disclaimer, **report card** (5 answers, 10 area rows, status key), tri-source view, findings (strong and indicative as separate blocks; grouped findings shown once with related ones nested; "See why" side-by-side evidence; "What can I do?"; "Report a mistake"), not-mentioned gaps, **Worth a closer look** (indicators, never counted), claim matrix, coverage + rule outcomes, **Rules not evaluated** appendix.
- `/{l}/rules` lists `GET /v1/rules`. 404 and empty lists show a notice.
- Display-only: status, colour and card contents come from the report JSON. The only client-side logic is arrangement (`groupFindings`) and display bands for confidence (strong >= 0.85, moderate >= 0.60).
- Demo fallback: if the API cannot be reached, `r_demo_chaiwallet` and `r_demo_shopkart` show the Chai Wallet fixture. Any other id shows a "could not load" page, never a demo.
- i18n key helpers for other clients (the extension) live in `packages/i18n/src/status.ts`: `statusI18nKey`, `colorI18nKey`, `categoryI18nKey`, `limitationI18nKey`, `reasonI18nKey`, `STATUS_COLOR`.
- Tests: `npx pnpm@9.15.0 --filter @sahamati/web test` (vitest, server-rendered component checks). `lint` runs `tsc` and the wording check (no ESLint is configured).
