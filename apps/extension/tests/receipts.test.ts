import 'fake-indexeddb/auto';
import type { Report } from '@sahamati/contracts';
import sample from '@sahamati/contracts/fixtures/report.sample.json';
import { describe, expect, it } from 'vitest';
import { buildReceipt, claimsFromReport, diffClaims, exportJson, isEmptyDiff, openReceiptStore, withDiffs } from '../lib/receipts';

const report = sample as Report;

function changedReport(): Report {
  const r = structuredClone(report);
  // The data-safety section stops declaring advertising_id as shared.
  r.matrix = r.matrix.map((row) => (row.data_type === 'advertising_id' ? { ...row, data_safety: 'denies' } : row));
  // A new data type appears; health_info disappears.
  r.matrix = r.matrix.filter((row) => row.data_type !== 'health_info');
  r.matrix.push({ data_type: 'contacts_sync', ontology_path: ['personal_info', 'contacts'], policy: 'collects', data_safety: 'collects', apk: 'evidence' });
  return r;
}

describe('consent receipts', () => {
  it('snapshots matrix cells and finding tuples', () => {
    const claims = claimsFromReport(report);
    expect(claims.filter((c) => c.key.startsWith('matrix|')).length).toBe(report.matrix.length * 3);
    expect(claims.some((c) => c.key === 'tuple|policy|third_party|share|personal_info|' && c.stance === 'share:deny')).toBe(true);
  });

  it('hashes claims deterministically', async () => {
    const a = await buildReceipt(report, new Date('2026-10-19T00:00:00Z'));
    const b = await buildReceipt(structuredClone(report), new Date('2026-10-20T00:00:00Z'));
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sha256).toBe(b.sha256);
    const c = await buildReceipt(changedReport());
    expect(c.sha256).not.toBe(a.sha256);
  });

  it('diffs claims: added, removed and changed', () => {
    const diff = diffClaims(claimsFromReport(report), claimsFromReport(changedReport()));
    expect(diff.changed).toEqual([
      expect.objectContaining({ key: 'matrix|data_safety|advertising_id', from: 'shares', to: 'denies' }),
    ]);
    expect(diff.removed.map((c) => c.key).sort()).toEqual([
      'matrix|apk|health_info',
      'matrix|data_safety|health_info',
      'matrix|policy|health_info',
    ]);
    expect(diff.added.map((c) => c.data_type)).toEqual(['contacts_sync', 'contacts_sync', 'contacts_sync']);
    expect(isEmptyDiff(diffClaims(claimsFromReport(report), claimsFromReport(report)))).toBe(true);
  });

  it('stores receipts in IndexedDB, skipping unchanged snapshots', async () => {
    const store = openReceiptStore(`test-${Math.random()}`);
    const first = await store.saveIfChanged(report, new Date('2026-10-01T00:00:00Z'));
    expect(first.saved).toBe(true);
    const same = await store.saveIfChanged(report, new Date('2026-10-02T00:00:00Z'));
    expect(same.saved).toBe(false);
    const next = await store.saveIfChanged(changedReport(), new Date('2026-10-03T00:00:00Z'));
    expect(next.saved).toBe(true);

    const list = await store.listByPackage('in.example.chaiwallet');
    expect(list.length).toBe(2);
    const paired = withDiffs(list);
    expect(paired[0].diff).toBeNull();
    expect(paired[1].diff?.changed.length).toBe(1);

    const exported = JSON.parse(exportJson(await store.all()));
    expect(exported.format).toBe('sahamaticheck.receipts');
    expect(exported.receipts.length).toBe(2);
  });
});
