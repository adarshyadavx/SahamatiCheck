import type { Report } from '@sahamati/contracts';
import sample from '@sahamati/contracts/fixtures/report.sample.json';

/**
 * The fabricated Chai Wallet sample report, used only when the backend is unreachable.
 * It already has the full current shape (status on findings, indicators, rule_runs,
 * status_counts and the 10-row card), so the offline demo renders exactly like a live report.
 */
export function demoReport(): Report {
  return structuredClone(sample) as Report;
}

export const DEMO_PACKAGE = 'in.example.chaiwallet';
