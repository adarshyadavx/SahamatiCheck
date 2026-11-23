import {
  API_BASE_DEFAULT,
  type AuditAggregate,
  type CheckRequest,
  type CheckResponse,
  type Job,
  type Ontology,
  type Report,
  type VersionInfo,
  API_SCHEMA_EXPECTED,
} from "@sahamati/contracts";

/** Base URL the browser uses. */
export const PUBLIC_API_BASE = (process.env.NEXT_PUBLIC_API_BASE || API_BASE_DEFAULT).replace(/\/+$/, "");

/** Base URL the Next.js server uses (can differ inside Docker). */
export function serverApiBase(): string {
  return (process.env.API_BASE_INTERNAL || process.env.NEXT_PUBLIC_API_BASE || API_BASE_DEFAULT).replace(/\/+$/, "");
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}
/** Thrown when the API could not be reached at all (network, CORS, timeout). */
export class ApiUnreachable extends Error {}

export async function apiFetch<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; data: T; headers: Headers }> {
  const { timeoutMs = 8000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      credentials: "omit",
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json", ...(rest.headers || {}) },
    });
  } catch (err) {
    throw new ApiUnreachable(err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data ? String((data as { detail: unknown }).detail) : res.statusText;
    throw new ApiError(detail || `HTTP ${res.status}`, res.status, data);
  }
  return { status: res.status, data: data as T, headers: res.headers };
}

/* ---------- report ---------- */

export function isReport(x: unknown): x is Report {
  return Boolean(x && typeof x === "object" && "report_id" in x && "findings" in x && "summary" in x);
}

/** Server-side: GET /v1/reports/{id}. `?hl=hi` asks the API to re-render summaries in Hindi. */
export async function fetchReport(id: string, locale: "en" | "hi" = "en"): Promise<Report> {
  const hl = locale === "hi" ? "?hl=hi" : "";
  const { data } = await apiFetch<unknown>(`${serverApiBase()}/v1/reports/${encodeURIComponent(id)}${hl}`, {
    cache: "no-store",
    timeoutMs: 4000,
  });
  if (!isReport(data)) throw new ApiError("Malformed report", 502, data);
  return data;
}

/* ---------- rule registry ---------- */

/** One row of GET /v1/rules (not yet in packages/contracts; see docs/contract-requests.md). */
export interface RuleRegistryEntry {
  id: string;
  name: string;
  family: string;
  phase: number;
  enabled: boolean;
  version: string | number | null;
}

function str(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : typeof x === "number" ? String(x) : fallback;
}

/** Accept a bare array or `{ rules: [...] }`; drop rows without an id. */
export function normaliseRules(data: unknown): RuleRegistryEntry[] {
  const raw = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { rules?: unknown }).rules) ? (data as { rules: unknown[] }).rules : [];
  const out: RuleRegistryEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = str(o.id ?? o.rule_id);
    if (!id) continue;
    out.push({
      id,
      name: str(o.name),
      family: str(o.family),
      phase: typeof o.phase === "number" ? o.phase : Number(o.phase) || 0,
      enabled: o.enabled === true,
      version: typeof o.version === "number" || typeof o.version === "string" ? o.version : null,
    });
  }
  return out;
}

/** Server-side: GET /v1/rules. Throws ApiError (404 when the API predates the registry) or ApiUnreachable. */
export async function fetchRules(): Promise<RuleRegistryEntry[]> {
  const { data } = await apiFetch<unknown>(`${serverApiBase()}/v1/rules`, { cache: "no-store", timeoutMs: 4000 });
  return normaliseRules(data);
}

/* ---------- checks & jobs ---------- */

/**
 * POST /v1/checks. The contract's CheckResponse is a tagged union; the API may
 * also answer 200 with a bare Report or 202 with { job_id, ... } untagged, so
 * normalise all three shapes.
 */
export async function postCheck(req: CheckRequest): Promise<CheckResponse> {
  const { status, data } = await apiFetch<Record<string, unknown>>(`${PUBLIC_API_BASE}/v1/checks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    timeoutMs: 15000,
  });
  return normaliseCheckResponse(status, data);
}

export function normaliseCheckResponse(status: number, data: Record<string, unknown>): CheckResponse {
  if (data?.kind === "report" && isReport(data.report)) return { kind: "report", report: data.report };
  if (data?.kind === "job" || (status === 202 && typeof data?.job_id === "string") || typeof data?.job_id === "string") {
    const job_id = String(data.job_id);
    return {
      kind: "job",
      job_id,
      status_url: typeof data.status_url === "string" ? data.status_url : `/v1/jobs/${job_id}`,
      events_url: typeof data.events_url === "string" ? data.events_url : `/v1/jobs/${job_id}/events`,
    };
  }
  if (isReport(data)) return { kind: "report", report: data };
  if (data && isReport(data.report)) return { kind: "report", report: data.report };
  throw new ApiError("Unexpected response from /v1/checks", status, data);
}

export function absoluteApiUrl(pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${PUBLIC_API_BASE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

export async function getJob(statusUrl: string): Promise<Job> {
  const { data } = await apiFetch<Job>(absoluteApiUrl(statusUrl), { cache: "no-store" });
  return data;
}

/* ---------- feedback & disputes ---------- */

export async function postFeedback(findingId: string, reportId: string): Promise<void> {
  await apiFetch(`${PUBLIC_API_BASE}/v1/findings/${encodeURIComponent(findingId)}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verdict: "looks_wrong", report_id: reportId }),
  });
}

