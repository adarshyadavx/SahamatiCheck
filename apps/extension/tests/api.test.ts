import type { Report } from '@sahamati/contracts';
import sample from '@sahamati/contracts/fixtures/report.sample.json';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, normaliseCheckResponse, type FetchLike } from '../lib/api';
import { memoryKV } from '../lib/kv';
import { getReport, REPORT_TTL_MS, reportKey } from '../lib/reportService';

const report = sample as Report;
const realReport: Report = {
  ...report,
  report_id: 'r_test',
  app: { ...report.app, package: 'in.example.dosanotes', title: 'Dosa Notes (demo)' },
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const down: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));

describe('API client', () => {
  it('never sends credentials', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(realReport, 200, { ETag: '"abc"' }));
    const api = createApiClient('http://localhost:8000/', fetchImpl);
    const res = await api.getReport('in.example.dosanotes');
    expect(res).toMatchObject({ status: 200, etag: '"abc"' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8000/v1/apps/in.example.dosanotes/report');
    expect(init?.credentials).toBe('omit');
  });

  it('sends If-None-Match and understands 304', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status: 304 }));
    const api = createApiClient('http://x', fetchImpl);
    expect(await api.getReport('a.b', '"v1"')).toEqual({ status: 304 });
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>)['If-None-Match']).toBe('"v1"');
  });

  it('normalises check responses', () => {
    expect(normaliseCheckResponse(202, { job_id: 'j1' })).toEqual({
      kind: 'job',
      job_id: 'j1',
      status_url: '/v1/jobs/j1',
      events_url: '/v1/jobs/j1/events',
    });
    expect(normaliseCheckResponse(200, { kind: 'report', report })).toEqual({ kind: 'report', report });
    expect(normaliseCheckResponse(200, { report })).toEqual({ kind: 'report', report });
  });
});

describe('report service and demo fallback', () => {
  it('falls back to the bundled demo report when the backend is unreachable', async () => {
    const res = await getReport('in.example.chaiwallet', { api: createApiClient('http://localhost:8000', down), cache: memoryKV() });
    expect(res.kind).toBe('report');
    if (res.kind !== 'report') return;
    expect(res.demo).toBe(true);
    expect(res.source).toBe('demo');
    expect(res.report.app.is_demo).toBe(true);
    expect(res.report.app.package).toBe('in.example.chaiwallet');
  });

  it('treats 5xx as unreachable too', async () => {
    const api = createApiClient('http://x', async () => jsonResponse({ detail: 'boom' }, 503));
    const res = await getReport('a.b', { api, cache: memoryKV() });
    expect(res).toMatchObject({ kind: 'report', demo: true });
  });

  it('prefers a stale cached copy over the demo when offline', async () => {
    const cache = memoryKV();
    await cache.set(reportKey('in.example.dosanotes'), { report: realReport, etag: null, fetchedAt: 0 });
    const res = await getReport('in.example.dosanotes', { api: createApiClient('http://x', down), cache, now: () => REPORT_TTL_MS * 2 });
    expect(res).toMatchObject({ kind: 'report', demo: false, source: 'stale-cache' });
  });

  it('serves a fresh cache hit without touching the network', async () => {
    const cache = memoryKV();
    await cache.set(reportKey('in.example.dosanotes'), { report: realReport, etag: '"e"', fetchedAt: 1000 });
    const fetchImpl = vi.fn<FetchLike>(down);
    const res = await getReport('in.example.dosanotes', { api: createApiClient('http://x', fetchImpl), cache, now: () => 2000 });
    expect(res).toMatchObject({ kind: 'report', source: 'cache' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('revalidates with the ETag after 24 h', async () => {
    const cache = memoryKV();
    await cache.set(reportKey('p.q'), { report: realReport, etag: '"e"', fetchedAt: 0 });
    const api = createApiClient('http://x', async () => new Response(null, { status: 304 }));
    const res = await getReport('p.q', { api, cache, now: () => REPORT_TTL_MS + 5 });
    expect(res).toMatchObject({ kind: 'report', source: 'network', fetchedAt: REPORT_TTL_MS + 5 });
  });

  it('starts a check on 404 and returns the job', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) =>
      url.endsWith('/report') ? jsonResponse({ detail: 'not found' }, 404) : jsonResponse({ job_id: 'j9', status_url: '/v1/jobs/j9', events_url: '/v1/jobs/j9/events' }, 202),
    );
    const res = await getReport('p.q', { api: createApiClient('http://x', fetchImpl), cache: memoryKV() }, { startCheck: true });
    expect(res).toMatchObject({ kind: 'job', job: { job_id: 'j9', package: 'p.q' } });
    expect(fetchImpl.mock.calls[1][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({ package_name: 'p.q' });
  });

  it('reports not_found without starting a check unless asked', async () => {
    const api = createApiClient('http://x', async () => jsonResponse({}, 404));
    expect(await getReport('p.q', { api, cache: memoryKV() })).toEqual({ kind: 'not_found' });
  });
});

describe('report language (?hl=)', () => {
  it('asks the backend for Hindi when the panel is in Hindi', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(realReport, 200, { ETag: '"hi1"' }));
    const api = createApiClient('http://x', fetchImpl);
    await api.getReport('in.example.dosanotes', null, 'hi');
    expect(fetchImpl.mock.calls[0][0]).toBe('http://x/v1/apps/in.example.dosanotes/report?hl=hi');
    await api.getReport('in.example.dosanotes');
    expect(fetchImpl.mock.calls[1][0]).toBe('http://x/v1/apps/in.example.dosanotes/report');
  });

  it('does not show a fresh English copy to a Hindi panel: it refetches without the English ETag', async () => {
    const cache = memoryKV();
    await cache.set(reportKey('in.example.dosanotes'), { report: realReport, etag: '"en1"', fetchedAt: 1000, lang: 'en' });
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(realReport, 200, { ETag: '"hi1"' }));
    const res = await getReport('in.example.dosanotes', { api: createApiClient('http://x', fetchImpl), cache, now: () => 2000 }, { lang: 'hi' });
    expect(res).toMatchObject({ kind: 'report', source: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('?hl=hi');
    expect((init?.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
    expect(await cache.get(reportKey('in.example.dosanotes'))).toMatchObject({ lang: 'hi', etag: '"hi1"' });
  });

  it('keeps using the cached copy when the language matches', async () => {
    const cache = memoryKV();
    await cache.set(reportKey('in.example.dosanotes'), { report: realReport, etag: null, fetchedAt: 1000, lang: 'hi' });
    const fetchImpl = vi.fn<FetchLike>();
    const res = await getReport('in.example.dosanotes', { api: createApiClient('http://x', fetchImpl), cache, now: () => 2000 }, { lang: 'hi' });
    expect(res).toMatchObject({ source: 'cache' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
