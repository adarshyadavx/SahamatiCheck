"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { useId } from "react";
import type { DisclosureGap, Finding, ReportSummary } from "@sahamati/contracts";
import { formatNumber } from "@sahamati/i18n";
import { cx, getT, sealPath, triangleCounts, type EdgeId, type Locale } from "../util";

type Pt = { x: number; y: number };

const P: Pt = { x: 220, y: 122 };
const D: Pt = { x: 78, y: 330 };
const A: Pt = { x: 362, y: 330 };
const R = 30;
const C: Pt = { x: (P.x + D.x + A.x) / 3, y: (P.y + D.y + A.y) / 3 };

const NODE_PATH = (p: Pt) => sealPath(p.x, p.y, R, 16, 0.07);

function trim(a: Pt, b: Pt, pad = R + 7): [Pt, Pt] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return [
    { x: a.x + ux * pad, y: a.y + uy * pad },
    { x: b.x - ux * pad, y: b.y - uy * pad },
  ];
}
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const line = (a: Pt, b: Pt) => `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;

const LOOP = `M${P.x - 13} ${P.y - R + 3}C${P.x - 66} ${P.y - 118} ${P.x + 66} ${P.y - 118} ${P.x + 13} ${P.y - R + 3}`;
const LOOP_TOP: Pt = { x: P.x, y: P.y - 92 };
const HALO_R = R + 15;

type Tier = "strong" | "indicative" | "not_mentioned";

interface EdgeSpec {
  id: EdgeId;
  tier: Tier;
  color: string;
  d: string;
  pill: Pt;
}

const [pdA, pdB] = trim(P, D);
const [paA, paB] = trim(P, A);
const [daA, daB] = trim(D, A);

const EDGES: EdgeSpec[] = [
  { id: "pp", tier: "strong", color: "var(--class-internal)", d: LOOP, pill: LOOP_TOP },
  { id: "pd", tier: "strong", color: "var(--class-declaration)", d: line(pdA, pdB), pill: mid(pdA, pdB) },
  { id: "pa", tier: "indicative", color: "var(--class-behaviour)", d: line(paA, paB), pill: mid(paA, paB) },
  { id: "da", tier: "indicative", color: "var(--class-behaviour)", d: line(daA, daB), pill: mid(daA, daB) },
  {
    id: "gap",
    tier: "not_mentioned",
    color: "var(--class-gap)",
    d: `M${A.x} ${A.y - HALO_R}a${HALO_R} ${HALO_R} 0 1 1 -0.01 0Z`,
    pill: { x: A.x + HALO_R * 0.74, y: A.y - HALO_R * 0.74 },
  },
];

const DASH: Record<Tier, string | undefined> = { strong: undefined, indicative: "9 7", not_mentioned: "0.5 7" };

function strokeFor(count: number): number {
  return count === 0 ? 1.5 : Math.min(3 + (count - 1) * 2.5, 12);
}

export interface TriSourceTriangleProps {
  summary: ReportSummary;
  findings: Finding[];
  gaps: DisclosureGap[];
  locale: Locale;
  selected?: EdgeId | null;
  /** When set, edges become focusable buttons that filter the list. */
  onSelect?: (edge: EdgeId | null) => void;
  /** Gentle stamping and scanning animation (disabled by prefers-reduced-motion). */
  animated?: boolean;
  showLegend?: boolean;
  className?: string;
}

/**
 * The tri-source triangle. Vertices: Policy, Declaration (data safety), APK.
 * P–D carries declaration mismatches, P–A and D–A behavioural mismatches, the
 * loop on P internal contradictions, the halo on A disclosure gaps, and the
 * centre the number of data types on which all three agree.
 */
export function TriSourceTriangle({
  summary,
  findings,
  gaps,
  locale,
  selected = null,
  onSelect,
  animated = false,
  showLegend = true,
  className,
}: TriSourceTriangleProps) {
  const t = getT(locale);
  const uid = useId().replace(/:/g, "");
  const counts = triangleCounts(findings, gaps);
  const interactive = Boolean(onSelect);
  const label = (id: EdgeId) => t(`triangle.edge.${id}`);

  const toggle = (id: EdgeId) => onSelect?.(selected === id ? null : id);
  const onKey = (id: EdgeId) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(id);
    }
  };

  const summaryText = t("triangle.summary", {
    agree: formatNumber(locale, summary.agree_types),
    ic: counts.pp,
    dm: counts.pd,
    bmP: counts.pa,
    bmD: counts.da,
    gaps: counts.gap,
  });

  const vertices: Array<{ key: "policy" | "data_safety" | "apk"; p: Pt; delay: number }> = [
    { key: "policy", p: P, delay: 0 },
    { key: "data_safety", p: D, delay: 120 },
    { key: "apk", p: A, delay: 240 },
  ];

  const inner = [P, D, A].map((p) => ({ x: C.x + (p.x - C.x) * 0.42, y: C.y + (p.y - C.y) * 0.42 }));

  return (
    <figure className={cx("mu-tri", animated && "mu-tri--animated", selected && "has-selection", className)}>
      <svg
        className="mu-tri__svg"
        viewBox="0 0 440 400"
        role="group"
        aria-labelledby={`${uid}-title`}
        aria-describedby={`${uid}-desc`}
      >
        <title id={`${uid}-title`}>{t("triangle.title")}</title>

        {/* agreement field */}
        <path
          className="mu-tri__field"
          d={`M${inner[0]!.x} ${inner[0]!.y}L${inner[1]!.x} ${inner[1]!.y}L${inner[2]!.x} ${inner[2]!.y}Z`}
        />
        <g className="mu-tri__centre" aria-hidden="true">
          <text x={C.x} y={C.y + 4} textAnchor="middle" className="mu-tri__agree-n">
            {formatNumber(locale, summary.agree_types)}
          </text>
          <text x={C.x} y={C.y + 28} textAnchor="middle" className="mu-tri__agree-l">
            {t("triangle.agree")}
          </text>
        </g>

        {EDGES.map((e, i) => {
          const n = counts[e.id];
          const isSel = selected === e.id;
          const common = {
            className: cx("mu-tri__edge", `is-${e.tier}`, n === 0 && "is-zero", isSel && "is-selected"),
            style: { "--edge": e.color, "--d": `${300 + i * 110}ms` } as CSSProperties,
          };
          const body = (
            <>
              <path className="mu-tri__hit" d={e.d} />
              <path className="mu-tri__focus" d={e.d} />
              <path
                className="mu-tri__line"
                d={e.d}
                strokeWidth={strokeFor(n)}
                strokeDasharray={DASH[e.tier]}
              />
              {animated && n > 0 ? <path className="mu-tri__scan" d={e.d} pathLength={600} /> : null}
              <g className="mu-tri__pill" transform={`translate(${e.pill.x} ${e.pill.y})`}>
                <rect x={-15} y={-12} width={30} height={24} rx={12} />
                <text y={4.5} textAnchor="middle">
                  {n}
                </text>
              </g>
            </>
          );
          return interactive ? (
            <g
              key={e.id}
              {...common}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              aria-label={t("triangle.edgeButton", { label: label(e.id), count: n })}
              onClick={() => toggle(e.id)}
              onKeyDown={onKey(e.id)}
            >
              {body}
            </g>
          ) : (
            <g key={e.id} {...common} aria-hidden="true">
              {body}
            </g>
          );
        })}

        {vertices.map(({ key, p, delay }) => (
          <g
            key={key}
            className="mu-tri__node"
            style={{ "--d": `${delay}ms` } as CSSProperties}
            aria-hidden="true"
          >
            <path d={NODE_PATH(p)} className="mu-tri__seal" />
            <circle cx={p.x} cy={p.y} r={R - 8} className="mu-tri__seal-ring" />
            <text x={p.x} y={p.y + 7} textAnchor="middle" className="mu-tri__letter">
              {t(`source.short.${key}`)}
            </text>
          </g>
        ))}
        <g className="mu-tri__labels" aria-hidden="true">
          <text x={P.x + R + 22} y={P.y + 5} textAnchor="start">
            {t("source.policy")}
          </text>
          <text x={D.x} y={D.y + R + 30} textAnchor="middle">
            {t("source.data_safety")}
          </text>
          <text x={A.x} y={A.y + R + 30} textAnchor="middle">
            {t("source.apk")}
          </text>
        </g>
      </svg>

      <figcaption className="mu-tri__caption">
        <p id={`${uid}-desc`} className="mu-tri__summary">
          {summaryText}
        </p>
        {showLegend ? (
          <>
            <ul className="mu-tri__legend">
              {EDGES.map((e) => {
                const n = counts[e.id];
                const content = (
                  <>
                    <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true" focusable="false">
                      <path
                        d="M2 5h24"
                        stroke={e.color}
                        strokeWidth={e.tier === "not_mentioned" ? 3 : 2.6}
                        strokeDasharray={e.tier === "indicative" ? "6 4" : e.tier === "not_mentioned" ? "0.5 4.5" : undefined}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="mu-tri__legend-label">{label(e.id)}</span>
                    <span className="mu-count">{n}</span>
                  </>
                );
                return (
                  <li key={e.id}>
                    {interactive ? (
                      <button
                        type="button"
                        className={cx("mu-chip", selected === e.id && "is-on")}
                        aria-pressed={selected === e.id}
                        onClick={() => toggle(e.id)}
                      >
                        {content}
                      </button>
                    ) : (
                      <span className="mu-chip is-static">{content}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mu-tri__hint">
              {t("triangle.legend")} {interactive ? t("triangle.filterHint") : null}
            </p>
          </>
        ) : null}
      </figcaption>
    </figure>
  );
}
