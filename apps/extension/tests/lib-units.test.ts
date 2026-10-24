import type { Job } from '@sahamati/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../lib/api';
import { JOBS_KEY, listJobs, pollJobsOnce, putJob, removeJob } from '../lib/jobs';
import { chromeKV, memoryKV } from '../lib/kv';
import { isPackageName, looksLikePolicyPage, packageFromPlayUrl } from '../lib/play';
import type { InFlightJob } from '../lib/reportService';
import { splitSentences } from '../lib/sentences';
import { DEFAULT_SETTINGS, getSettings, normaliseApiBase, onSettingsChanged, saveSettings } from '../lib/settings';

const job = (id: string, over: Partial<InFlightJob> = {}): InFlightJob => ({
  job_id: id, package: `in.example.${id}`, status_url: `/v1/jobs/${id}`, events_url: `/v1/jobs/${id}/events`, startedAt: Date.now(), ...over,
});

describe('package names from Play URLs', () => {
  it.each([
    ['https://play.google.com/store/apps/details?id=in.example.shopkart', 'in.example.shopkart'],
    ['https://play.google.com/store/apps/details?id=in.example.shopkart&hl=hi&gl=IN', 'in.example.shopkart'],
    ['https://play.google.com/store/apps/datasafety?id=com.foo_bar.App2', 'com.foo_bar.App2'],
  ])('reads %s', (url, id) => expect(packageFromPlayUrl(url)).toBe(id));

  it.each([
    undefined, null, '', 'not a url', 'https://evil.example/store/apps/details?id=in.example.shopkart',
    'https://play.google.com/store/search?q=privacy', 'https://play.google.com/store/apps/details',
    'https://play.google.com/store/apps/details?id=nodots', 'https://play.google.com/store/apps/details?id=a.b;rm -rf',
    'https://play.google.com.evil.example/store/apps/details?id=in.example.x',
  ])('ignores %j', (url) => expect(packageFromPlayUrl(url as string | undefined)).toBeNull());

  it('validates package names', () => {
    expect(isPackageName(' in.example.shopkart ')).toBe(true);
    for (const bad of ['', 'x', '1a.b', 'a.', 'a b.c', 'a.b/c']) expect(isPackageName(bad)).toBe(false);
  });

  it('only suggests https pages that look like a policy', () => {
    expect(looksLikePolicyPage('https://shop.example/privacy')).toBe(true);
    expect(looksLikePolicyPage('https://shop.example/legal', 'Our Privacy Policy')).toBe(true);
    expect(looksLikePolicyPage('https://shop.example/gopniyata', 'गोपनीयता नीति')).toBe(true);
    expect(looksLikePolicyPage('http://shop.example/privacy')).toBe(false);
    expect(looksLikePolicyPage('https://shop.example/pricing', 'Plans')).toBe(false);
  });
});

describe('sentence splitting keeps exact offsets', () => {
  it('handles full stops, question marks, the Devanagari danda and line breaks', () => {
    const text = 'We collect data. Do we share it? No।\nSecond line without a stop';
    const got = splitSentences(text);
    expect(got.map((s) => s.text)).toEqual(['We collect data.', 'Do we share it?', 'No।', 'Second line without a stop']);
    for (const s of got) expect(text.slice(s.start, s.end)).toBe(s.text); // offsets round-trip
  });
  it('drops fragments shorter than three characters and tolerates empty input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('. . ! ?')).toEqual([]);
    expect(splitSentences('A. Fine, thanks.').map((s) => s.text)).toEqual(['Fine, thanks.']);
  });
  it('keeps a closing quote with its sentence', () => {
    expect(splitSentences('He said "we never sell data." Then left.').map((s) => s.text)[0]).toBe('He said "we never sell data."');
  });
});

