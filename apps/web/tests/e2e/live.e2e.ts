import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIDENCE_BANDS, type Job, type Report, type VersionInfo } from "@sahamati/contracts";

const API = process.env.SAHAMATI_API_URL;
const GOLDEN = fileURLToPath(new URL("../../../../backend/core/tests/golden/shopkart_report.json", import.meta.url));

// Fixture mode is off: every test here talks to the real backend, or is skipped when SAHAMATI_API_URL is unset.
describe.skipIf(!API)("web client against the live backend", () => {
  let lib: typeof import("@/lib/api");
  let report: Report;

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE", API!);
    vi.stubEnv("API_BASE_INTERNAL", API!);
    lib = await import("@/lib/api");
  });

  it("reports a current build on /version", async () => {
    const v = (await lib.fetchVersion()) as VersionInfo;
    expect(v).not.toBeNull();
    expect(lib.isStaleBackend(v, process.env.EXPECT_GIT_SHA)).toBe(false);
    if (process.env.EXPECT_GIT_SHA) expect(v.git_sha).toBe(process.env.EXPECT_GIT_SHA);
    console.log("backend /version:", JSON.stringify(v));
  });

  it("runs a ShopKart check and polls the job to the report", async () => {
    const res = await lib.postCheck({ package_name: "in.example.shopkart" });
    if (res.kind === "report") {
      report = res.report;
    } else {
      let job: Job = await lib.getJob(res.status_url);
      for (let i = 0; i < 60 && job.status !== "done" && job.status !== "error"; i++) {
        await new Promise((r) => setTimeout(r, 500));
        job = await lib.getJob(res.status_url);
      }
      expect(job.status).toBe("done");
      report = await lib.fetchReport(job.report_id!);
    }
    expect(report.app.package).toBe("in.example.shopkart");
  });

  it("serves a report card that matches the committed golden card", () => {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Report;
    const strip = (r: Report) => ({ ...r.card, checked_at: "" });
    expect(strip(report)).toEqual(strip(golden));
    expect(report.card.categories).toHaveLength(10);
    expect(report.card.categories.find((c) => c.id === "ads_tracking")?.color).toBe("red");
  });

  it("uses the same confidence bands as the engine", () => {
    for (const f of report.findings) {
      if (f.status === "confirmed_conflict") expect(f.confidence).toBeGreaterThanOrEqual(CONFIDENCE_BANDS.strong_min);
    }
  });

  it("accepts 'Report a mistake' feedback", async () => {
    const f = report.findings[0];
    await expect(lib.postFeedback(f.id, report.report_id)).resolves.toBeUndefined();
  });

  it("lists the rule registry", async () => {
    const rules = await lib.fetchRules();
    expect(rules.length).toBeGreaterThanOrEqual(15);
  });
});
