import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import hi from '../locales/hi.json';
import { resolveLang, translate } from '../lib/i18n';

// Mirrors CLAUDE.md rule 4. packages/i18n/check-wording.mjs is the canonical check.
const BANNED_EN = ['violat', 'lie', 'lies', 'lying', 'illegal', 'fraud', 'non-compliant', 'noncompliant', 'cheat', 'scam'];
const BANNED_HI = ['उल्लंघन', 'झूठ', 'अवैध', 'गैरकानूनी', 'ग़ैरक़ानूनी', 'धोखाधड़ी', 'धोखा', 'घोटाला', 'ठगी'];

describe('locales', () => {
  it('Hindi has every English key and no extra keys', () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
  });

  it('keeps the same placeholders in both languages', () => {
    for (const [k, v] of Object.entries(en)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph((hi as Record<string, string>)[k]), k).toEqual(ph(v));
    }
  });

  it('uses neutral wording only', () => {
    for (const v of Object.values(en)) {
      const words = v.toLowerCase().split(/[^a-z-]+/);
      for (const b of BANNED_EN) {
        expect(words.some((w) => (b.endsWith('t') && b === 'violat' ? w.startsWith(b) : w === b)), `${b} in "${v}"`).toBe(false);
      }
    }
    for (const v of Object.values(hi)) for (const b of BANNED_HI) expect(v.includes(b), `${b} in "${v}"`).toBe(false);
  });

  it('translates with variables and resolves the language', () => {
    expect(translate('en', 'job.progress', { pct: 40 })).toBe('40% done');
    expect(translate('hi', 'job.progress', { pct: 40 })).toBe('40% पूरा');
    expect(resolveLang('auto', 'hi-IN')).toBe('hi');
    expect(resolveLang('auto', 'en-GB')).toBe('en');
    expect(resolveLang('hi', 'en-GB')).toBe('hi');
  });
});
