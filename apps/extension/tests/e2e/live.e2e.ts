import { describe, expect, it } from 'vitest';
import type { Job, Report } from '@sahamati/contracts';
import { createApiClient } from '../../lib/api';
import { isStaleBackend } from '../../lib/version';

const API = process.env.SAHAMATI_API_URL;

// The extension's own API client against the real backend (no fixtures).
describe.skipIf(!API)('extension client against the live backend', () => {
  const api = createApiClient(API ?? 'http://localhost:8000');

  it('reports a current build on /version', async () => {
    const v = await api.version();
    expect(isStaleBackend(v, process.env.EXPECT_GIT_SHA)).toBe(false);
    if (process.env.EXPECT_GIT_SHA) expect(v?.git_sha).toBe(process.env.EXPECT_GIT_SHA);
  });

  it('checks ShopKart, polls the job, and fetches the report with its card', async () => {
    const res = await api.check({ package_name: 'in.example.shopkart' });
    if (res.kind === 'job') {
      let job: Job = await api.getJob(res.job_id);
      for (let i = 0; i < 60 && job.status !== 'done' && job.status !== 'error'; i++) {
        await new Promise((r) => setTimeout(r, 500));
        job = await api.getJob(res.job_id);
      }
      expect(job.status).toBe('done');
    }
    const got = await api.getReport('in.example.shopkart');
    expect(got.status).toBe(200);
    const report = (got as { report: Report }).report;
    expect(report.card.categories).toHaveLength(10);
    expect(report.card.answers).toHaveLength(5);
    expect(report.card.categories.find((c) => c.id === 'ads_tracking')?.color).toBe('red');
    expect(report.rule_runs.some((r) => r.status === 'inconclusive' && r.reason)).toBe(true);
    await expect(api.feedback(report.findings[0].id, { verdict: 'looks_wrong', client: 'extension' })).resolves.toBeUndefined();
  });
});
