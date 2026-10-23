import Link from "next/link";
import { createT, type Locale } from "@sahamati/i18n";
import { SealLogo } from "@sahamati/ui";
import { href } from "@/lib/i18n";
import { NavMenu } from "./NavMenu";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleSwitch } from "./LocaleSwitch";

export const NAV_ITEMS = [
  { key: "check", path: "/check" },
  { key: "selfCheck", path: "/self-check" },
  { key: "audit", path: "/audit" },
  { key: "methodology", path: "/methodology" },
  { key: "ontology", path: "/ontology" },
  { key: "rights", path: "/rights" },
  { key: "about", path: "/about" },
] as const;

export function SiteHeader({ locale }: { locale: Locale }) {
  const t = createT(locale);
  const items = NAV_ITEMS.map((i) => ({ href: href(locale, i.path), label: t(`nav.${i.key}`) }));
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] backdrop-blur-md">
      <div className="page flex h-16 items-center gap-3">
        <Link href={href(locale)} className="group mr-auto flex items-center gap-2.5 no-underline" aria-label={t("common.brand")}>
          <SealLogo size={34} className="transition-transform duration-300 group-hover:-rotate-12" />
          <span className="grid leading-none">
            <span className="font-display text-[1.15rem] font-bold tracking-tight text-ink">{t("common.brand")}</span>
            <span className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-ink-muted">{t("common.brandGloss")}</span>
          </span>
        </Link>
        <NavMenu
          items={items}
          labels={{ primary: t("nav.primary"), menu: t("nav.menu"), close: t("nav.closeMenu") }}
        />
        <LocaleSwitch locale={locale} label={t("common.language.label")} switchTo={t("common.language.switchTo")} />
        <ThemeToggle toLight={t("common.theme.toLight")} toDark={t("common.theme.toDark")} />
      </div>
    </header>
  );
}