describe('in-flight job bookkeeping', () => {
  it('stores, lists and removes jobs without disturbing the others', async () => {
    const kv = memoryKV();
    expect(await listJobs(kv)).toEqual({});
    await putJob(kv, job('a'));
    await putJob(kv, job('b'));
    expect(Object.keys(await listJobs(kv))).toEqual(['a', 'b']);
    await removeJob(kv, 'a');
    expect(Object.keys(await listJobs(kv))).toEqual(['b']);
    await removeJob(kv, 'never-existed');
    expect(Object.keys(await listJobs(kv))).toEqual(['b']);
  });

  const apiReturning = (impl: (id: string) => Promise<Job>): ApiClient => ({ getJob: impl }) as unknown as ApiClient;

  it('one polling pass reports finished jobs, updates running ones and forgets the finished', async () => {
    const kv = memoryKV();
    for (const id of ['run', 'done', 'fail']) await putJob(kv, job(id));
    const api = apiReturning(async (id) =>
      id === 'run' ? { job_id: id, status: 'running', stage: 'fetch_policy', progress: 0.4 }
      : id === 'done' ? { job_id: id, status: 'done', stage: 'done', progress: 1, report_id: 'r_1' }
      : { job_id: id, status: 'error', stage: 'error', progress: 0.2, error: 'boom' });
    const out = await pollJobsOnce(api, kv);
    expect(out.remaining).toBe(1);
    expect(out.finished.map((f) => [f.job.job_id, f.status.status])).toEqual([['done', 'done'], ['fail', 'error']]);
    expect((await listJobs(kv)).run).toMatchObject({ stage: 'fetch_policy', progress: 0.4 });
    expect(Object.keys(await listJobs(kv))).toEqual(['run']);
  });

  it('keeps a job while the backend is unreachable, but gives up after an hour', async () => {
    const kv = memoryKV();
    await putJob(kv, job('fresh'));
    await putJob(kv, job('stale', { startedAt: Date.now() - 61 * 60 * 1000 }));
    const down = apiReturning(async () => { throw new Error('offline'); });
    const out = await pollJobsOnce(down, kv);
    expect(out).toEqual({ finished: [], remaining: 1 });
    expect(Object.keys((await kv.get<Record<string, unknown>>(JOBS_KEY)) ?? {})).toEqual(['fresh']);
  });
});

describe('key-value stores', () => {
  it('memoryKV copies what it stores', async () => {
    const kv = memoryKV();
    const value = { a: [1, 2] };
    await kv.set('k', value);
    value.a.push(3);
    expect(await kv.get('k')).toEqual({ a: [1, 2] });
    await kv.remove('k');
    expect(await kv.get('k')).toBeUndefined();
  });

  it('chromeKV wraps a storage area', async () => {
    const store: Record<string, unknown> = {};
    const area = {
      get: vi.fn(async (k: string) => (k in store ? { [k]: store[k] } : {})),
      set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(store, o)),
      remove: vi.fn(async (k: string) => void delete store[k]),
    } as unknown as chrome.storage.StorageArea;
    const kv = chromeKV(area);
    expect(await kv.get('x')).toBeUndefined();
    await kv.set('x', 5);
    expect(await kv.get('x')).toBe(5);
    await kv.remove('x');
    expect(await kv.get('x')).toBeUndefined();
  });
});

describe('settings', () => {
  let store: Record<string, unknown>;
  let listeners: ((c: Record<string, chrome.storage.StorageChange>, area: string) => void)[];
  beforeEach(() => {
    store = {};
    listeners = [];
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
          set: async (o: Record<string, unknown>) => void Object.assign(store, o),
        },
        onChanged: {
          addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
          removeListener: (fn: (typeof listeners)[number]) => void (listeners = listeners.filter((l) => l !== fn)),
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('normalises the API base and refuses anything that is not http(s)', () => {
    expect(normaliseApiBase('http://localhost:8020///')).toBe('http://localhost:8020');
    expect(normaliseApiBase('  https://api.example.in/ ')).toBe('https://api.example.in');
    for (const bad of ['', '   ', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url', 'ftp://x']) {
      expect(normaliseApiBase(bad)).toBe(DEFAULT_SETTINGS.apiBase);
    }
  });

  it('starts from the defaults, merges a patch, and sanitises the base on save', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    const saved = await saveSettings({ lang: 'hi', apiBase: 'http://localhost:8020/' });
    expect(saved).toMatchObject({ lang: 'hi', apiBase: 'http://localhost:8020', autoHighlight: false });
    expect(await getSettings()).toEqual(saved);
    expect((await saveSettings({ apiBase: 'javascript:1' })).apiBase).toBe(DEFAULT_SETTINGS.apiBase);
  });

  it('privacy-sensitive options default to off', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ autoHighlight: false, contextMenu: false, notifications: false });
  });

  it('notifies on local changes only, and can be unsubscribed', () => {
    const seen: string[] = [];
    const off = onSettingsChanged((s) => seen.push(s.lang));
    listeners[0]({ settings: { newValue: { lang: 'hi' } } as chrome.storage.StorageChange }, 'local');
    listeners[0]({ settings: { newValue: { lang: 'en' } } as chrome.storage.StorageChange }, 'session');
    listeners[0]({ other: { newValue: 1 } as chrome.storage.StorageChange }, 'local');
    expect(seen).toEqual(['hi']);
    off();
    expect(listeners).toHaveLength(0);
  });
});
