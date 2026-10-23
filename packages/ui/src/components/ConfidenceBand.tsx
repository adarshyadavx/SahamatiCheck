import { confidenceBand, cx, getT, type Locale } from "../util";

export interface ConfidenceBandProps {
  value: number;
  locale: Locale;
  className?: string;
}

const LEVEL = { weak: 1, moderate: 2, strong: 3 } as const;

/** Strong (>= 0.85), moderate or weak: three bars plus words. The raw value sits in the tooltip. */
export function ConfidenceBand({ value, locale, className }: ConfidenceBandProps) {
  const t = getT(locale);
  const band = confidenceBand(value);
  const level = LEVEL[band];
  const raw = value.toFixed(2);
  const word = t(`confidenceBand.${band}`);
  return (
    <span
      className={cx("mu-band", `mu-band--${band}`, className)}
      data-band={band}
      title={t("confidenceBand.title", { value: raw })}
    >
      <span className="mu-band__bars" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cx("mu-band__bar", i <= level && "is-on")} style={{ height: `${6 + i * 3}px` }} />
        ))}
      </span>
      <span className="mu-band__word">{word}</span>
      <span className="mu-sr-only"> ({raw})</span>
    </span>
  );
}
