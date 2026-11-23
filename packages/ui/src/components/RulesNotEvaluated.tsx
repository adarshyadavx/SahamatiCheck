import type { ReactNode } from "react";
import type { RuleRun, Status } from "@sahamati/contracts";
import { STATUS_IDS, reasonI18nKey } from "@sahamati/i18n";
import { cx, getT, type Locale } from "../util";
import { StatusBadge } from "./StatusBadge";

export interface RulesNotEvaluatedProps {
  ruleRuns: RuleRun[];
  locale: Locale;
  id?: string;
  leading?: ReactNode;
  className?: string;
}

/** The appendix of rules that could not run, each with a plain-language reason. Inconclusive is never a pass. */
export function RulesNotEvaluated({ ruleRuns, locale, id = "rules-not-evaluated", leading, className }: RulesNotEvaluatedProps) {
  const t = getT(locale);
  const open = ruleRuns.filter((r) => r.status === "inconclusive");
  return (
    <section id={id} className={cx("mu-rne", className)} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="mu-section-title">
        {leading}
        {t("rulesNotEvaluated.title")}
        <span className="mu-count">{open.length}</span>
      </h2>
      <p className="mu-rne__intro">{t("rulesNotEvaluated.intro")}</p>
      {open.length ? (
        <details className="mu-rne__more">
          <summary>{t("rulesNotEvaluated.show", { n: open.length })}</summary>
          <ul className="mu-rne__list">
            {open.map((r) => (
              <li key={r.rule_id} className="mu-card mu-rne__item" data-rule={r.rule_id} data-reason={r.reason ?? ""}>
                <div className="mu-rne__head">
                  <code className="mu-rne__id">{r.rule_id}</code>
                  <h3 className="mu-rne__name">{r.name}</h3>
                  <StatusBadge status="inconclusive" locale={locale} describe={false} />
                </div>
                <p className="mu-rne__why">
                  <span className="mu-rne__why-label">{t("rulesNotEvaluated.why")}: </span>
                  {t(reasonI18nKey(t, r.reason))}
                </p>
                <p className="mu-rne__meta">{t("rulesNotEvaluated.meta", { family: r.family, phase: r.phase })}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="mu-empty">{t("rulesNotEvaluated.none")}</p>
      )}
    </section>
  );
}

export interface StatusCountsProps {
  counts: Record<Status, number>;
  locale: Locale;
  className?: string;
}

/** Rule-outcome tallies from `status_counts`. They count registry rules, not findings, and are not a score. */
export function StatusCounts({ counts, locale, className }: StatusCountsProps) {
  const t = getT(locale);
  return (
    <div className={cx("mu-sc", className)}>
      <p className="mu-sc__title">{t("statusCounts.title")}</p>
      <ul className="mu-sc__list">
        {STATUS_IDS.map((s) => (
          <li key={s}>
            <StatusBadge status={s} locale={locale} count={counts?.[s] ?? 0} />
          </li>
        ))}
      </ul>
      <p className="mu-sc__note">{t("statusCounts.note")}</p>
    </div>
  );
}
