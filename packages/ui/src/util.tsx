import { CONFIDENCE_BANDS } from "@sahamati/contracts";
import type { ReactNode } from "react";
import type { DisclosureGap, Finding } from "@sahamati/contracts";
import { contentLang, createT, type Locale, type Translator } from "@sahamati/i18n";

export type { Locale, Translator };
export const getT = (locale: Locale): Translator => createT(locale);

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Scalloped seal outline (the Mudra motif) as an SVG path. */
export function sealPath(cx: number, cy: number, r: number, bumps = 14, depth = 0.07): string {
  const steps = bumps * 10;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r * (1 - depth * (0.5 - 0.5 * Math.cos(bumps * a)));
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

/** Triangle edges: pp = self-loop on P, pd = P–D, pa = P–A, da = D–A, gap = halo on A. */
export type EdgeId = "pp" | "pd" | "pa" | "da" | "gap";
export const EDGE_IDS: EdgeId[] = ["pp", "pd", "pa", "da", "gap"];

export function edgeOfFinding(f: Finding): Exclude<EdgeId, "gap"> {
  if (f.class === "internal_contradiction") return "pp";
  if (f.class === "declaration_mismatch") return "pd";
  const written = f.sides.find((s) => s.source === "policy" || s.source === "data_safety");
  return written?.source === "policy" ? "pa" : "da";
}

export type EdgeCounts = Record<EdgeId, number>;

export function triangleCounts(findings: Finding[], gaps: DisclosureGap[]): EdgeCounts {
  const c: EdgeCounts = { pp: 0, pd: 0, pa: 0, da: 0, gap: gaps.length };
  for (const f of findings) c[edgeOfFinding(f)]++;
  return c;
}

/** Group key for the claim matrix: the first ancestor below the root. */
export function groupOf(path: string[]): string {
  if (path.length > 2) return path[1]!;
  return path[0] ?? "other";
}

/** Map a 0..1 confidence to one of five levels (1..5). */
export function confidenceLevel(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return Math.min(5, Math.floor(v * 5) + 1);
}

/** Render a "{name}" template with React nodes in place of the variables. */
export function richTemplate(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(template))) {
    if (m.index > last) out.push(template.slice(last, m.index));
    const key = m[1]!;
    const node = Object.prototype.hasOwnProperty.call(nodes, key) ? nodes[key] : m[0];
    out.push(typeof node === "string" ? node : <span key={`rt-${i++}`}>{node}</span>);
    last = re.lastIndex;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}

/**
 * `lang` attribute for a backend-supplied sentence, only when it differs from
 * the page language (backend notes may still be English on a Hindi page).
 */
export function langAttr(locale: Locale, text: string): Locale | undefined {
  const l = contentLang(text);
  return l === locale ? undefined : l;
}

/** Display-only bands for a calibrated confidence value. The engine's own thresholds stay in the backend. */
export type ConfidenceBandId = "strong" | "moderate" | "weak";
export const CONFIDENCE_STRONG_MIN: number = CONFIDENCE_BANDS.strong_min;
export const CONFIDENCE_MODERATE_MIN: number = CONFIDENCE_BANDS.moderate_min;

export function confidenceBand(value: number): ConfidenceBandId {
  if (value >= CONFIDENCE_STRONG_MIN) return "strong";
  if (value >= CONFIDENCE_MODERATE_MIN) return "moderate";
  return "weak";
}

export interface FindingGroup {
  primary: Finding;
  related: Finding[];
}

/**
 * Arrange findings that share a `group_id` (or list each other in
 * `related_finding_ids`) so a group is shown once, with the related findings
 * nested under one primary. Pure arrangement of backend data: it never changes
 * a finding's status, tier or confidence. Input order is kept (by the first
 * member of each group).
 */
export function groupFindings(findings: Finding[]): FindingGroup[] {
  const out: FindingGroup[] = [];
  const seen = new Set<string>();
  findings.forEach((f) => {
    if (seen.has(f.id)) return;
    const members = findings.filter(
      (g) =>
        !seen.has(g.id) &&
        (g.id === f.id ||
          (f.group_id !== undefined && g.group_id === f.group_id) ||
          Boolean(f.related_finding_ids?.includes(g.id)) ||
          Boolean(g.related_finding_ids?.includes(f.id))),
    );
    const rank = (m: Finding) => [m.tier === "strong" ? 0 : 1, m.related_finding_ids?.length ? 0 : 1, findings.indexOf(m)] as const;
    const primary = [...members].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    })[0]!;
    members.forEach((m) => seen.add(m.id));
    out.push({ primary, related: members.filter((m) => m !== primary) });
  });
  return out;
}
