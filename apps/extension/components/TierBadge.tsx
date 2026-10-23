import type { ConflictClass, Tier } from '@sahamati/contracts';
import { useI18n } from './I18n';

export const CLASS_VAR: Record<ConflictClass | 'disclosure_gap', string> = {
  internal_contradiction: 'var(--class-internal)',
  declaration_mismatch: 'var(--class-declaration)',
  behavioural_mismatch: 'var(--class-behaviour)',
  disclosure_gap: 'var(--class-gap)',
};

const SEAL =
  'M10 1.5l2.1 1.6 2.6-.3 1 2.4 2.4 1-.3 2.6L19.4 11l-1.6 2.1.3 2.6-2.4 1-1 2.4-2.6-.3L10 20.4l-2.1-1.6-2.6.3-1-2.4-2.4-1 .3-2.6L.6 11l1.6-2.1-.3-2.6 2.4-1 1-2.4 2.6.3z';

/** Tier shown by shape as well as colour: filled = strong, outlined = indicative, dashed = not mentioned. */
export function Seal({ tier, colour, size = 18 }: { tier: Tier; colour: string; size?: number }) {
  return (
    <svg viewBox="0 0 20 22" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d={SEAL}
        fill={tier === 'strong' ? colour : 'none'}
        stroke={colour}
        strokeWidth={1.6}
        strokeDasharray={tier === 'not_mentioned' ? '2.5 2' : undefined}
      />
    </svg>
  );
}

/**
 * Tier (the kind of evidence) is shown by shape and words in a neutral ink. Colour on a
 * finding is reserved for its status, so a class never makes something look red.
 */
export function TierBadge({ tier, cls }: { tier: Tier; cls: ConflictClass | 'disclosure_gap' }) {
  const { t } = useI18n();
  const colour = cls === 'disclosure_gap' ? CLASS_VAR.disclosure_gap : 'var(--ink-muted)';
  return (
    <span className={`tier-badge tier-${tier}`} style={{ color: colour }}>
      <Seal tier={tier} colour={colour} />
      <span>{t(`tier.${tier}`)}</span>
    </span>
  );
}
