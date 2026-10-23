import en from '../locales/en.json';
import hi from '../locales/hi.json';

export type Lang = 'en' | 'hi';
export type LangPref = Lang | 'auto';
export type MessageKey = keyof typeof en;
export type Vars = Record<string, string | number>;

const catalogs: Record<Lang, Record<string, string>> = { en, hi };

export function resolveLang(pref: LangPref, navLang?: string): Lang {
  if (pref === 'en' || pref === 'hi') return pref;
  const nav = navLang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  return nav.toLowerCase().startsWith('hi') ? 'hi' : 'en';
}

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const template = catalogs[lang][key] ?? catalogs.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** True when the English catalog has this key (used to fall back for codes the client does not know). */
export function hasKey(key: string): key is MessageKey {
  return key in catalogs.en;
}

export function catalog(lang: Lang): Record<string, string> {
  return catalogs[lang];
}

export type Translator = (key: MessageKey, vars?: Vars) => string;
export function translator(lang: Lang): Translator {
  return (key, vars) => translate(lang, key, vars);
}

export function formatDate(iso: string | number, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
