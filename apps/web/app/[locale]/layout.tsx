import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../globals.css";
import { createT, isLocale, locales } from "@sahamati/i18n";
import { fontVariables } from "@/lib/fonts";
import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  const t = createT(isLocale(locale) ? locale : "en");
  return {
    title: { default: t("meta.title"), template: `%s · ${t("meta.title")}` },
    description: t("meta.description"),
    alternates: { languages: { en: "/en", hi: "/hi" } },
    icons: { icon: "/icon.svg" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#12141c" },
  ],
};

// Applies a stored theme choice before first paint, so there is no flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("sahamati-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  return (
    <html lang={locale} className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only-focusable fixed left-3 top-3 z-50 rounded-full bg-neel px-4 py-2 font-semibold text-onneel"
        >
          {t("common.skip")}
        </a>
        <SiteHeader locale={locale} />
        <main id="main" className="flex-1" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter locale={locale} />
      </body>
    </html>
  );
}
