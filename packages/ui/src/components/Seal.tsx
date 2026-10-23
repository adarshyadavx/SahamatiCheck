import type { ReactNode } from "react";
import { cx, sealPath } from "../util";

export type SealVariant = "filled" | "outlined" | "dashed";

export interface SealProps {
  size?: number;
  variant?: SealVariant;
  /** Any CSS colour, usually a token such as var(--neel). */
  color?: string;
  className?: string;
  /** Accessible name. Omit when decorative. */
  title?: string;
  children?: ReactNode;
}

const PATH = sealPath(12, 12, 10.5, 12, 0.11);

/** The Mudra seal: a scalloped stamp. Shape carries meaning without colour. */
export function Seal({ size = 16, variant = "filled", color = "currentColor", className, title, children }: SealProps) {
  return (
    <svg
      className={cx("mu-seal", `mu-seal--${variant}`, className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path
        d={PATH}
        fill={variant === "filled" ? color : "none"}
        stroke={color}
        strokeWidth={variant === "filled" ? 0 : 1.8}
        strokeDasharray={variant === "dashed" ? "2.6 2.2" : undefined}
        strokeLinejoin="round"
      />
      {variant === "filled" ? <circle cx="12" cy="12" r="5.2" fill="none" stroke="var(--surface-raised)" strokeWidth="1.2" opacity="0.7" /> : null}
      {children}
    </svg>
  );
}

const LOGO_OUTER = sealPath(32, 32, 30, 18, 0.06);

/** Brand mark: a seal stamped with स (sa, for sahamati). */
export function SealLogo({ size = 36, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={cx("mu-logo", className)}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path d={LOGO_OUTER} fill="var(--neel)" />
      <circle cx="32" cy="32" r="22.5" fill="none" stroke="var(--on-neel)" strokeWidth="1.4" strokeDasharray="1.5 3" opacity="0.75" />
      <text
        x="32"
        y="33"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-display)"
        fontWeight="700"
        fontSize="28"
        fill="var(--on-neel)"
      >
        स
      </text>
    </svg>
  );
}
