import { defineConfig } from '@playwright/test';

// Loads the BUILT extension (`pnpm build` first) in Chromium and drives the real side panel against a running backend:
//   SAHAMATI_API_URL=http://localhost:8020 pnpm test:panel
export default defineConfig({
  testDir: 'tests/panel',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testName}-{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
});
