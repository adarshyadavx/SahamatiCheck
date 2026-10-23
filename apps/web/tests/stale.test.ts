import { describe, expect, it } from "vitest";
import type { VersionInfo } from "@sahamati/contracts";
import { isStaleBackend } from "@/lib/api";

const ok: VersionInfo = {
  git_sha: "abc1234", api_schema: "1", engine: "0.2.0", ontology: "2026.10.1", extractor: "rules@0.1.0",
  registry_digest: "aaaaaaaaaaaa", rule_count: 15,
};

describe("isStaleBackend", () => {
  it("treats a backend without /version as stale", () => expect(isStaleBackend(null, undefined)).toBe(true));
  it("flags a different api_schema", () => expect(isStaleBackend({ ...ok, api_schema: "0" }, undefined)).toBe(true));
  it("accepts a matching schema when the build has no SHA", () => expect(isStaleBackend(ok, undefined)).toBe(false));
  it("compares the git SHA only when the build is stamped", () => {
    expect(isStaleBackend(ok, "zzz9999")).toBe(true);
    expect(isStaleBackend(ok, "abc1234")).toBe(false);
    expect(isStaleBackend({ ...ok, git_sha: "unknown" }, "zzz9999")).toBe(false);
  });
});
