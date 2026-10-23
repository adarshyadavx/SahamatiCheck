import type { Tier } from "@sahamati/contracts";
import { cx, getT, type Locale } from "../util";
import { Seal, type SealVariant } from "./Seal";

const VARIANT: Record<Tier, SealVariant> = { strong: "filled", indicative: "outlined", not_mentioned: "dashed" };
const COLOR: Record<Tier, string> = {
  strong: "var(--neel)",
  indicative: "var(--class-behaviour)",
  not_mentioned: "var(--class-gap)",
};

export interface TierBadgeProps {
  tier: Tier;
  locale: Locale;
  /** Show the one-line description as a tooltip. */
  describe?: boolean;
  className?: string;
}

/** Tier shown by shape and colour: filled seal = strong, outlined = indicative, dashed = not mentioned. */
export function TierBadge({ tier, locale, describe = true, className }: TierBadgeProps) {
  const t = getT(locale);
  return (
    <span className={cx("mu-tier", `mu-tier--${tier}`, className)} title={describe ? t(`tier.desc.${tier}`) : undefined}>
      <Seal size={16} variant={VARIANT[tier]} color={COLOR[tier]} />
      <span className="mu-tier__label">{t(`tier.${tier}`)}</span>
    </span>
  );
}
