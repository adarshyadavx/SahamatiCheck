// SahamatiCheck API contract (v1). Mirrors backend/core/sahamati_core/schema/*.py.
// Change both sides in the same commit.

export type SourceName = "policy" | "data_safety" | "apk";
export type Coverage = "ok" | "unavailable" | "unreachable" | "obfuscated" | "unparseable";
export type ConflictClass =
  | "internal_contradiction"
  | "declaration_mismatch"
  | "behavioural_mismatch";
export type Tier = "strong" | "indicative" | "not_mentioned";
export type Action = "collect" | "share" | "sell" | "use" | "retain";
export type Polarity = "affirm" | "deny" | "vague";

export interface ClaimTupleView {
  actor: string;
  action: Action;
  polarity: Polarity;
  data_type: string;
  condition?: string | null;
}

export interface Evidence {
  quote?: string;          // verbatim policy sentence
  label?: string;          // data-safety row label
  permission?: string;     // android permission
  sdk?: string;            // SDK package prefix
  url?: string;
  char_start?: number;
  char_end?: number;
  text_fragment?: string;  // "#:~:text=..."
  captured_at: string;     // ISO date
}

export interface FindingSide {
  source: "policy" | "data_safety" | "apk_permission" | "apk_sdk";
  tuple: ClaimTupleView;
  evidence: Evidence;
}

// Rule-level outcome (PLAN.md §4.9). `inconclusive` = a required source was missing; it is never a pass.
// `no_issue_detected` = "nothing found in the evidence we had", never "compliant".
export type Status =
  | "confirmed_conflict"
  | "potential_conflict"
  | "needs_review"
  | "inconclusive"
  | "no_issue_detected";
// How strong the weaker side of a finding is. `capability` (permission only) and `presence` (SDK only) cap a finding at potential_conflict.
export type EvidenceStrength = "declaration" | "code_path" | "presence" | "capability";
export type UserCategory =
  | "location" | "contacts" | "photos_files" | "camera_mic" | "messages_calls"
  | "money_payments" | "identity" | "health" | "ads_tracking" | "account_profile";
export type CardColor = "red" | "orange" | "yellow" | "grey" | "green";

export interface Finding {
  id: string;
  class: ConflictClass;
  tier: Exclude<Tier, "not_mentioned">;
  confidence: number;        // 0..1, calibrated
  rule_id: string;
  summary: string;           // neutral wording only
  ontology_path: string[];   // root → most specific overlap node
  sides: [FindingSide, FindingSide];
  benign_explanations: string[];
  status: Exclude<Status, "inconclusive" | "no_issue_detected">; // confirmed_conflict only when confidence >= confirm threshold and no ceiling applies
  evidence_strength: EvidenceStrength;
  limitations: string[];     // machine-generated: "permission_only", "sdk_presence_only", "runtime_not_observed", ...
  user_category: UserCategory;
  group_id?: string;         // findings describing one issue share a group_id; clients show the group once
  related_finding_ids?: string[];
}

// Investigation rules (D01..D12, T02, T08, A01): "worth a closer look", never a conflict, never counted in `summary`.
export interface Indicator {
  id: string;
  rule_id: string;           // registry id, e.g. "D01"
  status: "needs_review";
  user_category: UserCategory;
  data_type: string;
  ontology_path: string[];
  summary: string;           // neutral wording only
  source: "policy" | "data_safety" | "apk_permission" | "apk_sdk";
  evidence: Evidence;
  group_id?: string;
}

// One row per registry rule that was evaluated or could not be (the "Rules not evaluated" appendix).
// `rule_id` is the registry id (P05, P06, P07, P12, T01, D01, ...); findings keep their engine ids (DM-01, IC-01, BM-01).
export interface RuleRun {
  rule_id: string;
  name: string;
  family: "P" | "D" | "T" | "A" | "C" | "S" | "AI";
  phase: number;             // 1..3
  status: Status;
  reason?: string;           // required when inconclusive: runtime_evidence_unavailable, apk_unavailable, test_account_unavailable, ...
}

export interface CardCategory {
  id: UserCategory;
  color: CardColor;          // red only for confirmed_conflict; green only when every rule for the category ran
  status: Status;
  note: string;              // one neutral line; grey/green rows say what could not be checked
  finding_ids: string[];
  indicator_ids: string[];
}
export interface CardAnswer {
  id: "location" | "sharing" | "ads" | "deletion" | "grievance";
  text: string;
  finding_ids: string[];
}
// Per-category traffic light for ordinary users. Not a per-app score or grade (CLAUDE.md rule 3): there is no overall colour.
export interface ReportCard {
  categories: CardCategory[]; // always all 10, fixed order
  answers: CardAnswer[];      // always all 5
  checked_at: string;
}

