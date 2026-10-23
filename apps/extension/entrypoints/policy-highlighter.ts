import type { ClaimTupleView } from '@sahamati/contracts';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { resolveLang, translate, type Lang, type MessageKey } from '../lib/i18n';
import type { BgResponses, DisplaySegment, FindingQuote, PolicyTabResult } from '../lib/messages';
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings';
import { buildTextMap, findQuote, rangeFor, type TextMap } from '../lib/textmap';

/**
 * Policy-page highlighter. Injected only on a user gesture (toolbar click,
 * Alt+Shift+S, the context menu or the side-panel button) via chrome.scripting.
 *
 * It never changes the page text: highlights use the CSS Custom Highlight API,
 * and the tooltip and consent bar live in a closed shadow root.
 */

type Bucket = 'strong' | 'indicative' | 'claim' | 'vague' | 'prelim';
const BUCKETS: Bucket[] = ['strong', 'indicative', 'claim', 'vague', 'prelim'];
const hlName = (b: Bucket) => `sahamati-${b}`;

interface HoverEntry {
  start: number;
  end: number;
  bucket: Bucket;
  segment?: DisplaySegment;
  quote?: FindingQuote;
}

interface HighlighterState {
  reopen(): void;
}

declare global {
  interface Window {
    __sahamatiHighlighter?: HighlighterState;
  }
}

const HIGHLIGHT_CSS = `
::highlight(sahamati-strong) { background-color: rgba(179, 38, 30, 0.16); text-decoration: underline 2px solid #b3261e; }
::highlight(sahamati-indicative) { background-color: rgba(224, 165, 38, 0.20); text-decoration: underline 2px dashed #8a5a00; }
::highlight(sahamati-claim) { background-color: rgba(42, 58, 143, 0.10); }
::highlight(sahamati-vague) { text-decoration: underline 2px dotted #5f6b73; }
::highlight(sahamati-prelim) { background-color: rgba(46, 107, 74, 0.10); }
`;

