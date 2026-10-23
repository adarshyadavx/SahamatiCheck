"use client";

import { useEffect, useState } from "react";
import { createT, formatNumber, formatPercent, type Locale } from "@sahamati/i18n";
import { DemoBanner } from "@sahamati/ui";
import { getAudit, type AuditResponse } from "@/lib/api";
import { DEMO_AUDIT } from "@/lib/demo";

type SeriesKey = "strong_rate" | "indicative_rate" | "gap_rate";
const SERIES: Array<{ key: SeriesKey; label: "strong" | "indicative" | "gap"; color: string }> = [
  { key: "strong_rate", label: "strong", color: "var(--chart-1)" },
  { key: "indicative_rate", label: "indicative", color: "var(--chart-2)" },
  { key: "gap_rate", label: "gap", color: "var(--chart-3)" },
];

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: Array<{ label: string; value: string; color: string }>;
}

function niceMax(v: number): number {
  return Math.min(1, Math.max(0.1, Math.ceil(v * 10) / 10));
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[11rem] rounded-lg border border-line bg-surface-raised px-3 py-2 text-xs shadow-2"
      style={{ left: tip.x, top: tip.y, transform: "translate(-50%, calc(-100% - 10px))" }}
      role="presentation"
    >
      <p className="mb-1 font-semibold text-ink">{tip.title}</p>
      {tip.rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: r.color }} />
            {r.label}
          </span>
          <span className="font-mono text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Grouped horizontal bars: one group per category, one thin bar per tier. */
function RatesChart({ data, locale }: { data: AuditResponse; locale: Locale }) {
  const t = createT(locale);
  const [tip, setTip] = useState<Tip | null>(null);
  const rows = data.by_category;
  const max = niceMax(Math.max(...rows.flatMap((r) => SERIES.map((s) => r[s.key]))));
  const W = 640;
  const LABEL = 150;
  const PLOT = W - LABEL - 16;
  const BAR = 8;
  const GAP = 2;
  const GROUP = SERIES.length * (BAR + GAP) + 16;
  const H = rows.length * GROUP + 28;
  const ticks = Array.from({ length: Math.round(max * 10) + 1 }, (_, i) => i / 10).filter((v, i, a) => a.length <= 6 || i % 2 === 0);
  const x = (v: number) => LABEL + (v / max) * PLOT;

  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t("audit.byCategory")}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={0} y2={H - 22} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={x(v)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--ink-muted)" fontFamily="var(--font-mono)">
              {formatPercent(locale, v)}
            </text>
          </g>
        ))}
        {rows.map((r, gi) => {
          const y0 = gi * GROUP + 6;
          const tipFor = (cx: number, cy: number): Tip => ({
            x: (cx / W) * 100,
            y: cy,
            title: `${r.category} · ${formatNumber(locale, r.apps)} ${t("audit.apps")}`,
            rows: SERIES.map((s) => ({ label: t(`audit.series.${s.label}`), value: formatPercent(locale, r[s.key]), color: s.color })),
          });
          return (
            <g key={r.category}>
              <text x={LABEL - 10} y={y0 + (SERIES.length * (BAR + GAP)) / 2 + 3} textAnchor="end" fontSize={12.5} fill="var(--ink)">
                {r.category}
              </text>
              {SERIES.map((s, si) => {
                const y = y0 + si * (BAR + GAP);
                const w = Math.max(2, x(r[s.key]) - LABEL);
                return (
                  <path
                    key={s.key}
                    // 4px rounded data-end, square at the baseline
                    d={`M${LABEL} ${y}h${Math.max(0, w - 4)}a4 4 0 0 1 4 4a4 4 0 0 1 -4 4h${-Math.max(0, w - 4)}z`}
                    fill={s.color}
                  />
                );
              })}
              {/* hit target bigger than the marks */}
              <rect
                x={0}
                y={y0 - 5}
                width={W}
                height={GROUP - 6}
                fill="transparent"
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  const px = Math.min(Math.max(e.clientX - box.left, 90), box.width - 90);
                  setTip({ ...tipFor(0, 0), x: px, y: (y0 / H) * box.height });
                }}
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function VagueChart({ data, locale }: { data: AuditResponse; locale: Locale }) {
  const rows = [...data.by_category].sort((a, b) => b.vague_ratio - a.vague_ratio);
  const max = niceMax(Math.max(...rows.map((r) => r.vague_ratio)));
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.category} className="grid grid-cols-[minmax(6rem,9rem)_1fr_3.5rem] items-center gap-3 text-sm">
          <span className="truncate text-ink">{r.category}</span>
          <span className="h-2 rounded-r bg-surface-sunken">
            <span className="block h-2 rounded-r" style={{ width: `${(r.vague_ratio / max) * 100}%`, background: "var(--chart-1)" }} />
          </span>
          <span className="text-right font-mono text-xs text-ink-muted">{formatPercent(locale, r.vague_ratio)}</span>
        </li>
      ))}
    </ul>
  );
}

