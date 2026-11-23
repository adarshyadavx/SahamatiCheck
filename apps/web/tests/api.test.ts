import sample from "@sahamati/contracts/fixtures/report.sample.json";
import type { Report, VersionInfo } from "@sahamati/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ApiUnreachable,
  absoluteApiUrl,
  apiFetch,
  fetchReport,
  fetchReportClient,
  fetchRules,
  fetchVersion,
  getAudit,
  getJob,
  getOntology,
  isReport,
  normaliseCheckResponse,
  normaliseRules,
  parseCheckInput,
  postCheck,
  postDispute,
  postFeedback,
  postSelfCheck,
} from "@/lib/api";

const report = sample as unknown as Report;
const BASE = "http://localhost:8000";

function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : text, { status, headers: { "Content-Type": "application/json", ...headers } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const lastCall = () => fetchMock.mock.calls.at(-1) as [string, RequestInit];

describe("apiFetch", () => {
  it("returns status, parsed data and headers, and never sends credentials", async () => {
    fetchMock.mockImplementation(async () => reply({ a: 1 }, 200, { ETag: '"x"' }));
    const res = await apiFetch<{ a: number }>(`${BASE}/x`);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ a: 1 });
    expect(res.headers.get("etag")).toBe('"x"');
    expect(lastCall()[1].credentials).toBe("omit");
    expect((lastCall()[1].headers as Record<string, string>).Accept).toBe("application/json");
  });

  it("keeps a non-JSON body as text and tolerates an empty body", async () => {
    fetchMock.mockResolvedValueOnce(reply("plain text"));
    expect((await apiFetch(`${BASE}/x`)).data).toBe("plain text");
    fetchMock.mockResolvedValueOnce(reply("", 200));
    expect((await apiFetch(`${BASE}/x`)).data).toBeUndefined();
  });

  it("throws ApiError with the server's detail on an error status", async () => {
    fetchMock.mockImplementation(async () => reply({ detail: "report not found" }, 404));
    const err = await apiFetch(`${BASE}/x`).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, message: "report not found", body: { detail: "report not found" } });
  });

  it("falls back to the status text, then to a generic message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 502, statusText: "Bad Gateway" }));
    expect(await apiFetch(`${BASE}/x`).catch((e) => e.message)).toBe("Bad Gateway");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500, statusText: "" }));
    expect(await apiFetch(`${BASE}/x`).catch((e) => e.message)).toBe("HTTP 500");
  });

  it("reports an unreachable API (network error, CORS, timeout) as ApiUnreachable, not as an HTTP error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await apiFetch(`${BASE}/x`).catch((e) => e);
    expect(err).toBeInstanceOf(ApiUnreachable);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(err.message).toBe("Failed to fetch");
  });

  it("applies a timeout signal unless the caller passes its own", async () => {
    fetchMock.mockImplementation(async () => reply({}));
    await apiFetch(`${BASE}/x`, { timeoutMs: 1234 });
    expect(lastCall()[1].signal).toBeInstanceOf(AbortSignal);
    const own = new AbortController();
    await apiFetch(`${BASE}/x`, { signal: own.signal });
    expect(lastCall()[1].signal).toBe(own.signal);
  });
});

describe("reports", () => {
  it("isReport accepts a report and rejects look-alikes", () => {
    expect(isReport(report)).toBe(true);
    for (const bad of [null, undefined, 1, "x", {}, { report_id: "r" }, { report_id: "r", findings: [] }]) expect(isReport(bad)).toBe(false);
  });

  it("fetchReport asks for Hindi on /hi and encodes the id", async () => {
    fetchMock.mockImplementation(async () => reply(report));
    await fetchReport("r_demo/odd id", "hi");
    expect(lastCall()[0]).toBe(`${BASE}/v1/reports/r_demo%2Fodd%20id?hl=hi`);
    await fetchReport("r_demo_shopkart");
    expect(lastCall()[0]).toBe(`${BASE}/v1/reports/r_demo_shopkart`);
    expect(lastCall()[1].cache).toBe("no-store");
  });

  it("a malformed body is a 502, never a half-rendered page", async () => {
    fetchMock.mockImplementation(async () => reply({ hello: "world" }));
    await expect(fetchReport("r")).rejects.toMatchObject({ status: 502, message: "Malformed report" });
    await expect(fetchReportClient("r")).rejects.toMatchObject({ status: 502 });
  });

  it("fetchReportClient returns the report", async () => {
    fetchMock.mockImplementation(async () => reply(report));
    expect((await fetchReportClient("r_1")).report_id).toBe(report.report_id);
    expect(lastCall()[0]).toBe(`${BASE}/v1/reports/r_1`);
  });
});

