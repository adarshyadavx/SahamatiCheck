import { formatDate } from "@sahamati/i18n";
import { cx, getT, type Locale } from "../util";

export interface DisclaimerProps {
  locale: Locale;
  generatedAt?: string;
  versionCode?: number | null;
  className?: string;
}

/** The fixed disclaimer every report carries. */
export function Disclaimer({ locale, generatedAt, versionCode, className }: DisclaimerProps) {
  const t = getT(locale);
  return (
    <aside className={cx("mu-disclaimer", className)} aria-label={t("disclaimer.title")}>
      <svg className="mu-disclaimer__icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 9v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="10" cy="6.2" r="1.1" fill="currentColor" />
      </svg>
      <div>
        <p className="mu-disclaimer__title">{t("disclaimer.title")}</p>
        <p className="mu-disclaimer__body">{t("disclaimer.body")}</p>
        {generatedAt ? (
          <p className="mu-disclaimer__snap">
            {t("disclaimer.snapshot", {
              version: versionCode ?? t("disclaimer.noVersion"),
              date: formatDate(locale, generatedAt),
            })}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

export type DemoReason = "fabricated" | "offline" | "auditDemo" | "ontologyDemo";

/** A visible "Demo data" banner. */
export function DemoBanner({ locale, reason, className }: { locale: Locale; reason: DemoReason; className?: string }) {
  const t = getT(locale);
  return (
    <div className={cx("mu-demo", className)} role="status">
      <span className="mu-demo__tag">{t("common.demo.label")}</span>
      <span className="mu-demo__text">{t(`common.demo.${reason}`)}</span>
    </div>
  );
}
