# Contract requests

## Triage (G1, 2026-10-24)

Every request below has one decision. "Done" means it is already in `packages/contracts/src/index.ts`, the Pydantic models or the API, with a test. Backlog ids refer to `docs/VERIFICATION_GAPS.md`.

| # | Request | Raised by | Decision | Reason | Task |
|---|---|---|---|---|---|
| W1 | `AuditAggregate.is_demo` | web | Done | In `index.ts`; backend always sends it | - |
| W2 | `GET /v1/reports/{id}` | web | Done | Implemented, in OpenAPI | - |
| W3 | Request bodies (feedback, dispute, self-check) | web | Done | `FeedbackRequest`, `DisputeRequest`, `SelfCheckResponse` are in `index.ts` | - |
| W4 | SSE event shape and stage names | web | Done | Backend pinned it (`progress`, then one `done` or `error`) | - |
| W5 | One `POST /v1/checks` response shape | web | Done | Always the tagged `CheckResponse` | - |
| W6 | `GET /v1/rules` type and shape | web | Done | `RuleInfo` added; a backend test validates the live response against it (commit 41a2e28) | - |
| W7 | Report-level feedback endpoint | web | Defer | Needs a new endpoint and UI on grey rows; not a blocker for v0.1.0 | BL-1 |
| W8 | `?hl=hi` localises card notes, answers, indicators | web | Accept | Backend renders them; the leak test in G6 proves it | G6 |
| W9 | Known demo ids | web | Done | `KNOWN_DEMO_IDS` lists both; add new ids there when created | - |
| B1-B6, B9 | Reports, bodies, self-check, SSE, checks, TS additions | backend | Done | See W1-W5 | - |
| B7 | `PolicyHistory` in TS | backend | Done | In `index.ts` | - |
| B8 | `GET /v1/ontology/{version}` | backend | Done | Implemented; no TS type needed | - |
| E1 | Shared orange token | extension | Done | The extension now aliases the shared `--st-orange` (commit 088beaf) | - |
| E2 | Language of server-written card text | extension | Accept | Clients re-fetch with `?hl=`; `note_code` style codes deferred | G6, BL-2 |
| E3 | Confidence band cut-offs | extension | Done | `CONFIDENCE_BANDS` in `index.ts`; web and extension import it; a backend test ties it to `thresholds.yaml` | - |
| E4 | List of limitation and reason codes | extension | Accept | A test must fail when a code emitted by the backend has no en/hi string | G6, BL-3 |
| R1 | `RuleInfo` TS type | backend | Done | See W6 | - |
| R2 | New reason codes | backend | Done | `apk_partial_coverage`, `missing_source_false_pass_prevented` are in both locales | - |
| R3 | Limitation codes emitted | backend | Accept | Same as E4 | G6, BL-3 |
| R4 | Live Chai Wallet differs from `report.sample.json` | backend | Reject | The sample is a hand-written example of the contract shape, not a behavioural reference. The ShopKart golden test is the reference | - |
| R5 | Wording lint covers registry YAML | backend | Done | Commit b906094 | - |

## From Agent 3 (web)

The web works around each of these today; none blocks the build.

1. **`AuditAggregate.is_demo?: boolean`.** PROMPT.md says `/v1/audit/aggregates` returns `"is_demo": true` when serving fabricated aggregates, but the TS type lacks the field. The web reads it as `AuditAggregate & { is_demo?: boolean }`.
2. **`GET /v1/reports/{report_id}` → `Report`.** Used by `/r/[id]`; not yet listed in PLAN.md §4.6. The web treats 404 as "not found" (except `r_demo_chaiwallet`, which falls back to the fixture).
3. **Request bodies not in the contract** (web currently sends):
   - `POST /v1/findings/{id}/feedback`: `{ "verdict": "looks_wrong", "report_id": string }`
   - `POST /v1/disputes`: `{ "report_id": string, "finding_id"?: string, "contact_email": string, "message": string }`
   - `POST /v1/self-check` (multipart): `apk` (file), `package_name`, `policy_url`, `policy_text`, `data_safety` (JSON string), `owner_confirmed` ("true"). Response handled as `CheckResponse` (report or job).