describe("rule registry", () => {
  it("accepts a bare array or { rules }, drops rows without an id, coerces odd values", () => {
    const rows = [
      { id: "P05", name: "Collection contradiction", family: "P", phase: 1, enabled: true, version: 1 },
      { rule_id: "T01", name: "x", family: "T", phase: "2", enabled: false, version: "1.0.0" },
      { name: "no id" },
      null,
      "junk",
      { id: 7, phase: "abc", enabled: "yes" },
    ];
    for (const input of [rows, { rules: rows }]) {
      const out = normaliseRules(input);
      expect(out.map((r) => r.id)).toEqual(["P05", "T01", "7"]);
      expect(out[1]).toMatchObject({ phase: 2, enabled: false, version: "1.0.0" });
      expect(out[2]).toMatchObject({ phase: 0, enabled: false, version: null });
    }
    expect(normaliseRules(undefined)).toEqual([]);
    expect(normaliseRules({ rules: "nope" })).toEqual([]);
  });

  it("fetchRules reads GET /v1/rules", async () => {
    fetchMock.mockImplementation(async () => reply([{ id: "P05", name: "n", family: "P", phase: 1, enabled: true, version: 1 }]));
    expect(await fetchRules()).toHaveLength(1);
    expect(lastCall()[0]).toBe(`${BASE}/v1/rules`);
  });

  it("a 404 from an old API surfaces as ApiError so the page can say so", async () => {
    fetchMock.mockImplementation(async () => reply({ detail: "Not Found" }, 404));
    await expect(fetchRules()).rejects.toMatchObject({ status: 404 });
  });
});

describe("checks and jobs", () => {
  it("normalises every response shape the API may use", () => {
    expect(normaliseCheckResponse(200, { kind: "report", report })).toEqual({ kind: "report", report });
    expect(normaliseCheckResponse(200, report as unknown as Record<string, unknown>)).toEqual({ kind: "report", report });
    expect(normaliseCheckResponse(200, { report })).toEqual({ kind: "report", report });
    expect(normaliseCheckResponse(202, { kind: "job", job_id: "j1", status_url: "/s", events_url: "/e" })).toEqual({
      kind: "job", job_id: "j1", status_url: "/s", events_url: "/e",
    });
    expect(normaliseCheckResponse(202, { job_id: "j2" })).toEqual({
      kind: "job", job_id: "j2", status_url: "/v1/jobs/j2", events_url: "/v1/jobs/j2/events",
    });
    expect(() => normaliseCheckResponse(200, { something: "else" })).toThrow(ApiError);
  });

  it("postCheck sends JSON to /v1/checks", async () => {
    fetchMock.mockImplementation(async () => reply({ job_id: "j9" }, 202));
    const res = await postCheck({ package_name: "in.example.shopkart" });
    expect(res).toMatchObject({ kind: "job", job_id: "j9" });
    const [url, init] = lastCall();
    expect(url).toBe(`${BASE}/v1/checks`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ package_name: "in.example.shopkart" });
  });

  it("getJob resolves relative status urls against the API", async () => {
    fetchMock.mockImplementation(async () => reply({ job_id: "j1", status: "running", stage: "fetch_policy", progress: 0.3 }));
    expect((await getJob("/v1/jobs/j1")).stage).toBe("fetch_policy");
    expect(lastCall()[0]).toBe(`${BASE}/v1/jobs/j1`);
    await getJob("https://other.example/v1/jobs/j1");
    expect(lastCall()[0]).toBe("https://other.example/v1/jobs/j1");
  });

  it("absoluteApiUrl handles a missing leading slash", () => {
    expect(absoluteApiUrl("v1/jobs/x")).toBe(`${BASE}/v1/jobs/x`);
  });

  it("a rejected check surfaces the API's explanation", async () => {
    fetchMock.mockImplementation(async () => reply({ detail: "Play listing fetch needs the optional 'play' extra" }, 422));
    await expect(postCheck({ package_name: "com.real.app" })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("play") });
  });
});

