import Link from "next/link";
import { createT, type Locale } from "@sahamati/i18n";
import { SealLogo } from "@sahamati/ui";
import { href } from "@/lib/i18n";

export function SiteFooter({ locale }: { locale: Locale }) {
  const t = createT(locale);
  const explore = [
    ["check", "/check"],
    ["selfCheck", "/self-check"],
    ["audit", "/audit"],
    ["ontology", "/ontology"],
  ] as const;
  const project = [
    ["methodology", "/methodology"],
    ["rules", "/rules"],
    ["rights", "/rights"],
    ["about", "/about"],
    ["api", "/docs/api"],
  ] as const;
  return (
    <footer className="mt-24 border-t border-line bg-surface-sunken">
      <div className="page grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <SealLogo size={30} />
            <span className="font-display text-lg font-bold">{t("common.brand")}</span>
          </div>
          <p className="mt-3 text-sm text-ink-muted">{t("footer.tagline")}</p>
          <p className="mt-3 text-xs text-ink-faint">{t("footer.notAffiliated")}</p>
          <p className="mt-1 text-xs text-ink-faint">{t("footer.builtWith")}</p>
        </div>
        {[
          ["explore", explore],
          ["project", project],
        ].map(([title, links]) => (
          <nav key={title as string} aria-label={t(`footer.${title as string}`)}>
            <h2 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ink-muted">
              {t(`footer.${title as string}`)}
            </h2>
            <ul className="mt-3 grid gap-2 text-sm">
              {(links as ReadonlyArray<readonly [string, string]>).map(([k, p]) => (
                <li key={k}>
                  <Link href={href(locale, p)} className="text-ink no-underline hover:text-neel hover:underline">
                    {t(`nav.${k}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}