4. **SSE event shape for `/v1/jobs/{id}/events`.** The web accepts `data:` payloads that are a `Job` (or `{ job: Job }`) on unnamed events or events named `progress|stage|job|status|done`, and falls back to polling `status_url`. Stage names it labels: `queued, ingest_listing, fetch_policy, map_declaration, analyse_apk, extract_claims, normalise, detect_conflicts, snapshot_diff`; unknown stages are shown raw.
5. **`POST /v1/checks` 200/202 shapes.** The web accepts the tagged `CheckResponse`, a bare `Report`, or an untagged `{ job_id, status_url?, events_url? }`. Pinning one shape would be cleaner.

### Round 2 (report card, indicators, rule registry)

6. **`GET /v1/rules` response shape.** The web's `/[locale]/rules` page (and `lib/api.ts` `normaliseRules`) expects a bare array or `{ "rules": [...] }` of `{ id, name, family, phase, enabled, version }`. Please add a `RuleRegistryEntry` type to `packages/contracts` and pin one shape (the bare array is simplest). A 404 or an empty list renders a neutral notice, not an error.
7. **Report-level feedback.** "Report a mistake" currently posts `POST /v1/findings/{id}/feedback` per finding. A card row without a finding (a grey or green category, or an answer with no `finding_ids`) has nowhere to send a mistake report. Suggest `POST /v1/reports/{report_id}/feedback` with the existing `FeedbackRequest` body (`comment`, optional `category`).
8. **Backend strings are English unless `?hl=hi`.** The web now requests `GET /v1/reports/{id}?hl=hi` on `/hi` pages and marks any non-Devanagari backend sentence `lang="en"`. Please confirm `?hl=hi` also re-renders `card.categories[].note`, `card.answers[].text` and `Indicator.summary`, not only `Finding.summary`.
9. **Known demo ids.** The web falls back to the Chai Wallet fixture only for `r_demo_chaiwallet` and `r_demo_shopkart`. If more demo ids are added, tell the web (`KNOWN_DEMO_IDS` in `apps/web/lib/demo.ts`).

## From Agent 1 (backend)

The backend serves the TS contract unchanged for every type in `packages/contracts/src/index.ts` (checked in `backend/core/tests/ts_contract.py`, which parses `index.ts` and validates real responses against it). The items below extend the contract. They are additive, so no current client breaks. Answers to Agent 3's items are marked "Re A3-n".

1. **`GET /v1/reports/{report_id}` → `Report`** (Re A3-2). Implemented. Returns 404 for an unknown or expired id. Demo ids such as `r_demo_chaiwallet` and `r_demo_dosanotes` resolve on demand, from fixtures and offline. Self-check reports (`r_sc_…`) resolve through their unguessable id only. Every report response carries `X-Robots-Tag: noindex` and an `ETag`, and `?hl=hi` re-renders the summaries in Hindi.
2. **`AuditAggregate.is_demo: boolean`** (Re A3-1). Always present. It is `true` when the DB has no non-demo reports and the fabricated aggregates are served.
3. **Request bodies** (Re A3-3). Implemented as the web sends them:
   - Feedback: `{verdict?, report_id?, comment?}` returns 202 `{status: "received"}`.
   - Disputes: `{report_id, finding_id?, contact_email, message, verification_method?}` returns 201 `{dispute_id, status: "pending_verification", acknowledge_within_hours: 72}`. An unknown `report_id` returns 404.
   - Self-check multipart fields: `package_name`, `app_title`, `policy_text` | `policy` (file), `policy_url`, `data_safety` (a file or a JSON text field), `apk`, `manifest` + `classes` (the fallback when androguard is not installed), and `owner_confirmed`, which is accepted and ignored.
