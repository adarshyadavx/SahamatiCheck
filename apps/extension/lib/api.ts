import type {
  CheckRequest,
  CheckResponse,
  Job,
  Ontology,
  PolicySegmentsRequest,
  PolicySegmentsResponse,
  Report,
  VersionInfo,
} from '@sahamati/contracts';

/** The server could not be reached at all (DNS, refused, CORS, timeout). */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The server answered with a non-2xx status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ReportFetch =
  | { status: 200; report: Report; etag: string | null }
  | { status: 304 };

export interface FeedbackBody {
  verdict: 'looks_wrong';
  comment?: string;
  client: 'extension';
}

export interface ApiClient {
  readonly base: string;
  resolve(path: string): string;
  check(req: CheckRequest): Promise<CheckResponse>;
  getJob(jobId: string): Promise<Job>;
  getReport(pkg: string, etag?: string | null): Promise<ReportFetch>;
  policySegments(req: PolicySegmentsRequest): Promise<PolicySegmentsResponse>;
  feedback(findingId: string, body: FeedbackBody): Promise<void>;
  ontology(): Promise<Ontology>;
  /** GET /version; `null` when the backend predates the endpoint (404). */
  version(): Promise<VersionInfo | null>;
  policyHistory(pkg: string): Promise<unknown>;
}

const TIMEOUT_MS = 15_000;

export function createApiClient(baseUrl: string, fetchImpl?: FetchLike): ApiClient {
  const base = baseUrl.replace(/\/+$/, '');
  const doFetch: FetchLike = fetchImpl ?? ((i, init) => globalThis.fetch(i, init));

  const resolve = (path: string) => (/^https?:\/\//.test(path) ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`);

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
    let res: Response;
    try {
      res = await doFetch(resolve(path), {
        ...init,
        // Never send cookies or other credentials (PLAN.md §5.4).
        credentials: 'omit',
        headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
        signal: controller?.signal,
      });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : String(err));
    } finally {
      if (timer) clearTimeout(timer);
    }
    return res;
  }

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  const postJson = (path: string, body: unknown) =>
    request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    base,
    resolve,

    async check(req) {
      const res = await postJson('/v1/checks', req);
      if (res.status !== 200 && res.status !== 202) throw new HttpError(res.status, `HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      return normaliseCheckResponse(res.status, body);
    },

    async getJob(jobId) {
      return json<Job>(await request(`/v1/jobs/${encodeURIComponent(jobId)}`));
    },

    async getReport(pkg, etag) {
      const headers: Record<string, string> = {};
      if (etag) headers['If-None-Match'] = etag;
      const res = await request(`/v1/apps/${encodeURIComponent(pkg)}/report`, { headers });
      if (res.status === 304) return { status: 304 };
      const report = await json<Report>(res);
      return { status: 200, report, etag: res.headers.get('ETag') };
    },

    async policySegments(req) {
      return json<PolicySegmentsResponse>(await postJson('/v1/policy/segments', req));
    },

    async feedback(findingId, body) {
      const res = await postJson(`/v1/findings/${encodeURIComponent(findingId)}/feedback`, body);
      if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
    },

    async version() {
      const res = await request('/version');
      if (res.status === 404) return null;
      return json<VersionInfo>(res);
    },

    async ontology() {
      return json<Ontology>(await request('/v1/ontology'));
    },

    async policyHistory(pkg) {
      return json<unknown>(await request(`/v1/apps/${encodeURIComponent(pkg)}/policy-history`));
    },
  };
}

/** Accepts the tagged contract shape and the plain `{report}` / `{job_id,…}` shapes. */
export function normaliseCheckResponse(status: number, body: Record<string, unknown>): CheckResponse {
  if (body.kind === 'report' && body.report) return { kind: 'report', report: body.report as Report };
  if (body.kind === 'job' && typeof body.job_id === 'string') return body as unknown as CheckResponse;
  if (status === 202 || typeof body.job_id === 'string') {
    const jobId = String(body.job_id);
    return {
      kind: 'job',
      job_id: jobId,
      status_url: typeof body.status_url === 'string' ? body.status_url : `/v1/jobs/${jobId}`,
      events_url: typeof body.events_url === 'string' ? body.events_url : `/v1/jobs/${jobId}/events`,
    };
  }
  if (body.report) return { kind: 'report', report: body.report as Report };
  return { kind: 'report', report: body as unknown as Report };
}
