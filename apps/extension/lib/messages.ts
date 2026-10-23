import type { Finding, Ontology, PolicySegment, Report } from '@sahamati/contracts';
import type { PreliminaryResult } from './prelim';
import type { InFlightJob, ReportResult } from './reportService';

/** A policy quote from the current report, used to tier the page highlights. */
export interface FindingQuote {
  findingId: string;
  tier: Finding['tier'];
  status: Finding['status'];
  quote: string;
}

export interface DisplaySegment extends PolicySegment {
  /** Coarse on-device label; only set for preliminary results. */
  prelimLabel?: PreliminaryResult['segments'][number]['label'];
}

export interface PolicyTabResult {
  url: string;
  title?: string;
  kind: 'preliminary' | 'server';
  segments: DisplaySegment[];
  vague_claim_ratio: number;
  at: number;
  error?: string;
}

/** Messages handled by the background service worker. */
export type BgRequest =
  | { type: 'report:get'; package: string; tabId?: number; force?: boolean; startCheck?: boolean }
  | { type: 'report:cached'; package: string }
  | { type: 'job:track'; job: InFlightJob }
  | { type: 'job:done'; jobId: string; package: string; tabId?: number }
  | { type: 'panel:open'; package: string; findingId?: string }
  | { type: 'policy:analyse'; tabId: number }
  | { type: 'policy:preliminary'; url: string; title: string; text: string }
  | { type: 'policy:segments'; url: string; title: string; text: string; lang: string }
  | { type: 'feedback'; findingId: string }
  | { type: 'ontology:get' }
  | { type: 'version:get' }
  | { type: 'api:base' };

export interface BgResponses {
  'report:get': ReportResult;
  'report:cached': { report: Report | null };
  'job:track': { ok: true };
  'job:done': ReportResult;
  'panel:open': { ok: boolean };
  'policy:analyse': { ok: boolean; reason?: 'needs_gesture' | 'error'; message?: string };
  'policy:preliminary': { result: PolicyTabResult; quotes: FindingQuote[] };
  'policy:segments': { ok: true; result: PolicyTabResult; quotes: FindingQuote[] } | { ok: false; error: string };
  feedback: { ok: boolean };
  'ontology:get': { ontology: Ontology | null };
  /** `unknown` = the backend could not be reached; it is not reported as stale. */
  'version:get': { state: 'ok' | 'stale' | 'unknown' };
  'api:base': { base: string };
}

export type BgResponse<T extends BgRequest['type']> = BgResponses[T];

/** Messages sent from the background to content scripts. */
export type TabMessage = { type: 'report:updated'; package: string };

/** Messages for the offscreen document. */
export type OffscreenRequest = { target: 'offscreen'; type: 'classify'; text: string };

export function sendToBackground<T extends BgRequest>(msg: T): Promise<BgResponse<T['type']>> {
  return chrome.runtime.sendMessage(msg) as Promise<BgResponse<T['type']>>;
}

/** Session keys shared between the background and the side panel. */
export const policyKey = (tabId: number) => `policy:${tabId}`;
export const FOCUS_KEY = 'focus';
export const LAST_PACKAGE_KEY = 'lastPackage';
export interface FocusTarget {
  package: string;
  findingId?: string;
  at: number;
}
