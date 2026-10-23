"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@sahamati/i18n";

/** Links to the same page in the other language and remembers the choice. */
export function LocaleSwitch({ locale, label, switchTo }: { locale: Locale; label: string; switchTo: string }) {
  const pathname = usePathname() || `/${locale}`;
  const other: Locale = locale === "en" ? "hi" : "en";
  const target = pathname.replace(/^\/(en|hi)(?=\/|$)/, `/${other}`);
  return (
    <Link
      href={target}
      hrefLang={other}
      lang={other}
      aria-label={`${label}: ${switchTo}`}
      onClick={() => {
        document.cookie = `sahamati-locale=${other}; path=/; max-age=31536000; samesite=lax`;
      }}
      className="inline-flex h-10 items-center rounded-full border border-line bg-surface-raised px-3.5 text-sm font-semibold text-ink no-underline transition-colors hover:border-neel hover:text-neel"
    >
      {switchTo}
    </Link>
  );
}
