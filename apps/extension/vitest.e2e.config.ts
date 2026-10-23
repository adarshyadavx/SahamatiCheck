import { defineConfig } from 'vitest/config';

// Live end-to-end checks against a running backend: SAHAMATI_API_URL=http://localhost:8020 pnpm test:e2e
export default defineConfig({
  test: { environment: 'node', include: ['tests/e2e/**/*.e2e.ts'], testTimeout: 60_000 },
});
