import { limitationI18nKey } from "@sahamati/i18n";
import { cx, getT, type Locale } from "../util";

export interface LimitationsListProps {
  limitations: string[] | undefined;
  locale: Locale;
  className?: string;
}

/** Machine limitation codes as plain sentences. Unknown codes fall back to a generic sentence. */
export function LimitationsList({ limitations, locale, className }: LimitationsListProps) {
  const t = getT(locale);
  if (!limitations || limitations.length === 0) return null;
  return (
    <div className={cx("mu-lim", className)}>
      <p className="mu-lim__title">{t("limitation.title")}</p>
      <ul className="mu-lim__list">
        {limitations.map((code, i) => (
          <li key={`${code}-${i}`} data-limitation={code}>
            {t(limitationI18nKey(t, code))}
          </li>
        ))}
      </ul>
    </div>
  );
}
