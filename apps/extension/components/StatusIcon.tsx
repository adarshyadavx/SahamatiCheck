import type { CardColor } from '@sahamati/contracts';

/**
 * One distinct shape per card colour, so colour is never the only signal:
 * red = filled seal with "!", orange = triangle, yellow = circle with "?",
 * grey = dashed circle with a dash (could not check), green = magnifier (looked, found nothing).
 * The green icon is deliberately not a tick: "no issue found" is not "safe".
 */
export const COLOR_VAR: Record<CardColor, string> = {
  red: 'var(--class-internal)',
  orange: 'var(--card-orange)',
  yellow: 'var(--haldi)',
  grey: 'var(--class-gap)',
  green: 'var(--agree)',
};

const SEAL =
  'M10 1.5l2.1 1.6 2.6-.3 1 2.4 2.4 1-.3 2.6L19.4 11l-1.6 2.1.3 2.6-2.4 1-1 2.4-2.6-.3L10 20.4l-2.1-1.6-2.6.3-1-2.4-2.4-1 .3-2.6L.6 11l1.6-2.1-.3-2.6 2.4-1 1-2.4 2.6.3z';

export function StatusIcon({ color, size = 24 }: { color: CardColor; size?: number }) {
  const c = COLOR_VAR[color];
  return (
    <svg
      className={`status-icon status-icon-${color}`}
      viewBox="0 0 20 22"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {color === 'red' && (
        <>
          <path d={SEAL} fill={c} stroke={c} strokeWidth={1.4} />
          <path d="M10 6.2v5.2M10 13.6v.4" stroke="var(--surface-raised)" strokeWidth={2} strokeLinecap="round" fill="none" />
        </>
      )}
      {color === 'orange' && (
        <>
          <path d="M10 2.5L19 18.5H1z" fill="none" stroke={c} strokeWidth={1.8} strokeLinejoin="round" />
          <path d="M10 8v5M10 15.2v.4" stroke={c} strokeWidth={2} strokeLinecap="round" fill="none" />
        </>
      )}
      {color === 'yellow' && (
        <>
          <circle cx="10" cy="11" r="8" fill="none" stroke={c} strokeWidth={1.8} />
          <path d="M7.9 8.6a2.2 2.2 0 114 1.3c-.9.7-1.7 1.1-1.7 2.2M10 14.3v.4" stroke="var(--ink)" strokeWidth={1.7} strokeLinecap="round" fill="none" />
        </>
      )}
      {color === 'grey' && (
        <>
          <circle cx="10" cy="11" r="8" fill="none" stroke={c} strokeWidth={1.8} strokeDasharray="3 2.4" />
          <path d="M6.5 11h7" stroke={c} strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      {color === 'green' && (
        <>
          <circle cx="8.6" cy="9.6" r="5.6" fill="none" stroke={c} strokeWidth={1.8} />
          <path d="M12.8 13.8l5 5" stroke={c} strokeWidth={2.2} strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