export interface DisputeRequest {
  report_id: string;
  finding_id?: string;
  contact_email: string;
  message: string;
}

export async function postDispute(req: DisputeRequest): Promise<void> {
  await apiFetch(`${PUBLIC_API_BASE}/v1/disputes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

/* ---------- audit & ontology ---------- */

export type AuditResponse = AuditAggregate & { is_demo?: boolean };

export async function getAudit(): Promise<AuditResponse> {
  const { data } = await apiFetch<AuditResponse>(`${PUBLIC_API_BASE}/v1/audit/aggregates`, { timeoutMs: 5000 });
  return data;
}

export async function getOntology(): Promise<Ontology> {
  const { data } = await apiFetch<Ontology>(`${PUBLIC_API_BASE}/v1/ontology`, { timeoutMs: 5000 });
  return data;
}

/* ---------- self-check ---------- */

export type SelfCheckResponse = CheckResponse;

export async function postSelfCheck(form: FormData): Promise<SelfCheckResponse> {
  const { status, data } = await apiFetch<Record<string, unknown>>(`${PUBLIC_API_BASE}/v1/self-check`, {
    method: "POST",
    body: form,
    timeoutMs: 120000,
  });
  return normaliseCheckResponse(status, data);
}

/* ---------- input parsing ---------- */

const PKG_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

// A Play app page anywhere in the text: web links with or without a scheme or "www.", the
// datasafety sub-page, and market:// links. The Play app's Share button produces text like
// "Check out X on Google Play! https://play.google.com/store/apps/details?id=...".
const PLAY_LINK_RE =
  /(?:([a-z][a-z0-9+.-]*:)?\/\/)?(?:www\.)?(?:play\.google\.com|market\.android\.com)\/store\/apps\/(?:details|datasafety)[^\s<>"']*|market:\/\/details[^\s<>"']*/gi;

/** The first Play app link in `raw` and its package id, or null. Other schemes (ftp:, …) are ignored. */
export function packageFromText(raw: string): { pkg: string; link: string } | null {
  for (const m of raw.matchAll(PLAY_LINK_RE)) {
    const link = m[0];
    const scheme = m[1]?.toLowerCase();
    if (scheme && scheme !== "http:" && scheme !== "https:") continue;
    const q = /[?&]id=([^&#\s]+)/.exec(link);
    if (!q) continue;
    let id: string;
    try {
      id = decodeURIComponent(q[1]);
    } catch {
      continue;
    }
    if (PKG_RE.test(id) && id.length <= 200) return { pkg: id, link };
  }
  return null;
}

/** Accept a package name, a Play link, or the text the Play app's Share button produces. Null if none. */
export function parseCheckInput(raw: string): CheckRequest | null {
  const s = raw.trim();
  if (!s) return null;
  if (PKG_RE.test(s)) return { package_name: s };
  const found = packageFromText(s);
  if (!found) return null;
  const play_url = /^https?:\/\//i.test(found.link)
    ? found.link
    : `https://play.google.com/store/apps/details?id=${found.pkg}`;
  return { play_url, package_name: found.pkg };
}

/** Browser-side: GET /v1/reports/{id}. */
export async function fetchReportClient(id: string): Promise<Report> {
  const { data } = await apiFetch<unknown>(`${PUBLIC_API_BASE}/v1/reports/${encodeURIComponent(id)}`);
  if (!isReport(data)) throw new ApiError("Malformed report", 502, data);
  return data;
}


/**
 * True when the backend is demonstrably older than this build: no /version endpoint (404), a different
 * api_schema, or (when NEXT_PUBLIC_GIT_SHA is set at build time) a different git_sha. An unreachable API
 * is not "stale"; the offline banner covers that.
 */
export function isStaleBackend(version: VersionInfo | null, clientSha: string | undefined = process.env.NEXT_PUBLIC_GIT_SHA): boolean {
  if (version === null) return true;
  if (version.api_schema !== API_SCHEMA_EXPECTED) return true;
  return Boolean(clientSha) && version.git_sha !== "unknown" && version.git_sha !== clientSha;
}

/** GET /version. `null` = the endpoint does not exist (old backend). Throws ApiUnreachable if the API is down. */
export async function fetchVersion(): Promise<VersionInfo | null> {
  try {
    const { data } = await apiFetch<VersionInfo>(`${serverApiBase()}/version`, { cache: "no-store", timeoutMs: 3000 });
    return data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