describe("feedback, disputes, self-check", () => {
  it("postFeedback sends the finding id in the path and the verdict in the body", async () => {
    fetchMock.mockImplementation(async () => reply({ status: "received" }, 202));
    await postFeedback("f_dm_01", "r_1");
    const [url, init] = lastCall();
    expect(url).toBe(`${BASE}/v1/findings/f_dm_01/feedback`);
    expect(JSON.parse(init.body as string)).toEqual({ verdict: "looks_wrong", report_id: "r_1" });
  });

  it("postDispute posts the form fields", async () => {
    fetchMock.mockImplementation(async () => reply({ dispute_id: "d_1" }, 201));
    await postDispute({ report_id: "r_1", contact_email: "dev@example.com", message: "fixed" });
    expect(lastCall()[0]).toBe(`${BASE}/v1/disputes`);
    await fetchMock.mockImplementation(async () => reply({ detail: "report not found" }, 404));
    await expect(postDispute({ report_id: "r_x", contact_email: "a@b.c", message: "m" })).rejects.toMatchObject({ status: 404 });
  });

  it("postSelfCheck sends multipart without forcing a content type", async () => {
    fetchMock.mockImplementation(async () => reply({ kind: "report", report, private: true }));
    const form = new FormData();
    form.set("package_name", "in.example.mine");
    const res = await postSelfCheck(form);
    expect(res.kind).toBe("report");
    const [url, init] = lastCall();
    expect(url).toBe(`${BASE}/v1/self-check`);
    expect(init.body).toBe(form);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined(); // the browser adds the boundary
  });

  it("audit and ontology are plain GETs", async () => {
    fetchMock.mockResolvedValueOnce(reply({ corpus_size: 5, is_demo: true, by_category: [], failure_rates: {} }));
    expect((await getAudit()).is_demo).toBe(true);
    expect(lastCall()[0]).toBe(`${BASE}/v1/audit/aggregates`);
    fetchMock.mockResolvedValueOnce(reply({ version: "2026.10.1", nodes: [] }));
    expect((await getOntology()).version).toBe("2026.10.1");
  });
});

describe("parseCheckInput", () => {
  it.each([
    ["in.example.shopkart", { package_name: "in.example.shopkart" }],
    ["  com.foo_bar.App2  ", { package_name: "com.foo_bar.App2" }],
    ["https://play.google.com/store/apps/details?id=in.example.shopkart&hl=en", {
      play_url: "https://play.google.com/store/apps/details?id=in.example.shopkart&hl=en", package_name: "in.example.shopkart",
    }],
    // the Play app's Share button: free text around the link
    ["Check out ShopKart on Google Play! https://play.google.com/store/apps/details?id=in.example.shopkart&pcampaignid=web_share", {
      play_url: "https://play.google.com/store/apps/details?id=in.example.shopkart&pcampaignid=web_share", package_name: "in.example.shopkart",
    }],
    ["play.google.com/store/apps/details?id=in.example.shopkart", {
      play_url: "https://play.google.com/store/apps/details?id=in.example.shopkart", package_name: "in.example.shopkart",
    }],
    ["market://details?id=in.example.shopkart", {
      play_url: "https://play.google.com/store/apps/details?id=in.example.shopkart", package_name: "in.example.shopkart",
    }],
    ["https://play.google.com/store/apps/datasafety?id=in.example.shopkart&hl=en", {
      play_url: "https://play.google.com/store/apps/datasafety?id=in.example.shopkart&hl=en", package_name: "in.example.shopkart",
    }],
    ["https://www.play.google.com/store/apps/details?hl=en&id=in.example.shopkart", {
      play_url: "https://www.play.google.com/store/apps/details?hl=en&id=in.example.shopkart", package_name: "in.example.shopkart",
    }],
  ])("accepts %s", (raw, expected) => expect(parseCheckInput(raw)).toEqual(expected));

  it.each([
    "", "   ", "nodots", "1bad.start", "in.example.x; rm -rf /", "has space.in.it",
    "https://evil.example/?id=in.example.shopkart", "https://play.google.com/store/apps", "https://play.google.com/store/apps/details?id=bad id",
    "ftp://play.google.com/store/apps/details?id=a.b",
  ])("rejects %j", (raw) => expect(parseCheckInput(raw)).toBeNull());
});

describe("fetchVersion", () => {
  const v: VersionInfo = { git_sha: "abc", api_schema: "1", engine: "0.2.0", ontology: "x", extractor: "y", registry_digest: "z", rule_count: 86 };

  it("returns the version, null for an old backend, and rethrows other failures", async () => {
    fetchMock.mockResolvedValueOnce(reply(v));
    expect(await fetchVersion()).toEqual(v);
    fetchMock.mockResolvedValueOnce(reply({ detail: "Not Found" }, 404));
    expect(await fetchVersion()).toBeNull();
    fetchMock.mockResolvedValueOnce(reply({ detail: "boom" }, 500));
    await expect(fetchVersion()).rejects.toMatchObject({ status: 500 });
    fetchMock.mockRejectedValueOnce(new TypeError("down"));
    await expect(fetchVersion()).rejects.toBeInstanceOf(ApiUnreachable);
  });
});
