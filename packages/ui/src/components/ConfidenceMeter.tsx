import { confidenceLevel, cx, getT, type Locale } from "../util";

export interface ConfidenceMeterProps {
  value: number;
  locale: Locale;
  className?: string;
  /** Hide the word label (it stays available to assistive tech). */
  compact?: boolean;
}

/** Five segments plus a word label. The raw calibrated value is in the title. */
export function ConfidenceMeter({ value, locale, className, compact = false }: ConfidenceMeterProps) {
  const t = getT(locale);
  const level = confidenceLevel(value);
  const levels = t.raw<string[]>("confidence.levels");
  const word = levels[level - 1] ?? "";
  const raw = value.toFixed(2);
  return (
    <span
      className={cx("mu-meter", className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(raw)}
      aria-valuetext={`${t("confidence.label")}: ${word} (${raw})`}
      title={t("confidence.title", { value: raw })}
    >
      <span className="mu-meter__label" aria-hidden="true">
        {t("confidence.label")}
      </span>
      <span className="mu-meter__bar" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cx("mu-meter__seg", i <= level && "is-on")} />
        ))}
      </span>
      <span className={cx("mu-meter__word", compact && "mu-sr-only")} aria-hidden="true">
        {word}
      </span>
    </span>
  );
}
