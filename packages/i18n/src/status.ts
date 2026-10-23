// Status / colour / category / limitation / reason -> i18n key helpers.
//
// Shared by the website and (later) the extension so both clients use the same
// catalog keys for the five report-card statuses. No analysis lives here: the
// status and colour always come from the report JSON; this module only names
// the label for a value the backend already chose.

export const STATUS_IDS = [
  "confirmed_conflict",
  "potential_conflict",
  "needs_review",
  "inconclusive",
  "no_issue_detected",
] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export const CARD_COLOR_IDS = ["red", "orange", "yellow", "grey", "green"] as const;
export type CardColorId = (typeof CARD_COLOR_IDS)[number];

export const CATEGORY_IDS = [
  "location",
  "contacts",
  "photos_files",
  "camera_mic",
  "messages_calls",
  "money_payments",
  "identity",
  "health",
  "ads_tracking",
  "account_profile",
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

/**
 * The fixed display pairing of status and colour (PLAN.md 4.9). It is a
 * presentation table, not a computation: red is reserved for confirmed_conflict.
 */
export const STATUS_COLOR: Readonly<Record<StatusId, CardColorId>> = {
  confirmed_conflict: "red",
  potential_conflict: "orange",
  needs_review: "yellow",
  inconclusive: "grey",
  no_issue_detected: "green",
};

export const COLOR_STATUS: Readonly<Record<CardColorId, StatusId>> = {
  red: "confirmed_conflict",
  orange: "potential_conflict",
  yellow: "needs_review",
  grey: "inconclusive",
  green: "no_issue_detected",
};

/** `status.confirmed_conflict` -> "Difference found". */
export const statusI18nKey = (status: StatusId): string => `status.${status}`;
/** `status.desc.confirmed_conflict` -> one-sentence meaning. */
export const statusDescI18nKey = (status: StatusId): string => `status.desc.${status}`;
/** Label for a card colour (the label of the status that colour stands for). */
export const colorI18nKey = (color: CardColorId): string => statusI18nKey(COLOR_STATUS[color]);
/** The colour's own name in words ("Red"), for assistive text. */
export const colorNameI18nKey = (color: CardColorId): string => `color.${color}`;
/** `card.category.location` -> "Location". */
export const categoryI18nKey = (id: CategoryId | string): string => `card.category.${id}`;
/** `card.answer.sharing` -> the question the answer responds to. */
export const answerI18nKey = (id: string): string => `card.answer.${id}`;

interface HasKey {
  has(key: string): boolean;
}

/** Key for a limitation code, with the generic fallback for unknown codes. */
export function limitationI18nKey(t: HasKey, code: string): string {
  return t.has(`limitation.${code}`) ? `limitation.${code}` : "limitation.generic";
}

/** Key for a rule-run reason code, with the generic fallback for unknown codes. */
export function reasonI18nKey(t: HasKey, code: string | null | undefined): string {
  return code && t.has(`reason.${code}`) ? `reason.${code}` : "reason.generic";
}

export function isStatusId(v: unknown): v is StatusId {
  return typeof v === "string" && (STATUS_IDS as readonly string[]).includes(v);
}
export function isCardColorId(v: unknown): v is CardColorId {
  return typeof v === "string" && (CARD_COLOR_IDS as readonly string[]).includes(v);
}
