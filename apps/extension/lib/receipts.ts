import type { Report } from '@sahamati/contracts';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { canonicalJson, sha256Hex } from './hash';

/**
 * Consent receipts: a local, hashed snapshot of what an app's sources claimed on
 * the day the user looked. Stored in IndexedDB. Never uploaded.
 */

export interface ReceiptClaim {
  /** Stable identity used for diffing. */
  key: string;
  source: 'policy' | 'data_safety' | 'apk' | 'apk_permission' | 'apk_sdk';
  data_type: string;
  /** "collects" / "denies" / "share:deny" … */
  stance: string;
  actor?: string;
}

export interface Receipt {
  id?: number;
  package: string;
  title: string;
  report_id: string;
  is_demo: boolean;
  created_at: string;
  report_generated_at: string;
  versions: Report['versions'];
  claims: ReceiptClaim[];
  /** sha256 over the canonical JSON of `claims`. */
  sha256: string;
}

export interface ClaimChange {
  key: string;
  from: string;
  to: string;
  claim: ReceiptClaim;
}

export interface ClaimDiff {
  added: ReceiptClaim[];
  removed: ReceiptClaim[];
  changed: ClaimChange[];
}

/** Claims snapshot: one per matrix cell, plus every tuple quoted in a finding. */
export function claimsFromReport(report: Report): ReceiptClaim[] {
  const claims = new Map<string, ReceiptClaim>();
  for (const row of report.matrix) {
    for (const source of ['policy', 'data_safety', 'apk'] as const) {
      const key = `matrix|${source}|${row.data_type}`;
      claims.set(key, { key, source, data_type: row.data_type, stance: row[source] });
    }
  }
  for (const f of report.findings) {
    for (const side of f.sides) {
      const t = side.tuple;
      const key = `tuple|${side.source}|${t.actor}|${t.action}|${t.data_type}|${t.condition ?? ''}`;
      claims.set(key, {
        key,
        source: side.source,
        data_type: t.data_type,
        actor: t.actor,
        stance: `${t.action}:${t.polarity}`,
      });
    }
  }
  return [...claims.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function hashClaims(claims: ReceiptClaim[]): Promise<string> {
  return sha256Hex(canonicalJson(claims));
}

export async function buildReceipt(report: Report, now: Date = new Date()): Promise<Receipt> {
  const claims = claimsFromReport(report);
  return {
    package: report.app.package,
    title: report.app.title,
    report_id: report.report_id,
    is_demo: report.app.is_demo,
    created_at: now.toISOString(),
    report_generated_at: report.generated_at,
    versions: report.versions,
    claims,
    sha256: await hashClaims(claims),
  };
}

export function diffClaims(prev: ReceiptClaim[], next: ReceiptClaim[]): ClaimDiff {
  const before = new Map(prev.map((c) => [c.key, c]));
  const after = new Map(next.map((c) => [c.key, c]));
  const diff: ClaimDiff = { added: [], removed: [], changed: [] };
  for (const [key, c] of after) {
    const old = before.get(key);
    if (!old) diff.added.push(c);
    else if (old.stance !== c.stance) diff.changed.push({ key, from: old.stance, to: c.stance, claim: c });
  }
  for (const [key, c] of before) if (!after.has(key)) diff.removed.push(c);
  return diff;
}

export function isEmptyDiff(d: ClaimDiff): boolean {
  return !d.added.length && !d.removed.length && !d.changed.length;
}

interface ReceiptDB extends DBSchema {
  receipts: {
    key: number;
    value: Receipt;
    indexes: { package: string };
  };
}

export interface ReceiptStore {
  add(r: Receipt): Promise<Receipt>;
  listByPackage(pkg: string): Promise<Receipt[]>;
  all(): Promise<Receipt[]>;
  latest(pkg: string): Promise<Receipt | undefined>;
  /** Save only if the claims differ from the latest receipt for this package. */
  saveIfChanged(report: Report, now?: Date): Promise<{ saved: boolean; receipt: Receipt }>;
  clear(): Promise<void>;
}

export const RECEIPT_DB = 'sahamati-receipts';

export function openReceiptStore(dbName = RECEIPT_DB): ReceiptStore {
  let dbp: Promise<IDBPDatabase<ReceiptDB>> | null = null;
  const db = () =>
    (dbp ??= openDB<ReceiptDB>(dbName, 1, {
      upgrade(d) {
        const store = d.createObjectStore('receipts', { keyPath: 'id', autoIncrement: true });
        store.createIndex('package', 'package');
      },
    }));

  const byCreated = (a: Receipt, b: Receipt) =>
    a.created_at.localeCompare(b.created_at) || (a.id ?? 0) - (b.id ?? 0);

  const api: ReceiptStore = {
    async add(r) {
      const id = await (await db()).add('receipts', r);
      return { ...r, id };
    },
    async listByPackage(pkg) {
      return (await (await db()).getAllFromIndex('receipts', 'package', pkg)).sort(byCreated);
    },
    async all() {
      return (await (await db()).getAll('receipts')).sort(byCreated);
    },
    async latest(pkg) {
      const list = await api.listByPackage(pkg);
      return list[list.length - 1];
    },
    async saveIfChanged(report, now) {
      const receipt = await buildReceipt(report, now);
      const last = await api.latest(report.app.package);
      if (last && last.sha256 === receipt.sha256) return { saved: false, receipt: last };
      return { saved: true, receipt: await api.add(receipt) };
    },
    async clear() {
      await (await db()).clear('receipts');
    },
  };
  return api;
}

/** Pair each receipt with its diff against the previous receipt for the same package. */
export function withDiffs(receipts: Receipt[]): { receipt: Receipt; diff: ClaimDiff | null }[] {
  const lastByPkg = new Map<string, Receipt>();
  return [...receipts].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((receipt) => {
    const prev = lastByPkg.get(receipt.package);
    lastByPkg.set(receipt.package, receipt);
    return { receipt, diff: prev ? diffClaims(prev.claims, receipt.claims) : null };
  });
}

export function exportJson(receipts: Receipt[]): string {
  return JSON.stringify(
    { format: 'sahamaticheck.receipts', version: 1, exported_at: new Date().toISOString(), receipts },
    null,
    2,
  );
}