export function AuditView({ locale }: { locale: Locale }) {
  const t = createT(locale);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let live = true;
    getAudit()
      .then((d) => live && setData(d))
      .catch(() => {
        if (!live) return;
        setOffline(true);
        setData(DEMO_AUDIT);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!data) return <p className="text-ink-muted" role="status">{t("common.loading")}</p>;

  return (
    <div className="grid gap-10 [&>*]:min-w-0">
      {data.is_demo || offline ? (
        <div className="grid gap-2">
          <DemoBanner locale={locale} reason="auditDemo" />
          {offline ? <p className="text-xs text-ink-muted">{t("audit.loadFailed")}</p> : null}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          [t("audit.corpus"), formatNumber(locale, data.corpus_size)],
          [t("audit.categories"), formatNumber(locale, data.by_category.length)],
          [t("audit.policyUnreachable"), formatPercent(locale, data.failure_rates.policy_unreachable)],
          [t("audit.apkUnparseable"), formatPercent(locale, data.failure_rates.apk_unparseable)],
        ].map(([k, v]) => (
          <div key={k} className="panel p-4">
            <dt className="text-xs text-ink-muted">{k}</dt>
            <dd className="mt-1 font-display text-3xl font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="panel p-5 sm:p-6" aria-labelledby="rates-h">
        <h2 id="rates-h" className="text-xl font-semibold">
          {t("audit.byCategory")}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{t("audit.byCategoryDesc")}</p>
        <ul className="mt-4 flex flex-wrap gap-4 text-sm" aria-label={t("matrix.legend")}>
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-ink">
              <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
              {t(`audit.series.${s.label}`)}
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <RatesChart data={data} locale={locale} />
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-neel">{t("audit.table")}</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="py-2 pr-3">{t("audit.category")}</th>
                  <th scope="col" className="py-2 pr-3 text-right">{t("audit.apps")}</th>
                  {SERIES.map((s) => (
                    <th key={s.key} scope="col" className="py-2 pr-3 text-right">{t(`audit.series.${s.label}`)}</th>
                  ))}
                  <th scope="col" className="py-2 text-right">{t("summary.vague")}</th>
                </tr>
              </thead>
              <tbody>
                {data.by_category.map((r) => (
                  <tr key={r.category} className="border-b border-line">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">{r.category}</th>
                    <td className="py-2 pr-3 text-right font-mono">{formatNumber(locale, r.apps)}</td>
                    {SERIES.map((s) => (
                      <td key={s.key} className="py-2 pr-3 text-right font-mono">{formatPercent(locale, r[s.key])}</td>
                    ))}
                    <td className="py-2 text-right font-mono">{formatPercent(locale, r.vague_ratio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-5 sm:p-6" aria-labelledby="vague-h">
          <h2 id="vague-h" className="text-xl font-semibold">{t("audit.vagueTitle")}</h2>
          <p className="mb-4 mt-1 text-sm text-ink-muted">{t("audit.vagueDesc")}</p>
          <VagueChart data={data} locale={locale} />
        </section>
        <section className="panel p-5 sm:p-6" aria-labelledby="fail-h">
          <h2 id="fail-h" className="text-xl font-semibold">{t("audit.failuresTitle")}</h2>
          <p className="mb-4 mt-1 text-sm text-ink-muted">{t("audit.failuresDesc")}</p>
          <dl className="grid gap-4">
            {[
              [t("audit.policyUnreachable"), data.failure_rates.policy_unreachable],
              [t("audit.apkUnparseable"), data.failure_rates.apk_unparseable],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="flex justify-between text-sm">
                  <span>{k as string}</span>
                  <span className="font-mono text-ink-muted">{formatPercent(locale, v as number)}</span>
                </dt>
                <dd className="mt-1.5 h-2 rounded-r bg-surface-sunken">
                  <span className="block h-2 rounded-r bg-ink-muted" style={{ width: `${(v as number) * 100}%` }} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
