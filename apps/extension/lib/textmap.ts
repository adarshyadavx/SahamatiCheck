/**
 * Visible text of a page with a map back to DOM text nodes, so server offsets
 * (char_start/char_end into the text we sent) can become DOM Ranges without
 * mutating the page.
 */
export interface TextChunk {
  node: Text;
  start: number;
  end: number;
}

export interface TextMap {
  text: string;
  chunks: TextChunk[];
  truncated: boolean;
}

// Lower-case: some selector engines treat upper-case tag selectors inconsistently.
const SKIP_SELECTOR = 'script,style,noscript,template,svg,canvas,iframe,textarea,input,select,button';
const BLOCK = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
  'MAIN', 'NAV', 'ASIDE', 'TD', 'TH', 'TR', 'TABLE', 'DT', 'DD', 'DL', 'BLOCKQUOTE', 'PRE', 'FORM', 'FIGURE', 'BODY',
]);
export const MAX_POLICY_CHARS = 200_000;

function blockOf(el: Element | null): Element | null {
  let cur = el;
  while (cur && !BLOCK.has(cur.tagName.toUpperCase())) cur = cur.parentElement;
  return cur;
}

function isHidden(el: Element, cache: Map<Element, boolean>): boolean {
  const hit = cache.get(el);
  if (hit !== undefined) return hit;
  let hidden = false;
  if (el.closest('[hidden],[aria-hidden="true"],[data-sahamati-ui]')) hidden = true;
  else {
    const anyEl = el as Element & { checkVisibility?: () => boolean };
    if (typeof anyEl.checkVisibility === 'function') hidden = !anyEl.checkVisibility();
  }
  cache.set(el, hidden);
  return hidden;
}

export function buildTextMap(root: Element, maxChars = MAX_POLICY_CHARS): TextMap {
  const doc = root.ownerDocument;
  const hiddenCache = new Map<Element, boolean>();
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return 2;
      if (parent.closest(SKIP_SELECTOR)) return 2;
      if (!(node.nodeValue ?? '').trim()) return 3;
      if (isHidden(parent, hiddenCache)) return 2;
      return 1;
    },
  });

  let text = '';
  const chunks: TextChunk[] = [];
  let lastBlock: Element | null = null;
  let truncated = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const value = node.nodeValue ?? '';
    const block = blockOf(node.parentElement);
    // Block boundaries become line breaks so headings do not run into sentences.
    if (chunks.length && block !== lastBlock) text += '\n';
    if (text.length + value.length > maxChars) {
      truncated = true;
      break;
    }
    chunks.push({ node, start: text.length, end: text.length + value.length });
    text += value;
    lastBlock = block;
  }
  return { text, chunks, truncated };
}

function locate(map: TextMap, offset: number, preferEnd: boolean): { node: Text; offset: number } | null {
  // Binary search for the chunk containing offset.
  let lo = 0;
  let hi = map.chunks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = map.chunks[mid];
    if (offset < c.start) hi = mid - 1;
    else if (offset > c.end || (offset === c.end && !preferEnd)) lo = mid + 1;
    else return { node: c.node, offset: offset - c.start };
  }
  // Offset falls in a separator: snap to the neighbouring chunk.
  const c = preferEnd ? map.chunks[Math.min(hi, map.chunks.length - 1)] : map.chunks[Math.max(lo, 0)];
  if (!c) return null;
  return preferEnd ? { node: c.node, offset: c.end - c.start } : { node: c.node, offset: 0 };
}

export function rangeFor(map: TextMap, start: number, end: number): Range | null {
  if (!map.chunks.length || end <= start) return null;
  const a = locate(map, Math.max(0, start), false);
  const b = locate(map, Math.min(end, map.text.length), true);
  if (!a || !b) return null;
  const range = a.node.ownerDocument.createRange();
  try {
    range.setStart(a.node, Math.min(a.offset, a.node.length));
    range.setEnd(b.node, Math.min(b.offset, b.node.length));
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

/** Global offset of a DOM position (e.g. from caretPositionFromPoint). */
export function offsetOf(map: TextMap, node: Node, offset: number): number | null {
  for (const c of map.chunks) if (c.node === node) return c.start + offset;
  return null;
}

/**
 * Find a quote inside the mapped text, tolerating whitespace differences.
 * Returns [start, end) offsets or null.
 */
export function findQuote(text: string, quote: string): [number, number] | null {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const m = new RegExp(pattern, 'i').exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}
