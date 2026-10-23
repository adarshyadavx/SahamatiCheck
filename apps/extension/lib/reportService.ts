import type { Report } from '@sahamati/contracts';
import { HttpError, NetworkError, type ApiClient } from './api';
import { demoReport } from './demo';
import type { KV } from './kv';

export const REPORT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedReport {
  report: Report;
  etag: string | null;
  fetchedAt: number;
}

export interface InFlightJob {
  job_id: string;
  package: string;
  status_url: string;
  events_url: string;
  startedAt: number;
  stage?: string;
  progress?: number;
  tabId?: number;
}

export type ReportResult =
  | {
      kind: 'report';
      report: Report;
      /** true when this is the bundled sample shown because the backend is down. */
      demo: boolean;
      source: 'cache' | 'network' | 'stale-cache' | 'demo';
      fetchedAt: number;
    }
  | { kind: 'job'; job: InFlightJob }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

export const reportKey = (pkg: string) => `report:${pkg}`;

export interface ReportDeps {
  api: ApiClient;
  cache: KV;
  now?: () => number;
}

export interface ReportOptions {
  force?: boolean;
  /** When there is no report yet, start a check (POST /v1/checks). */
  startCheck?: boolean;
}

function isUnreachable(err: unknown): boolean {
  return err instanceof NetworkError || (err instanceof HttpError && err.status >= 500);
}

export async function readCachedReport(pkg: string, cache: KV): Promise<CachedReport | undefined> {
  return cache.get<CachedReport>(reportKey(pkg));
}

export async function storeReport(pkg: string, cache: KV, entry: CachedReport): Promise<void> {
  await cache.set(reportKey(pkg), entry);
}

/**
 * Cache (24 h, ETag) → network → stale cache → bundled demo report.
 * The demo fallback is only used when the server cannot be reached at all.
 */
export async function getReport(pkg: string, deps: ReportDeps, opts: ReportOptions = {}): Promise<ReportResult> {
  const now = deps.now ?? Date.now;
  const cached = await readCachedReport(pkg, deps.cache);

  if (cached && !opts.force && now() - cached.fetchedAt < REPORT_TTL_MS) {
    return { kind: 'report', report: cached.report, demo: false, source: 'cache', fetchedAt: cached.fetchedAt };
  }

  try {
    let res = await deps.api.getReport(pkg, cached?.etag);
    if (res.status === 304) {
      if (cached) {
        const refreshed = { ...cached, fetchedAt: now() };
        await storeReport(pkg, deps.cache, refreshed);
        return { kind: 'report', report: cached.report, demo: false, source: 'network', fetchedAt: refreshed.fetchedAt };
      }
      // 304 without a cached copy should not happen; refetch without the ETag.
      res = await deps.api.getReport(pkg, null);
    }
    if (res.status === 304) throw new HttpError(304, 'Unexpected 304');
    const entry: CachedReport = { report: res.report, etag: res.etag, fetchedAt: now() };
    await storeReport(pkg, deps.cache, entry);
    return { kind: 'report', report: res.report, demo: false, source: 'network', fetchedAt: entry.fetchedAt };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      if (!opts.startCheck) return { kind: 'not_found' };
      return startCheck(pkg, deps);
    }
    return fallback(err, cached);
  }
}

async function startCheck(pkg: string, deps: ReportDeps): Promise<ReportResult> {
  const now = deps.now ?? Date.now;
  try {
    const res = await deps.api.check({ package_name: pkg });
    if (res.kind === 'report') {
      const entry: CachedReport = { report: res.report, etag: null, fetchedAt: now() };
      await storeReport(pkg, deps.cache, entry);
      return { kind: 'report', report: res.report, demo: false, source: 'network', fetchedAt: entry.fetchedAt };
    }
    return {
      kind: 'job',
      job: {
        job_id: res.job_id,
        package: pkg,
        status_url: res.status_url,
        events_url: res.events_url,
        startedAt: now(),
      },
    };
  } catch (err) {
    return fallback(err, undefined);
  }
}

function fallback(err: unknown, cached: CachedReport | undefined): ReportResult {
  if (cached) {
    return { kind: 'report', report: cached.report, demo: false, source: 'stale-cache', fetchedAt: cached.fetchedAt };
  }
  if (isUnreachable(err)) {
    return { kind: 'report', report: demoReport(), demo: true, source: 'demo', fetchedAt: Date.now() };
  }
  return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
}

/** Toolbar badge number: findings the API marked confirmed_conflict. Possible differences are not counted. */
export function confirmedCount(report: Report): number {
  return (report.findings ?? []).filter((f) => f.status === 'confirmed_conflict').length;
}
