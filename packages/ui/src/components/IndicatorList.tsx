import type { ReactNode } from "react";
import type { Finding, Indicator } from "@sahamati/contracts";
import { categoryI18nKey, dataTypeLabel, formatDate } from "@sahamati/i18n";
import { cx, getT, langAttr, type Locale } from "../util";
import { OntologyPath } from "./OntologyPath";
import { StatusBadge } from "./StatusBadge";

export interface IndicatorListProps {
  indicators: Indicator[];
  locale: Locale;
  /** To link an indicator to the finding that shares its group_id. */
  findings?: Finding[];
  labels?: Record<string, string>;
  id?: string;
  leading?: ReactNode;
  className?: string;
}

/**
 * "Worth a closer look": investigation rules. These are not differences and are
 * never counted in the report summary, so no count is shown in the heading.
 */
export function IndicatorList({ indicators, locale, findings, labels, id = "indicators", leading, className }: IndicatorListProps) {
  const t = getT(locale);
  return (
    <section id={id} className={cx("mu-ind", className)} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="mu-section-title">
        {leading}
        {t("indicators.title")}
      </h2>
      <p className="mu-ind__intro">{t("indicators.intro")}</p>
      {indicators.length ? (
        <ul className="mu-ind__list">
          {indicators.map((i) => {
            const rel = i.group_id ? findings?.find((f) => f.group_id === i.group_id) : undefined;
            const name = i.evidence.permission ?? i.evidence.sdk ?? i.evidence.label;
            return (
              <li key={i.id} id={`indicator-${i.id}`} className="mu-card mu-ind__item" data-indicator={i.id}>
                <div className="mu-ind__head">
                  <h3 className="mu-ind__title">{dataTypeLabel(t, i.data_type, labels)}</h3>
                  <span className="mu-ind__cat">{t(categoryI18nKey(i.user_category))}</span>
                  <StatusBadge status="needs_review" locale={locale} describe={false} />
                </div>
                <p className="mu-ind__summary" lang={langAttr(locale, i.summary)}>
                  {i.summary}
                </p>
                <OntologyPath path={i.ontology_path} locale={locale} labels={labels} />
                <p className="mu-ind__meta">
                  <span>{t(`source.${i.source}`)}</span>
                  {name ? <code>{name}</code> : null}
                  <span>{t("finding.captured", { date: formatDate(locale, i.evidence.captured_at) })}</span>
                  <code>{t("indicators.rule", { rule: i.rule_id })}</code>
                </p>
                {rel ? (
                  <p className="mu-ind__related">
                    {t("indicators.related")}:{" "}
                    <a href={`#finding-${rel.id}`}>
                      {t("indicators.relatedLink")} <code>{rel.rule_id}</code>
                    </a>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mu-empty">{t("indicators.none")}</p>
      )}
    </section>
  );
}
