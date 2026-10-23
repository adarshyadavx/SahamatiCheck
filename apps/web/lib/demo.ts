import type { Ontology, OntologyNode, Report } from "@sahamati/contracts";
import sample from "@sahamati/contracts/fixtures/report.sample.json";
import en from "@sahamati/i18n/en.json";
import hi from "@sahamati/i18n/hi.json";
import type { AuditResponse } from "./api";

/** The committed contract fixture: the fabricated app "Chai Wallet". */
export const DEMO_REPORT = sample as unknown as Report;
export const DEMO_REPORT_ID = DEMO_REPORT.report_id;
export const DEMO_PACKAGE = DEMO_REPORT.app.package;

/**
 * Demo report ids the backend serves. When the API cannot be reached, these
 * (and only these) fall back to the committed Chai Wallet fixture.
 */
export const KNOWN_DEMO_IDS: readonly string[] = [DEMO_REPORT_ID, "r_demo_shopkart"];

export function isKnownDemoId(id: string): boolean {
  return KNOWN_DEMO_IDS.includes(id);
}

/** Fabricated aggregates, clearly flagged is_demo. Never real study results. */
export const DEMO_AUDIT: AuditResponse = {
  is_demo: true,
  corpus_size: 500,
  by_category: [
    { category: "Finance", apps: 74, strong_rate: 0.31, indicative_rate: 0.42, gap_rate: 0.58, vague_ratio: 0.29 },
    { category: "Shopping", apps: 61, strong_rate: 0.26, indicative_rate: 0.39, gap_rate: 0.61, vague_ratio: 0.34 },
    { category: "Health & fitness", apps: 48, strong_rate: 0.22, indicative_rate: 0.35, gap_rate: 0.52, vague_ratio: 0.31 },
    { category: "Education", apps: 66, strong_rate: 0.18, indicative_rate: 0.33, gap_rate: 0.47, vague_ratio: 0.37 },
    { category: "Social", apps: 52, strong_rate: 0.29, indicative_rate: 0.46, gap_rate: 0.63, vague_ratio: 0.33 },
    { category: "Food & drink", apps: 39, strong_rate: 0.2, indicative_rate: 0.31, gap_rate: 0.55, vague_ratio: 0.28 },
    { category: "Travel", apps: 44, strong_rate: 0.24, indicative_rate: 0.4, gap_rate: 0.6, vague_ratio: 0.3 },
    { category: "Tools", apps: 71, strong_rate: 0.14, indicative_rate: 0.37, gap_rate: 0.66, vague_ratio: 0.41 },
    { category: "Other (merged)", apps: 45, strong_rate: 0.17, indicative_rate: 0.3, gap_rate: 0.5, vague_ratio: 0.35 },
  ],
  failure_rates: { policy_unreachable: 0.07, apk_unparseable: 0.12 },
};

/** Data-type parents for the bundled ontology subset (labels come from the i18n catalogs). */
const DT_PARENTS: Record<string, string[]> = {
  personal_info: [],
  app_activity: [],
  identifiers: ["personal_info"],
  device_id: ["identifiers"],
  advertising_id: ["device_id"],
  android_id: ["device_id"],
  user_id: ["identifiers"],
  location: ["personal_info"],
  precise_location: ["location"],
  approximate_location: ["location"],
  contacts: ["personal_info"],
  contact_info: ["personal_info"],
  name: ["contact_info"],
  email: ["contact_info"],
  phone_number: ["contact_info"],
  address: ["contact_info"],
  financial_info: ["personal_info"],
  payment_info: ["financial_info"],
  purchase_history: ["financial_info"],
  credit_info: ["financial_info"],
  health_info: ["personal_info"],
  fitness_info: ["health_info"],
  photos_media: ["personal_info"],
  photos: ["photos_media"],
  videos: ["photos_media"],
  camera_media: ["photos_media"],
  audio: ["personal_info"],
  voice_recordings: ["audio"],
  microphone_audio: ["audio"],
  messages: ["personal_info"],
  sms: ["messages"],
  emails: ["messages"],
  files_docs: ["personal_info"],
  calendar: ["personal_info"],
  app_interactions: ["app_activity"],
  search_history: ["app_activity"],
  installed_apps: ["app_activity"],
  web_history: ["app_activity"],
  diagnostics: ["app_activity"],
  crash_logs: ["diagnostics"],
  performance_data: ["diagnostics"],
};

const ACTOR_PARENTS: Record<string, string[]> = {
  any_party: [],
  first_party: ["any_party"],
  third_party: ["any_party"],
  ad_network: ["third_party"],
  analytics_provider: ["third_party"],
  service_provider: ["third_party"],
  government: ["third_party"],
  affiliate: ["third_party"],
};

export const DEMO_ONTOLOGY: Ontology = (() => {
  const enDt = en.dt as Record<string, string>;
  const hiDt = hi.dt as Record<string, string>;
  const enAc = en.actor as Record<string, string>;
  const hiAc = hi.actor as Record<string, string>;
  const nodes: OntologyNode[] = [
    ...Object.entries(DT_PARENTS).map(([id, parents]) => ({
      id,
      parents,
      kind: "data_type" as const,
      label_en: enDt[id] ?? id,
      label_hi: hiDt[id] ?? enDt[id] ?? id,
    })),
    ...Object.entries(ACTOR_PARENTS).map(([id, parents]) => ({
      id,
      parents,
      kind: "actor" as const,
      label_en: enAc[id] ?? id,
      label_hi: hiAc[id] ?? id,
    })),
  ];
  return { version: "demo", nodes };
})();
