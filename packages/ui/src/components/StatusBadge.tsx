import type { CardColor, Status } from "@sahamati/contracts";
import {
  STATUS_COLOR,
  colorNameI18nKey,
  isCardColorId,
  statusDescI18nKey,
  statusI18nKey,
  type CardColorId,
} from "@sahamati/i18n";
import { cx, getT, type Locale } from "../util";

/** The fixed colour a status is drawn in. A presentation table, never a computation. */
export function statusColor(status: Status): CardColor {
  return STATUS_COLOR[status];
}

/**
 * One glyph per colour, so status never relies on colour alone:
 * red = filled octagon with "!", orange = triangle with "!", yellow = circle with "?",
 * grey = dashed circle with a bar, green = circle with a tick.
 */
export function StatusIcon({ color, size = 18, className }: { color: CardColorId; size?: number; className?: string }) {
  return (
    <svg
      className={cx("mu-status__icon", className)}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      data-icon={color}
    >
      {color === "red" && (
        <>
          <path d="M6.6 1.8h6.8l4.8 4.8v6.8l-4.8 4.8H6.6l-4.8-4.8V6.6z" fill="currentColor" />
          <path d="M10 5.6v5.6" stroke="var(--surface-raised)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="14" r="1.15" fill="var(--surface-raised)" />
        </>
      )}
      {color === "orange" && (
        <>
          <path d="M10 2.4L18.2 16.6H1.8z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M10 7.8v4.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="10" cy="14.3" r="1" fill="currentColor" />
        </>
      )}
      {color === "yellow" && (
        <>
          <circle cx="10" cy="10" r="7.8" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M7.8 8.1c.1-1.4 1.1-2.2 2.3-2.2 1.3 0 2.2.8 2.2 1.9 0 1.7-2.2 1.9-2.2 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="10.1" cy="14.2" r="1" fill="currentColor" />
        </>
      )}
      {color === "grey" && (
        <>
          <circle cx="10" cy="10" r="7.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.2 2.4" />
          <path d="M6.6 10h6.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {color === "green" && (
        <>
          <circle cx="10" cy="10" r="8" fill="currentColor" />
          <path d="M6 10.3l2.8 2.8 5.2-5.7" fill="none" stroke="var(--surface-raised)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export interface StatusBadgeProps {
  status: Status;
  /** Colour chosen by the backend (a card category). Defaults to the status's fixed colour. */
  color?: CardColor;
  locale: Locale;
  /** Show the one-line meaning as a tooltip. */
  describe?: boolean;
  /** Optional count shown after the label (rule-outcome summaries). */
  count?: number;
  className?: string;
}

/**
 * The five statuses as icon + colour + words (never colour alone).
 * Red is drawn only for `confirmed_conflict` when no explicit colour is passed.
 */
export function StatusBadge({ status, color, locale, describe = true, count, className }: StatusBadgeProps) {
  const t = getT(locale);
  const c: CardColorId = color && isCardColorId(color) ? color : STATUS_COLOR[status];
  const label = t(statusI18nKey(status));
  return (
    <span
      className={cx("mu-status", `mu-status--${c}`, className)}
      data-status={status}
      data-color={c}
      title={describe ? t(statusDescI18nKey(status)) : undefined}
    >
      <StatusIcon color={c} />
      <span className="mu-status__label">{label}</span>
      {count !== undefined ? <span className="mu-status__count">{count}</span> : null}
      <span className="mu-sr-only"> ({t(colorNameI18nKey(c))})</span>
    </span>
  );
}