const UI_CSS = `
:host { all: initial; }
.bar { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: 380px;
  background: #fff; color: #1b1d26; border: 1px solid #e4dfd5; border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0,0,0,.18); padding: 12px 14px; font: 13px/1.45 "Noto Sans", system-ui, sans-serif; }
.bar[hidden] { display: none; }
.title { font-weight: 700; color: #2a3a8f; margin: 0 0 4px; display: flex; justify-content: space-between; gap: 8px; }
.pill { font-size: 11px; font-weight: 600; color: #2e6b4a; border: 1px dashed #2e6b4a; border-radius: 999px; padding: 0 6px; }
details { margin: 6px 0; } summary { cursor: pointer; color: #5a5e6e; }
pre { white-space: pre-wrap; max-height: 120px; overflow: auto; background: #fbf8f3; padding: 6px; border-radius: 6px;
  font: 11px/1.4 "IBM Plex Mono", ui-monospace, monospace; margin: 4px 0 0; }
.actions { display: flex; gap: 8px; margin-top: 8px; }
button { font: inherit; border-radius: 8px; padding: 4px 10px; cursor: pointer; border: 1px solid #2a3a8f; }
button.primary { background: #2a3a8f; color: #fff; }
button.secondary { background: transparent; color: #2a3a8f; }
button:focus-visible { outline: 2px solid #2a3a8f; outline-offset: 2px; }
.close { border: none; background: none; color: #5a5e6e; padding: 0 4px; }
.tip { position: fixed; z-index: 2147483647; pointer-events: none; max-width: 340px; background: #1b1d26; color: #e8e6e1;
  border-radius: 8px; padding: 6px 8px; font: 12px/1.4 "Noto Sans", system-ui, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
.tip[hidden] { display: none; }
.tip .k { color: #a3a6b4; font-size: 11px; }
.tip code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 11px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export default defineUnlistedScript(async () => {
  if (window.__sahamatiHighlighter) {
    window.__sahamatiHighlighter.reopen();
    return;
  }

  const got = await chrome.storage.local.get('settings');
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(got.settings ?? {}) };
  const lang: Lang = resolveLang(settings.lang);
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v);
  let apiHost = settings.apiBase;
  try {
    apiHost = new URL(settings.apiBase).host;
  } catch {
    /* keep raw */
  }

  // ---- UI host (closed shadow root, outside the page's content flow)
  const host = el('div', { 'data-sahamati-ui': '' });
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = el('style');
  style.textContent = UI_CSS;
  const bar = el('div', { class: 'bar', role: 'dialog', 'aria-live': 'polite', 'aria-label': t('hl.title') });
  const tip = el('div', { class: 'tip', hidden: '', role: 'tooltip' });
  shadow.append(style, bar, tip);
  document.documentElement.append(host);

  const pageStyle = el('style', { 'data-sahamati-ui': '' });
  pageStyle.textContent = HIGHLIGHT_CSS;
  (document.head ?? document.documentElement).append(pageStyle);

  const state: HighlighterState = {
    reopen() {
      bar.hidden = false;
    },
  };
  window.__sahamatiHighlighter = state;

  // ---- text extraction
  const map: TextMap = buildTextMap(document.body);
  const nodeStart = new Map<Node, number>(map.chunks.map((c) => [c.node, c.start]));
  let hover: HoverEntry[] = [];

  function renderBar(kind: 'ask' | 'sending' | 'done' | 'failed' | 'empty', n = 0) {
    bar.replaceChildren();
    const title = el('p', { class: 'title' });
    title.append(el('span', {}, t('hl.title')));
    const close = el('button', { class: 'close', type: 'button', 'aria-label': t('hl.close') }, '×');
    close.addEventListener('click', () => (bar.hidden = true));
    title.append(close);
    bar.append(title);

    if (kind === 'empty') {
      bar.append(el('p', {}, t('hl.noText')));
      return;
    }
    if (kind === 'ask' || kind === 'sending') {
      const p = el('p', {});
      p.append(el('span', { class: 'pill' }, t('hl.tooltipPrelim')), document.createTextNode(` ${t('hl.prelim')}`));
      bar.append(p, el('p', {}, t('hl.ask', { n: map.text.length, host: apiHost })));
      const details = el('details');
      details.append(el('summary', {}, t('hl.preview')), el('pre', {}, `${map.text.slice(0, 600)}${map.text.length > 600 ? '…' : ''}`));
      bar.append(details);
      const actions = el('div', { class: 'actions' });
      const send = el('button', { class: 'primary', type: 'button' }, kind === 'sending' ? t('hl.sending') : t('hl.send'));
      send.disabled = kind === 'sending';
      send.addEventListener('click', () => void sendToServer());
      const later = el('button', { class: 'secondary', type: 'button' }, t('hl.notNow'));
      later.addEventListener('click', () => (bar.hidden = true));
      actions.append(send, later);
      bar.append(actions);
      return;
    }
    bar.append(el('p', {}, kind === 'done' ? t('hl.done', { n }) : t('hl.failed')));
  }

  function paint(result: PolicyTabResult, quotes: FindingQuote[]): number {
    const ranges: Record<Bucket, Range[]> = { strong: [], indicative: [], claim: [], vague: [], prelim: [] };
    hover = [];
    const add = (bucket: Bucket, start: number, end: number, extra: Partial<HoverEntry>) => {
      const r = rangeFor(map, start, end);
      if (!r) return;
      ranges[bucket].push(r);
      hover.push({ start, end, bucket, ...extra });
    };

    for (const q of quotes) {
      const span = findQuote(map.text, q.quote);
      if (span) add(q.status === 'confirmed_conflict' ? 'strong' : 'indicative', span[0], span[1], { quote: q });
    }
    for (const s of result.segments) {
      if (s.char_start < 0 || s.char_end > map.text.length) continue;
      if (result.kind === 'server') {
        if (s.vague) add('vague', s.char_start, s.char_end, { segment: s });
        else if (s.tuples.length) add('claim', s.char_start, s.char_end, { segment: s });
      } else {
        add(s.vague ? 'vague' : 'prelim', s.char_start, s.char_end, { segment: s });
      }
    }

    const registry = (CSS as unknown as { highlights?: Map<string, Highlight> }).highlights;
    if (registry && typeof Highlight !== 'undefined') {
      for (const b of BUCKETS) {
        registry.delete(hlName(b));
        if (ranges[b].length) registry.set(hlName(b), new Highlight(...ranges[b]));
      }
    }
    // Findings first so their tooltip wins on overlap.
    hover.sort((a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket));
    return BUCKETS.reduce((n, b) => n + ranges[b].length, 0);
  }

  async function sendToServer() {
    renderBar('sending');
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'policy:segments',
        url: location.href,
        title: document.title,
        text: map.text,
        lang: document.documentElement.lang || lang,
      })) as BgResponses['policy:segments'];
      if (res?.ok) {
        const n = paint(res.result, res.quotes);
        renderBar('done', n);
      } else renderBar('failed');
    } catch {
      renderBar('failed');
    }
  }

  // ---- tooltip
  const tupleLine = (tu: ClaimTupleView) => {
    const action = translate(lang, `action.${tu.action}` as MessageKey);
    const polarity = translate(lang, `polarity.${tu.polarity}` as MessageKey);
    return `${tu.actor} · ${action} · ${tu.data_type} · ${polarity}${tu.condition ? ` · ${tu.condition}` : ''}`;
  };

  function showTip(entry: HoverEntry, x: number, y: number) {
    tip.replaceChildren();
    if (entry.quote) {
      tip.append(el('div', { class: 'k' }, t('hl.tooltipFinding')), el('div', {}, t(entry.quote.status === 'confirmed_conflict' ? 'status.confirmed_conflict' : entry.quote.status === 'potential_conflict' ? 'status.potential_conflict' : 'status.needs_review')));
    } else if (entry.segment) {
      const s = entry.segment;
      if (s.prelimLabel) {
        tip.append(el('div', { class: 'k' }, t('hl.tooltipPrelim')), el('div', {}, t(`prelim.${s.prelimLabel}` as MessageKey)));
      } else {
        tip.append(el('div', { class: 'k' }, s.vague ? t('policy.vague') : t('finding.tuple')));
        if (!s.tuples.length) tip.append(el('div', {}, t('policy.noTuples')));
        for (const tu of s.tuples) {
          const line = el('div');
          line.append(el('code', {}, tupleLine(tu)));
          tip.append(line);
        }
      }
    }
    tip.hidden = false;
    const left = Math.min(x + 12, window.innerWidth - 360);
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.min(y + 16, window.innerHeight - 80)}px`;
  }

  type CaretDoc = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let pending = false;
  document.addEventListener(
    'mousemove',
    (e) => {
      if (pending || !hover.length) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const d = document as CaretDoc;
        let node: Node | null = null;
        let offset = 0;
        const pos = d.caretPositionFromPoint?.(e.clientX, e.clientY);
        if (pos) {
          node = pos.offsetNode;
          offset = pos.offset;
        } else {
          const r = d.caretRangeFromPoint?.(e.clientX, e.clientY);
          if (r) {
            node = r.startContainer;
            offset = r.startOffset;
          }
        }
        const start = node ? nodeStart.get(node) : undefined;
        if (start === undefined) {
          tip.hidden = true;
          return;
        }
        const at = start + offset;
        const entry = hover.find((h) => at >= h.start && at < h.end);
        if (entry) showTip(entry, e.clientX, e.clientY);
        else tip.hidden = true;
      });
    },
    { passive: true },
  );
  document.addEventListener('scroll', () => (tip.hidden = true), { passive: true, capture: true });

  // ---- run: on-device preliminary first, then offer the server analysis.
  if (!map.text.trim()) {
    renderBar('empty');
    return;
  }
  renderBar('ask');
  try {
    const pre = (await chrome.runtime.sendMessage({
      type: 'policy:preliminary',
      url: location.href,
      title: document.title,
      text: map.text,
    })) as BgResponses['policy:preliminary'];
    if (pre?.result) paint(pre.result, pre.quotes);
  } catch {
    // Preliminary highlights are optional.
  }
});
