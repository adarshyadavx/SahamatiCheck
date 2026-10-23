import type { Ontology, PolicySegmentsResponse, Report } from '@sahamati/contracts';
import { defineBackground } from 'wxt/utils/define-background';
import { findingStatus } from '../lib/card';
import { createApiClient, type ApiClient } from '../lib/api';
import { isStaleBackend } from '../lib/version';
import { sha256Hex } from '../lib/hash';
import { resolveLang, translate } from '../lib/i18n';
import { listJobs, pollJobsOnce, POLL_ALARM, POLL_PERIOD_MIN, putJob, removeJob } from '../lib/jobs';
import { chromeKV } from '../lib/kv';
import {
  FOCUS_KEY,
  LAST_PACKAGE_KEY,
  policyKey,
  type BgRequest,
  type BgResponses,
  type FindingQuote,
  type PolicyTabResult,
  type TabMessage,
} from '../lib/messages';
import { looksLikePolicyPage, packageFromPlayUrl } from '../lib/play';
import { HeuristicClassifier, type PreliminaryResult } from '../lib/prelim';
import { getReport, readCachedReport, confirmedCount, type InFlightJob, type ReportResult } from '../lib/reportService';
import { getSettings } from '../lib/settings';

const HIGHLIGHTER_FILE = '/policy-highlighter.js';
const OFFSCREEN_PATH = 'offscreen.html';
const MENU_ID = 'sahamati-analyse-policy';
const ONTOLOGY_KEY = 'ontology';
const ONTOLOGY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BADGE_COLOUR = '#B3261E'; // red is shown only for confirmed_conflict, and the badge counts only those

const local = chromeKV(chrome.storage.local);
const session = chromeKV(chrome.storage.session);

async function api(): Promise<ApiClient> {
  return createApiClient((await getSettings()).apiBase);
}

// ---------------------------------------------------------------- badge

async function setBadge(tabId: number | undefined, report: Report | null): Promise<void> {
  if (tabId === undefined) return;
  const n = report ? confirmedCount(report) : 0;
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOUR });
    await chrome.action.setBadgeText({ tabId, text: n > 0 ? String(n) : '' });
  } catch {
    // The tab may have closed.
  }
}

async function notifyTabs(pkg: string): Promise<void> {
  const tabs = await chrome.tabs.query({ url: 'https://play.google.com/store/apps/*' });
  const msg: TabMessage = { type: 'report:updated', package: pkg };
  for (const t of tabs) if (t.id !== undefined) chrome.tabs.sendMessage(t.id, msg).catch(() => undefined);
}

// ---------------------------------------------------------------- reports & jobs

async function loadReport(
  pkg: string,
  opts: { force?: boolean; startCheck?: boolean; tabId?: number },
): Promise<ReportResult> {
  const result = await getReport(pkg, { api: await api(), cache: local }, opts);
  await session.set(LAST_PACKAGE_KEY, pkg);
  if (result.kind === 'report' && !result.demo) {
    await setBadge(opts.tabId, result.report.app.package === pkg ? result.report : null);
    void notifyTabs(pkg);
  }
  if (result.kind === 'job') await trackJob({ ...result.job, tabId: opts.tabId });
  return result;
}

async function trackJob(job: InFlightJob): Promise<void> {
  await putJob(session, job);
  const existing = await chrome.alarms.get(POLL_ALARM);
  if (!existing) await chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
}

async function finishJob(job: InFlightJob): Promise<ReportResult> {
  await removeJob(session, job.job_id);
  const result = await loadReport(job.package, { force: true, tabId: job.tabId });
  if (result.kind === 'report' && !result.demo) await maybeNotify(job.package);
  return result;
}

