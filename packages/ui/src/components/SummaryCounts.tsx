import type { ReportSummary } from "@sahamati/contracts";
import { formatNumber, formatPercent } from "@sahamati/i18n";
import { cx, getT, type Locale } from "../util";
import { Seal } from "./Seal";

export interface SummaryCountsProps {
  summary: ReportSummary;
  locale: Locale;
  className?: string;
}

/** Tier counts, agreement and vagueness. Deliberately no score or grade. */
export function SummaryCounts({ summary, locale, className }: SummaryCountsProps) {
  const t = getT(locale);
  const items = [
    { key: "agree", value: formatNumber(locale, summary.agree_types), mark: <Seal size={18} variant="filled" color="var(--agree)" /> },
    { key: "strong", value: formatNumber(locale, summary.strong), mark: <Seal size={18} variant="filled" color="var(--neel)" /> },
    { key: "indicative", value: formatNumber(locale, summary.indicative), mark: <Seal size={18} variant="outlined" color="var(--class-behaviour)" /> },
    { key: "not_mentioned", value: formatNumber(locale, summary.not_mentioned), mark: <Seal size={18} variant="dashed" color="var(--class-gap)" /> },
  ];
  return (
    <section className={cx("mu-summary", className)} aria-label={t("summary.title")}>
      <dl className="mu-summary__grid">
        {items.map((it) => (
          <div key={it.key} className={cx("mu-summary__item", `is-${it.key}`)}>
            <dt>
              {it.mark}
              <span>{t(`summary.${it.key}`)}</span>
            </dt>
            <dd>{it.value}</dd>
          </div>
        ))}
        <div className="mu-summary__item is-vague" title={t("summary.vagueHint")}>
          <dt>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
              <circle cx="9" cy="9" r="7" fill="none" stroke="var(--ink-muted)" strokeWidth="1.6" strokeDasharray="0.1 3.2" strokeLinecap="round" />
            </svg>
            <span>{t("summary.vague")}</span>
          </dt>
          <dd>{formatPercent(locale, summary.vague_claim_ratio)}</dd>
        </div>
      </dl>
      <p className="mu-summary__note">{t("summary.noScore")}</p>
    </section>
  );
}