export interface DisclosureGap {
  id: string;
  data_type: string;
  ontology_path: string[];
  evidence: Evidence;
  source: "apk_permission" | "apk_sdk";
}

export interface ReportSummary {
  strong: number;
  indicative: number;
  not_mentioned: number;
  agree_types: number;
  vague_claim_ratio: number;
}

export interface ClaimMatrixRow {
  data_type: string;
  ontology_path: string[];
  policy: "collects" | "shares" | "denies" | "vague" | "silent";
  data_safety: "collects" | "shares" | "denies" | "silent";
  apk: "evidence" | "silent" | "unknown";
  conflict_class?: ConflictClass | "disclosure_gap";
}

export interface Report {
  report_id: string;
  app: { package: string; version_code: number | null; title: string; developer?: string; is_demo: boolean };
  generated_at: string;
  coverage: Record<SourceName, Coverage>;
  summary: ReportSummary;
  findings: Finding[];
  disclosure_gaps: DisclosureGap[];
  matrix: ClaimMatrixRow[];
  indicators: Indicator[];
  rule_runs: RuleRun[];
  status_counts: Record<Status, number>; // over rule_runs
  card: ReportCard;
  versions: { engine: string; ontology: string; extractor: string };
}

export type JobStatus = "queued" | "running" | "done" | "error";
export interface Job {
  job_id: string;
  status: JobStatus;
  stage: string;
  progress: number;          // 0..1
  report_id?: string;
  error?: string;
}

// POST /v1/checks → 200 { report } | 202 { job_id, status_url, events_url }
export interface CheckRequest { package_name?: string; play_url?: string }
export type CheckResponse =
  | { kind: "report"; report: Report }
  | { kind: "job"; job_id: string; status_url: string; events_url: string };

export interface PolicySegment {
  char_start: number;
  char_end: number;
  text: string;
  tuples: ClaimTupleView[];
  vague: boolean;
  confidence: number;
}
export interface PolicySegmentsRequest { url: string; text: string; text_sha256: string; lang?: string }
export interface PolicySegmentsResponse { segments: PolicySegment[]; vague_claim_ratio: number }

export interface OntologyNode { id: string; label_en: string; label_hi: string; parents: string[]; kind: "data_type" | "actor" | "purpose" }
export interface Ontology { version: string; nodes: OntologyNode[] }

// GET /v1/reports/{report_id} → Report (404 if unknown/expired). Responses carry X-Robots-Tag: noindex + ETag; ?hl=hi re-renders summaries in Hindi.
// SSE GET /v1/jobs/{id}/events: named events `progress` (data: Job) … then exactly one `done` or `error`.
// Stages: queued, ingest_listing, fetch_policy, map_declaration, analyse_apk, extract_claims, detect_conflicts, snapshot_diff, done.

export interface FeedbackRequest { verdict?: "looks_wrong" | "helpful"; report_id?: string; comment?: string; client?: string }
export interface DisputeRequest { report_id: string; finding_id?: string; contact_email: string; message: string; verification_method?: string }
export interface DisputeResponse { dispute_id: string; status: "pending_verification"; acknowledge_within_hours: number }

// POST /v1/self-check → private report; still parses as a CheckResponse thanks to `kind`.
export interface SelfCheckResponse {
  kind: "report";
  report: Report;
  suppressed_findings: Finding[]; // below-threshold; shown only to the developer
  private: true;
  expires_at: string;
}

export interface PolicySnapshot { snapshot_id: string; captured_at: string; url: string; content_sha256: string; claim_count: number }
export interface PolicyChange {
  kind: "added" | "removed" | "polarity_flipped" | "broadened";
  actor: string; action: Action; data_type: string;
  before?: string | null; after?: string | null;
}
export interface PolicyHistory {
  package: string;
  snapshots: PolicySnapshot[];
  diffs: { from_snapshot: string; to_snapshot: string; silent: boolean; changes: PolicyChange[] }[];
}

export interface AuditAggregate {
  is_demo?: boolean;
  corpus_size: number;
  by_category: { category: string; apps: number; strong_rate: number; indicative_rate: number; gap_rate: number; vague_ratio: number }[];
  failure_rates: { policy_unreachable: number; apk_unparseable: number };
}

export const API_BASE_DEFAULT = "http://localhost:8000";
