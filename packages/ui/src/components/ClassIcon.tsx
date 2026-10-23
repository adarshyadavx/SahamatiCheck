import type { ConflictClass } from "@sahamati/contracts";
import { cx } from "../util";

export type ClassId = ConflictClass | "disclosure_gap";

export const CLASS_COLOR: Record<ClassId, string> = {
  internal_contradiction: "var(--class-internal)",
  declaration_mismatch: "var(--class-declaration)",
  behavioural_mismatch: "var(--class-behaviour)",
  disclosure_gap: "var(--class-gap)",
};

export interface ClassIconProps {
  cls: ClassId;
  size?: number;
  className?: string;
  /** Accessible name. Omit when a visible label sits next to it. */
  title?: string;
  /** Override the class colour (e.g. a neutral ink where red must be reserved for a status). */
  tint?: string;
}

/** One glyph per conflict class, drawn to echo the tri-source triangle. */
export function ClassIcon({ cls, size = 20, className, title, tint }: ClassIconProps) {
  const c = tint ?? CLASS_COLOR[cls];
  return (
    <svg
      className={cx("mu-class-icon", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {cls === "internal_contradiction" && (
        <>
          {/* one document, two statements pointing at each other */}
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M8 9h5.5M13.5 9l-1.8-1.6M13.5 9l-1.8 1.6" />
          <path d="M16 15h-5.5M10.5 15l1.8-1.6M10.5 15l1.8 1.6" />
        </>
      )}
      {cls === "declaration_mismatch" && (
        <>
          {/* policy vs declaration: two sheets, not equal */}
          <rect x="2.5" y="5" width="7.5" height="14" rx="1.5" />
          <rect x="14" y="5" width="7.5" height="14" rx="1.5" />
          <path d="M10.8 10.2h2.4M10.8 13.8h2.4M13 8.6l-1.9 6.8" />
        </>
      )}
      {cls === "behavioural_mismatch" && (
        <>
          {/* the APK: a chip with pins */}
          <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
          <path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" />
          <circle cx="12" cy="12" r="1.8" fill={c} stroke="none" />
        </>
      )}
      {cls === "disclosure_gap" && (
        <>
          {/* evidence with nothing around it: dashed halo */}
          <circle cx="12" cy="12" r="8.5" strokeDasharray="2 3" />
          <circle cx="12" cy="12" r="2.6" fill={c} stroke="none" />
        </>
      )}
    </svg>
  );
}
