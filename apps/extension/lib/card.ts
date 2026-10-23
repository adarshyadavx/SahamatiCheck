import { CONFIDENCE_BANDS, type CardCategory, type Finding, type Indicator, type Report } from '@sahamati/contracts';
import { hasKey, type MessageKey, type Translator } from './i18n';

/**
 * Display helpers for the report card. Everything here only groups, orders and
 * labels what the API already decided: status, colour and the card come from the
 * backend (CLAUDE.md rules 5, 12, 15). Nothing derives a status, a colour or a grade.
 */

/** Presentation bands for the confidence number. Strong matches the backend's confirm threshold. */
export const CONFIDENCE_STRONG: number = CONFIDENCE_BANDS.strong_min;
export const CONFIDENCE_MODERATE: number = CONFIDENCE_BANDS.moderate_min;
export type ConfidenceBand = 'strong' | 'moderate' | 'weak';

export function confidenceBand(value: number): ConfidenceBand {
  if (value >= CONFIDENCE_STRONG) return 'strong';
  if (value >= CONFIDENCE_MODERATE) return 'moderate';
  return 'weak';
}

export type FindingStatus = Finding['status'];

const RANK: Record<FindingStatus, number> = { confirmed_conflict: 0, potential_conflict: 1, needs_review: 2 };

/**
 * A finding's status. A report cached before the status field existed has none; that
 * is shown as "needs a closer look", never as a difference.
 */
export function findingStatus(f: Pick<Finding, 'status'>): FindingStatus {
  return f.status && f.status in RANK ? f.status : 'needs_review';
}

/** The most serious status among findings, for ordering and for the in-page marker. */
export function topStatus(findings: Pick<Finding, 'status'>[]): FindingStatus {
  return findings.map(findingStatus).sort((a, b) => RANK[a] - RANK[b])[0] ?? 'needs_review';
}

/** True for a report that carries the 10-row card (older cached copies do not). */
export function hasCard(report: Report): boolean {
  return Array.isArray(report.card?.categories) && report.card.categories.length > 0;
}

export interface FindingGroup {
  /** Shown first, at full size. */
  primary: Finding;
  /** Shown nested under the primary, once. */
  related: Finding[];
}

/** Group findings that share a group_id (or list each other in related_finding_ids). Each finding appears once. */
export function groupFindings(findings: Finding[]): FindingGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  };
  for (const f of findings) parent.set(f.id, f.id);
  const byGroup = new Map<string, string>();
  for (const f of findings) {
    if (f.group_id) {
      const seen = byGroup.get(f.group_id);
      if (seen) union(f.id, seen);
      else byGroup.set(f.group_id, f.id);
    }
    for (const r of f.related_finding_ids ?? []) union(f.id, r);
  }
  const order = new Map(findings.map((f, i) => [f.id, i]));
  const buckets = new Map<string, Finding[]>();
  for (const f of findings) {
    const root = find(f.id);
    buckets.set(root, [...(buckets.get(root) ?? []), f]);
  }
  const groups = [...buckets.values()].map((members) => {
    const sorted = [...members].sort(
      (a, b) => RANK[findingStatus(a)] - RANK[findingStatus(b)] || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
    return { primary: sorted[0], related: sorted.slice(1) };
  });
  return groups.sort(
    (a, b) =>
      RANK[findingStatus(a.primary)] - RANK[findingStatus(b.primary)] ||
      (order.get(a.primary.id) ?? 0) - (order.get(b.primary.id) ?? 0),
  );
}

/** The findings behind a card row, plus group mates from elsewhere in the report. */
export function findingsForCategory(report: Report, cat: CardCategory): Finding[] {
  const listed = new Set(cat.finding_ids);
  const all = report.findings ?? [];
  const groups = new Set(all.filter((f) => listed.has(f.id) && f.group_id).map((f) => f.group_id as string));
  const related = new Set(all.filter((f) => listed.has(f.id)).flatMap((f) => f.related_finding_ids ?? []));
  return all.filter((f) => listed.has(f.id) || (f.group_id && groups.has(f.group_id)) || related.has(f.id));
}

export function indicatorsForCategory(report: Report, cat: CardCategory): Indicator[] {
  const ids = new Set(cat.indicator_ids);
  return (report.indicators ?? []).filter((i) => ids.has(i.id));
}

/** Findings that no card row shows (a safety net so nothing in the report is silently dropped). */
export function unplacedFindings(report: Report): Finding[] {
  const placed = new Set<string>();
  for (const cat of report.card?.categories ?? []) for (const f of findingsForCategory(report, cat)) placed.add(f.id);
  return (report.findings ?? []).filter((f) => !placed.has(f.id));
}

/** Indicators that no card row lists. */
export function unplacedIndicators(report: Report): Indicator[] {
  const placed = new Set((report.card?.categories ?? []).flatMap((c) => c.indicator_ids));
  return (report.indicators ?? []).filter((i) => !placed.has(i.id));
}

/** The row that shows a given finding, or null. */
export function categoryOfFinding(report: Report, findingId: string): CardCategory | null {
  return (
    (report.card?.categories ?? []).find((c) => findingsForCategory(report, c).some((f) => f.id === findingId)) ?? null
  );
}

/** Text for a machine limitation code; unknown codes get a generic sentence that still names the code. */
export function limitationText(t: Translator, code: string): string {
  const key = `limitation.${code}`;
  return hasKey(key) ? t(key) : t('limitation.unknown', { code });
}

/** Human sentence for a rule_run reason code. */
export function reasonText(t: Translator, code: string | undefined): string {
  if (!code) return t('reason.missing');
  const key = `reason.${code}`;
  return hasKey(key) ? t(key) : t('reason.unknown', { code });
}

export function statusKey(status: string): MessageKey {
  return (hasKey(`status.${status}`) ? `status.${status}` : 'status.needs_review') as MessageKey;
}
