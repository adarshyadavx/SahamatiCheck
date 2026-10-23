import en from "../en.json";
import hi from "../hi.json";

export const locales = ["en", "hi"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export type Catalog = typeof en;
export const catalogs: Record<Locale, unknown> = { en, hi };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** BCP-47 tag used for Intl formatting. */
export function intlTag(locale: Locale): string {
  return locale === "hi" ? "hi-IN" : "en-IN";
}

export type Vars = Record<string, string | number>;

export interface Translator {
  (key: string, vars?: Vars): string;
  /** True if the key resolves to a string in this locale. */
  has(key: string): boolean;
  /** Raw value (arrays and objects for long-form content). */
  raw<T = unknown>(key: string): T;
  locale: Locale;
}

function lookup(obj: unknown, key: string): unknown {
  let cur: unknown = obj;
  for (const part of key.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  );
}

const cache = new Map<Locale, Translator>();

/** Create a translator. Missing keys fall back to English, then to the key itself. */
export function createT(locale: Locale): Translator {
  const hit = cache.get(locale);
  if (hit) return hit;
  const primary = catalogs[locale];
  const fallback = catalogs[defaultLocale];
  const t = ((key: string, vars?: Vars) => {
    const v = lookup(primary, key) ?? lookup(fallback, key);
    return typeof v === "string" ? interpolate(v, vars) : key;
  }) as Translator;
  t.has = (key) => typeof lookup(primary, key) === "string";
  t.raw = <T,>(key: string) => (lookup(primary, key) ?? lookup(fallback, key)) as T;
  t.locale = locale;
  cache.set(locale, t);
  return t;
}

/** "precise_location" → "Precise location". Used when no label is known. */
export function humanize(id: string): string {
  const s = id.replace(/^[a-z]+:/, "").replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Localised label for an ontology data-type id. `extra` can carry labels from /v1/ontology. */
export function dataTypeLabel(t: Translator, id: string, extra?: Record<string, string>): string {
  const bare = id.replace(/^dt:/, "");
  if (extra?.[bare]) return extra[bare];
  return t.has(`dt.${bare}`) ? t(`dt.${bare}`) : humanize(bare);
}

export function actorLabel(t: Translator, id: string): string {
  const bare = id.replace(/^actor:/, "");
  return t.has(`actor.${bare}`) ? t(`actor.${bare}`) : humanize(bare);
}

export function formatDate(locale: Locale, iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlTag(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

export function formatPercent(locale: Locale, value: number, digits = 0): string {
  return new Intl.NumberFormat(intlTag(locale), { style: "percent", maximumFractionDigits: digits }).format(value);
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(intlTag(locale)).format(value);
}

export * from "./status";

/** Language of a backend-supplied sentence: Devanagari text is "hi", anything else "en". */
export function contentLang(text: string): Locale {
  return /[ऀ-ॿ]/.test(text) ? "hi" : "en";
}
