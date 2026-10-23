import type { Status, UserCategory } from "@sahamati/contracts";
import { cx, getT, type Locale } from "../util";

export interface WhatCanIDoProps {
  category: UserCategory;
  status: Status;
  locale: Locale;
  /** Link to the rights page, when the host has one. */
  rightsHref?: string;
  className?: string;
}

function list(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** Static, non-accusatory next steps per category and status. Nothing here is computed from the report. */
export function WhatCanIDo({ category, status, locale, rightsHref, className }: WhatCanIDoProps) {
  const t = getT(locale);
  const byStatus = list(t.raw(`actions.status.${status}`));
  const byCategory = list(t.raw(`actions.category.${category}`));
  if (!byStatus.length && !byCategory.length) return null;
  return (
    <details className={cx("mu-act", className)}>
      <summary>{t("actions.title")}</summary>
      <div className="mu-act__body">
        {byStatus.length ? (
          <ul className="mu-act__list">
            {byStatus.map((x, i) => (
              <li key={`s${i}`}>{x}</li>
            ))}
          </ul>
        ) : null}
        {byCategory.length ? (
          <ul className="mu-act__list">
            {byCategory.map((x, i) => (
              <li key={`c${i}`}>{x}</li>
            ))}
          </ul>
        ) : null}
        {rightsHref ? (
          <p className="mu-act__rights">
            <a href={rightsHref}>{t("actions.rights")} →</a>
          </p>
        ) : null}
      </div>
    </details>
  );
}
