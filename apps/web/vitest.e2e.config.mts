import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live end-to-end checks against a running backend: SAHAMATI_API_URL=http://localhost:8020 pnpm test:e2e
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "node", include: ["tests/e2e/**/*.e2e.ts"], testTimeout: 60_000 },
});