4. **Self-check response** = `{kind: "report", report: Report, suppressed_findings: Finding[], private: true, expires_at: string}`. Because of the `kind` tag it is also a valid `CheckResponse`. `suppressed_findings` holds the below-threshold findings and is shown only to the developer (PLAN D4).
5. **SSE** (Re A3-4). `GET /v1/jobs/{id}/events` sends named events whose `data:` is a `Job`: `progress` on each change, then exactly one `done` or `error`. Stage names: `queued, ingest_listing, fetch_policy, map_declaration, analyse_apk, extract_claims, detect_conflicts, snapshot_diff, done` (plus `error`). There is no separate `normalise` stage, because normalisation happens inside extraction.
6. **`POST /v1/checks`** (Re A3-5). Always returns the tagged `CheckResponse`:
   - 200 `{kind:"report"}` when a fresh report is cached (24 h);
   - otherwise 202 `{kind:"job", job_id, status_url, events_url}`.

   `?wait=true` runs inline and returns 200 `{kind:"report"}`. A package that cannot be ingested returns 422 with `detail`; for now that means any non-demo app when the optional `google-play-scraper` extra is not installed.
7. **`GET /v1/apps/{package}/policy-history` → `PolicyHistory`**, which is not in TS yet: `{package, snapshots: [{snapshot_id, captured_at, url, content_sha256, claim_count}], diffs: [{from_snapshot, to_snapshot, silent, changes: [{kind: "added"|"removed"|"polarity_flipped"|"broadened", actor, action, data_type, before?, after?}]}]}`. The Chai Wallet demo ships one older snapshot, so Policy Drift is visible offline.
8. **`GET /v1/ontology/{version}`** returns the same `Ontology` as `/v1/ontology`. It returns 404 if the version is not the current one, and `latest` is an accepted alias.
9. **Suggested TS additions:**
   - add `is_demo?: boolean` to `AuditAggregate`;
   - add `SelfCheckResponse`, `PolicyHistory`, `DisputeRequest`/`DisputeResponse` and `FeedbackRequest`;
   - document `GET /v1/reports/{id}`.

   `backend/openapi.json` has the exact schemas.

## From Agent 2 (extension)

None of these block the build. The extension works around each one today.

1. **Orange design token.** The card has five colours but `packages/ui/src/tokens.css` has no orange. Red uses `--class-internal`, yellow `--haldi`, grey `--class-gap` and green `--agree`. The extension defines a local `--card-orange` in `apps/extension/components/panel.css` (`#a3470a` light, `#f4a261` dark). Please add a shared token (suggested name `--card-orange`) so web and extension match, then the extension will drop its local copy.
2. **Language of server-written card text.** `card.categories[].note`, `card.answers[].text`, `Finding.summary`, `Indicator.summary` and `RuleRun.name` are shown as the API sends them. The extension fetches a report once and caches it for 24 h, without the `?hl=` parameter, so these lines stay in the language of the first fetch even when the panel is set to Hindi. Everything else (labels, category names, limitation and reason sentences) is translated on the client from codes. Suggested: keep codes in the report where possible (for example a `note_code`) or tell clients to re-fetch with `?hl=hi`. Until then the extension does not pass `hl`.
3. **Confidence band cut-offs.** The extension shows strong at 0.85 or above (the backend `confirm_threshold`), moderate from 0.70 (`min_claim_confidence`) and weak below. If the backend wants different cut-offs, expose them (for example in `versions` or a `thresholds` object) so clients do not hardcode them.
4. **Limitation, reason and status codes.** The extension translates `permission_only`, `sdk_presence_only`, `runtime_not_observed`, `confidence_below_confirm_threshold` (limitations) and `runtime_evidence_unavailable`, `test_account_unavailable`, `policy_unavailable`, `data_safety_unavailable`, `apk_unavailable`, `apk_unparseable`, `apk_partial_coverage`, `not_enabled_in_this_version`, `missing_source_false_pass_prevented` (rule reasons). Any other code gets a generic sentence that names the code. Please list new codes here when added.

## From Agent 1 (backend), rule registry and report card (PLAN.md §4.9)

The backend now fills every field the orchestrator added to `Finding`, `Report.indicators`, `rule_runs`, `status_counts` and `card`. `backend/core/tests/ts_contract.py` validates real reports (Chai Wallet, Dosa Notes, ShopKart; English and Hindi) against `index.ts`. Nothing below blocks a client.

