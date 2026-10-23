import { createContext, useContext, type ReactNode } from 'react';
import { translator, type Lang, type Translator } from '../lib/i18n';

interface I18nValue {
  lang: Lang;
  t: Translator;
}

const I18nContext = createContext<I18nValue>({ lang: 'en', t: translator('en') });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <I18nContext.Provider value={{ lang, t: translator(lang) }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
