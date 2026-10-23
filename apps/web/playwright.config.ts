import { defineConfig } from "@playwright/test";

// Visual and accessibility checks against a running web app + backend:
//   SAHAMATI_WEB_URL=http://localhost:3020 pnpm test:visual        (default URL below)
// Baselines live in tests/visual/__screenshots__ (one set; render them on the machine that updates them).
export default defineConfig({
  testDir: "tests/visual",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  snapshotPathTemplate: "{testDir}/__screenshots__/{testName}-{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" } },
  use: { baseURL: process.env.SAHAMATI_WEB_URL ?? "http://localhost:3020" },
});
