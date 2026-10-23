import type { ReactNode } from "react";

/** Standard page opening: eyebrow, title, lede, with the seal-ring motif. */
export function PageHeader({ eyebrow, title, lede, children }: { eyebrow?: string; title: string; lede?: string; children?: ReactNode }) {
  return (
    <div className="relative overflow-hidden border-b border-line">
      <SealRings className="pointer-events-none absolute -right-24 -top-24 h-[22rem] w-[22rem] text-neel opacity-[0.09] sm:-right-10" />
      <div className="page relative py-12 sm:py-16">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="display mt-3 max-w-[22ch] text-[2.3rem] sm:text-5xl">{title}</h1>
        {lede ? <p className="lede mt-4">{lede}</p> : null}
        {children}
      </div>
    </div>
  );
}

/** Concentric stamp rings, used as a quiet background motif. */
export function SealRings({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor">
        <circle cx="100" cy="100" r="96" strokeWidth="2" />
        <circle cx="100" cy="100" r="86" strokeWidth="1" strokeDasharray="2 5" />
        <circle cx="100" cy="100" r="70" strokeWidth="6" />
        <circle cx="100" cy="100" r="52" strokeWidth="1" strokeDasharray="1 4" />
        <circle cx="100" cy="100" r="34" strokeWidth="2" />
      </g>
    </svg>
  );
}
