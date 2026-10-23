import { API_BASE_DEFAULT } from '@sahamati/contracts';
import type { LangPref } from './i18n';

export interface Settings {
  apiBase: string;
  lang: LangPref;
  autoHighlight: boolean;
  contextMenu: boolean;
  notifications: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  apiBase: API_BASE_DEFAULT,
  lang: 'auto',
  autoHighlight: false,
  contextMenu: false,
  notifications: false,
};

const KEY = 'settings';

export function normaliseApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return API_BASE_DEFAULT;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return API_BASE_DEFAULT;
    return trimmed;
  } catch {
    return API_BASE_DEFAULT;
  }
}

export async function getSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...((got[KEY] as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  next.apiBase = normaliseApiBase(next.apiBase);
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
