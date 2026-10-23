import { notFound } from "next/navigation";
import { createT, isLocale, locales, type Locale, type Translator } from "@sahamati/i18n";

export { locales, type Locale };

export type LocaleParams = Promise<{ locale: string }>;

/** Resolve the [locale] segment or 404. */
export async function resolveLocale(params: LocaleParams): Promise<{ locale: Locale; t: Translator }> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return { locale, t: createT(locale) };
}

/** Prefix an in-app path with the locale. */
export function href(locale: Locale, path = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return p === "/" ? `/${locale}` : `/${locale}${p}`;
}
