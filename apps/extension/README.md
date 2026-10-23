# @sahamati/extension

SahamatiCheck's Chrome extension (WXT + React + TypeScript, Manifest V3). It only displays
reports from the SahamatiCheck API. All analysis happens in `backend/core` (CLAUDE.md rule 5).

## Build and load unpacked

From the repo root (pnpm is not installed globally):

```sh
npx -y pnpm@9.15.0 install
npx -y pnpm@9.15.0 --filter @sahamati/extension build     # → apps/extension/.output/chrome-mv3
npx -y pnpm@9.15.0 --filter @sahamati/extension test      # vitest run
npx -y pnpm@9.15.0 --filter @sahamati/extension typecheck # tsc --noEmit
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `apps/extension/.output/chrome-mv3`.
4. Pin SahamatiCheck and click its toolbar icon. The **side panel** opens; there is no popup.

For live reload during development, run `npx -y pnpm@9.15.0 --filter @sahamati/extension dev`.
WXT opens a separate Chrome profile with the extension loaded.

## Demo

- **Backend running** (`http://localhost:8000`, see the root `CLAUDE.md`): open the side panel,
  click **Try the demo app** (or enter `in.example.chaiwallet`). The report comes from the API.
- **Backend down:** the side panel shows `packages/contracts/fixtures/report.sample.json`,
  labelled **Demo data**. The sample is a fabricated app and is never used to annotate a real
  Play page.
- **Policy highlighter:** open any privacy policy page, then press `Alt+Shift+S` (or click the
  toolbar icon and use **Policy → Analyse this page**). On-device preliminary highlights appear
  first. A bar on the page shows a preview of the text and asks before anything is sent to the server.
- **Play annotator:** on `play.google.com/store/apps/datasafety?id=…` (or `details?id=…`), seal
  markers appear next to the data-safety rows that have findings, once you have checked that app
  in the side panel. Clicking a marker opens the side panel on that finding.

The server address and language (English or Hindi) are set on the options page
(`chrome://extensions` → SahamatiCheck → Details → Extension options).

## Permissions

| Kind | Permissions | Why |
|---|---|---|
| Required | `storage`, `sidePanel`, `activeTab`, `scripting`, `alarms`, `offscreen` | report cache and receipts, the side panel, the user-triggered highlighter, job polling, the on-device classifier |
| Required host | `https://play.google.com/*` | the data-safety annotator |
| Optional | `notifications` | "report ready" notification (options page) |
| Optional | `contextMenus` | the "Analyse this privacy policy" right-click item (options page) |
| Optional host | `https://*/*` | opt-in auto-highlighting of policy pages (options page) |

The context menu is behind the optional `contextMenus` permission so the required set stays
exactly as CLAUDE.md rule 10 lists it. There is no analytics and no remote code. API requests use
`credentials: 'omit'`. Receipts never leave the device.

## Layout

```
entrypoints/
  background.ts          typed message router, API client, 24 h ETag cache (storage.local),
                         in-flight jobs (storage.session), 30 s alarm polling, badge,
                         optional context menu, toolbar → side panel
  play.content.ts        Play data-safety annotator (vocabulary-text anchoring, Shadow DOM markers)
  policy-highlighter.ts  unlisted script injected on a user gesture; CSS Custom Highlight API
  offscreen/             on-device preliminary classifier host
  sidepanel/             React: Report | Policy | Receipts
  options/               server address, language, optional permissions
components/              React components (FindingCard, TierBadge, ConfidenceMeter, …) + panel.css
lib/                     framework-free logic (api, reportService, anchoring, markers, textmap,
                         prelim, receipts, i18n, settings)
locales/{en,hi}.json     every UI string (checked by packages/i18n/check-wording.mjs)
public/_locales/         manifest name/description/command strings
tests/                   vitest (jsdom) + fixtures/play-datasafety.html (fabricated app)
```

## Notes and limits

- The preliminary classifier is a keyword/negation heuristic behind the same
  `PreliminaryClassifier` interface a future bundled transformers.js MiniLM will implement.
  No model is bundled. Its output only colours sentences and never produces findings.
- Data-safety anchoring matches the English Play vocabulary. On a Play page in another UI
  language no rows match and the annotator does nothing (the side panel still works).
- The Play annotator reads only the local report cache. Viewing a Play page sends nothing to the
  backend; the package name is sent only while the side panel is open on that app.