async function maybeNotify(pkg: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.notifications || !chrome.notifications) return;
  const lang = resolveLang(settings.lang);
  chrome.notifications.create(`sahamati-${pkg}-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon/128.png'),
    title: translate(lang, 'notify.title'),
    message: translate(lang, 'notify.done', { package: pkg }),
  });
}

async function pollAlarm(): Promise<void> {
  const outcome = await pollJobsOnce(await api(), session);
  for (const { job, status } of outcome.finished) {
    if (status.status === 'done') await finishJob(job);
  }
  if (outcome.remaining === 0) await chrome.alarms.clear(POLL_ALARM);
}

// ---------------------------------------------------------------- policy highlighter

async function injectHighlighter(tabId: number): Promise<BgResponses['policy:analyse']> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [HIGHLIGHTER_FILE] });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const needsGesture = /permission|cannot access|must request/i.test(message);
    return { ok: false, reason: needsGesture ? 'needs_gesture' : 'error', message };
  }
}

let offscreenReady: Promise<void> | null = null;
async function ensureOffscreen(): Promise<void> {
  const has = await (chrome.offscreen as { hasDocument?: () => Promise<boolean> }).hasDocument?.();
  if (has) return;
  offscreenReady ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the preliminary on-device sentence classifier for the policy highlighter.',
    })
    .catch((err: unknown) => {
      if (!/single offscreen/i.test(String(err))) throw err;
    })
    .finally(() => {
      offscreenReady = null;
    });
  await offscreenReady;
}

async function classifyPreliminary(text: string): Promise<PreliminaryResult> {
  try {
    await ensureOffscreen();
    const res = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'classify', text })) as
      | PreliminaryResult
      | undefined;
    if (res?.kind === 'preliminary') return res;
  } catch {
    // Fall through to running the same heuristic here.
  }
  return new HeuristicClassifier().classify(text);
}

async function currentQuotes(): Promise<FindingQuote[]> {
  const pkg = await session.get<string>(LAST_PACKAGE_KEY);
  if (!pkg) return [];
  const cached = await readCachedReport(pkg, local);
  if (!cached) return [];
  return cached.report.findings.flatMap((f) =>
    f.sides
      .filter((s) => s.source === 'policy' && s.evidence.quote)
      .map((s) => ({ findingId: f.id, tier: f.tier, status: findingStatus(f), quote: s.evidence.quote as string })),
  );
}

function preliminaryToTab(url: string, title: string, res: PreliminaryResult): PolicyTabResult {
  return {
    url,
    title,
    kind: 'preliminary',
    at: Date.now(),
    vague_claim_ratio: res.vague_claim_ratio,
    segments: res.segments.map((s) => ({
      char_start: s.char_start,
      char_end: s.char_end,
      text: s.text,
      tuples: [],
      vague: s.vague,
      confidence: s.confidence,
      prelimLabel: s.label,
    })),
  };
}

function serverToTab(url: string, title: string, res: PolicySegmentsResponse): PolicyTabResult {
  return {
    url,
    title,
    kind: 'server',
    at: Date.now(),
    vague_claim_ratio: res.vague_claim_ratio,
    segments: res.segments,
  };
}

// ---------------------------------------------------------------- ontology

async function getOntology(): Promise<Ontology | null> {
  const cached = await local.get<{ ontology: Ontology; at: number }>(ONTOLOGY_KEY);
  if (cached && Date.now() - cached.at < ONTOLOGY_TTL_MS) return cached.ontology;
  try {
    const ontology = await (await api()).ontology();
    await local.set(ONTOLOGY_KEY, { ontology, at: Date.now() });
    return ontology;
  } catch {
    return cached?.ontology ?? null;
  }
}

// ---------------------------------------------------------------- context menu (optional permission)

async function syncContextMenu(): Promise<void> {
  const granted = await chrome.permissions.contains({ permissions: ['contextMenus'] });
  if (!granted || !chrome.contextMenus) return;
  const settings = await getSettings();
  await chrome.contextMenus.removeAll();
  if (!settings.contextMenu) return;
  chrome.contextMenus.create({
    id: MENU_ID,
    title: translate(resolveLang(settings.lang), 'menu.analyse'),
    contexts: ['page', 'selection'],
  });
}

function registerContextMenuClicks(): void {
  if (!chrome.contextMenus || registerContextMenuClicks.done) return;
  registerContextMenuClicks.done = true;
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID && tab?.id !== undefined) void injectHighlighter(tab.id);
  });
}
registerContextMenuClicks.done = false;

// ---------------------------------------------------------------- router

type Handler<T extends BgRequest['type']> = (
  msg: Extract<BgRequest, { type: T }>,
  sender: chrome.runtime.MessageSender,
) => Promise<BgResponses[T]>;

const handlers: { [T in BgRequest['type']]: Handler<T> } = {
  'report:get': (m) => loadReport(m.package, { force: m.force, startCheck: m.startCheck, tabId: m.tabId }),

  'report:cached': async (m, sender) => {
    const cached = await readCachedReport(m.package, local);
    const report = cached && cached.report.app.package === m.package ? cached.report : null;
    await setBadge(sender.tab?.id, report);
    return { report };
  },

  'job:track': async (m) => {
    await trackJob(m.job);
    return { ok: true };
  },

  'job:done': async (m) => {
    const jobs = await listJobs(session);
    const job = jobs[m.jobId] ?? {
      job_id: m.jobId,
      package: m.package,
      status_url: '',
      events_url: '',
      startedAt: Date.now(),
      tabId: m.tabId,
    };
    return finishJob(job);
  },

  // Handled synchronously in the listener (sidePanel.open needs the user gesture).
  'panel:open': async () => ({ ok: true }),

  'policy:analyse': (m) => injectHighlighter(m.tabId),

  'policy:preliminary': async (m, sender) => {
    const res = await classifyPreliminary(m.text);
    const result = preliminaryToTab(m.url, m.title, res);
    if (sender.tab?.id !== undefined) await session.set(policyKey(sender.tab.id), result);
    return { result, quotes: await currentQuotes() };
  },

  'policy:segments': async (m, sender) => {
    try {
      const client = await api();
      const res = await client.policySegments({
        url: m.url,
        text: m.text,
        text_sha256: await sha256Hex(m.text),
        lang: m.lang,
      });
      const result = serverToTab(m.url, m.title, res);
      if (sender.tab?.id !== undefined) await session.set(policyKey(sender.tab.id), result);
      return { ok: true, result, quotes: await currentQuotes() };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (sender.tab?.id !== undefined) {
        const key = policyKey(sender.tab.id);
        const prev = await session.get<PolicyTabResult>(key);
        if (prev) await session.set(key, { ...prev, error });
      }
      return { ok: false, error };
    }
  },

  feedback: async (m) => {
    try {
      await (await api()).feedback(m.findingId, { verdict: 'looks_wrong', client: 'extension' });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },

  'ontology:get': async () => ({ ontology: await getOntology() }),

  'version:get': async () => {
    try {
      return { state: isStaleBackend(await (await api()).version()) ? ('stale' as const) : ('ok' as const) };
    } catch {
      return { state: 'unknown' as const };
    }
  },

  'api:base': async () => ({ base: (await getSettings()).apiBase }),
};

function isBgRequest(msg: unknown): msg is BgRequest {
  return typeof msg === 'object' && msg !== null && 'type' in msg && !('target' in msg) && (msg as BgRequest).type in handlers;
}

// ---------------------------------------------------------------- wiring

export default defineBackground(() => {
  // Toolbar click opens the side panel (no popup). Using onClicked rather than
  // openPanelOnActionClick also grants activeTab for the highlighter.
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined) void chrome.sidePanel.open({ tabId: tab.id });
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'analyse-policy' && tab?.id !== undefined) void injectHighlighter(tab.id);
  });

  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (!isBgRequest(msg)) return false;

    if (msg.type === 'panel:open') {
      // Must run before any await to keep the user gesture from the marker click.
      const tabId = sender.tab?.id;
      if (tabId !== undefined) chrome.sidePanel.open({ tabId }).catch(() => undefined);
      void session.set(FOCUS_KEY, { package: msg.package, findingId: msg.findingId, at: Date.now() });
      sendResponse({ ok: tabId !== undefined });
      return false;
    }

    const handler = handlers[msg.type] as Handler<typeof msg.type>;
    handler(msg as never, sender)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ kind: 'error', message: String(err) }));
    return true; // async response
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POLL_ALARM) void pollAlarm();
  });

  // Opt-in auto-highlight: only with the optional https://*/* permission granted.
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status !== 'complete' || !tab.url) return;
    if (packageFromPlayUrl(tab.url)) return;
    void (async () => {
      const settings = await getSettings();
      if (!settings.autoHighlight || !looksLikePolicyPage(tab.url!, tab.title)) return;
      const granted = await chrome.permissions.contains({ origins: ['https://*/*'] });
      if (granted) await injectHighlighter(tabId);
    })();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void session.remove(policyKey(tabId));
  });

  chrome.runtime.onInstalled.addListener(() => {
    registerContextMenuClicks();
    void syncContextMenu();
  });
  chrome.runtime.onStartup.addListener(() => {
    registerContextMenuClicks();
    void syncContextMenu();
  });
  chrome.permissions.onAdded.addListener(() => {
    registerContextMenuClicks();
    void syncContextMenu();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) void syncContextMenu();
  });
  registerContextMenuClicks();

  // Resume polling after a service-worker restart.
  void listJobs(session).then(async (jobs) => {
    if (Object.keys(jobs).length && !(await chrome.alarms.get(POLL_ALARM))) {
      await chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
    }
  });
});