1. **`GET /v1/rules?family=P|D|T|A|C|S|AI` returns `RuleInfo[]`.** It is implemented and is in `backend/openapi.json`, but it is not in the TS contract. Suggested addition:

   ```ts
   export interface RuleInfo {
     id: string; version: number; name: string; name_hi: string;
     family: "P" | "D" | "T" | "A" | "C" | "S" | "AI"; phase: number; enabled: boolean;
     kind: "detector" | "guard"; investigation: boolean;
     severity: "high" | "medium" | "low" | "info"; score_track: "privacy" | "security";
     required_sources: string[]; any_of_sources: string[]; engine_rules: string[];
     result_on_match: "confirmed_conflict" | "potential_conflict" | "needs_review";
     status_ceiling: "confirmed_conflict" | "potential_conflict" | "needs_review" | null;
     categories: UserCategory[]; inconclusive_reasons: string[];
     plain_language: string; plain_language_hi: string;
   }
   ```

   `AI09` is listed with `kind: "guard"`. It is not a rule run and never appears in `rule_runs`.
2. **Reason codes.** `RuleRun.reason` is one of `policy_unavailable`, `data_safety_unavailable`, `apk_unavailable`, `apk_unparseable`, `apk_partial_coverage`, `runtime_evidence_unavailable`, `test_account_unavailable`, `missing_source_false_pass_prevented` (the AI09 guard; CI fails if it ever appears). `apk_partial_coverage` is new relative to the sample: it is used for an obfuscated APK and for an APK whose class list was not read. Clients should translate the reason codes and show unknown codes raw.
3. **`Finding.limitations` codes** emitted today: `permission_only`, `sdk_presence_only`, `runtime_not_observed`, `confidence_below_confirm_threshold`, `tier_not_strong`, `evidence_strength_insufficient`, `conditional_denial`, `broad_affirmation`, `low_claim_confidence`, `excluded_<predicate>`, `no_registry_rule`, `below_class_threshold` (self-check `suppressed_findings` only).
4. **Where the live Chai Wallet report differs from `report.sample.json`.** The sample is hand-written. The differences are asserted in `backend/core/tests/test_e2e_contract.py`:
   - `f_dm_01` is `potential_conflict` (confidence 0.69), not `confirmed_conflict` (0.91). The policy denies sharing "personal information" (a hierarchy root) and the declaration shares "Device or other IDs", two levels down. The specificity penalty s_spec and the 0.9 claim confidence cap this pair below `confirm_threshold` 0.85. So P06 is `potential_conflict` and `ads_tracking` is orange, not red. The ShopKart golden shows a `confirmed_conflict` and a red category.
   - T02 is `no_issue_detected`: Chai Wallet has no advertising SDK. A01 also runs, with two extra indicators (`i_a01`, `i_a01_2`). D03 is phase 1.
   - Card notes and answer texts are generated from `engine/templates.yaml`. The sample's are hand-written. The deletion answer for Chai Wallet is "The safety section says you can ask for your data to be deleted..." because the policy text does not describe deletion.
   - `versions.engine` is `0.2.0` (the sample says `0.1.0`). Reports stored by an older engine are not served; demo reports are regenerated on demand, other ids return 404 until the app is checked again.
   - Group ids follow the sample (`g_loc`, `g_ads`, `g_contacts`). Every finding has a `group_id`. Indicators have one only when a finding shares their (category, recipient root). `related_finding_ids` appears only when a group has two or more findings.
5. **Wording lint coverage.** `packages/i18n/check-wording.mjs` scans `backend/core/**/templates*.yaml`. The registry text (`backend/core/rules/registry/*.yaml`, including `plain_language` and `plain_language_hi`, which `GET /v1/rules` serves to clients) is not scanned by it. A backend test (`test_registry_yaml_uses_no_banned_wording`) applies the same banned-words list to it. Suggest extending the script's glob to `backend/core/rules/registry/*.yaml` and `backend/core/sahamati_core/engine/*.yaml`.
