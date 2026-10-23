import type { Finding } from '@sahamati/contracts';
import { MARKER_ATTR, type Placement } from './anchoring';
import { findingStatus, topStatus } from './card';

export interface MarkerOptions {
  label: (p: Placement) => string;
  onActivate: (finding: Finding) => void;
}

/** Marker colour comes from status. Red is used only for confirmed_conflict. */
const STATUS_COLOUR: Record<Finding['status'], string> = {
  confirmed_conflict: '#b3261e',
  potential_conflict: '#a3470a',
  needs_review: '#8a5a00',
};

/** Shape carries the status too: filled = difference found, outlined = possible, dashed = needs a closer look. */
function sealSvg(status: Finding['status']): string {
  const colour = STATUS_COLOUR[status];
  const fill = status === 'confirmed_conflict' ? colour : 'none';
  const dash = status === 'needs_review' ? ' stroke-dasharray="2.5 2"' : '';
  const glyph =
    status === 'confirmed_conflict'
      ? '<path d="M10 6.2v5M10 13.4v.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
      : status === 'potential_conflict'
        ? '<path d="M10 6.2v5M10 13.4v.4" fill="none" stroke="' + colour + '" stroke-width="2" stroke-linecap="round"/>'
        : '<path d="M8.3 8a1.8 1.8 0 113 1.2c-.7.6-1.3.9-1.3 1.9M10 13.4v.4" fill="none" stroke="' + colour + '" stroke-width="1.7" stroke-linecap="round"/>';
  return `<svg viewBox="0 0 20 22" width="18" height="18" aria-hidden="true" focusable="false">
    <path d="M10 1.5l2.1 1.6 2.6-.3 1 2.4 2.4 1-.3 2.6L19.4 11l-1.6 2.1.3 2.6-2.4 1-1 2.4-2.6-.3L10 20.4l-2.1-1.6-2.6.3-1-2.4-2.4-1 .3-2.6L.6 11l1.6-2.1-.3-2.6 2.4-1 1-2.4 2.6.3z"
      fill="${fill}" stroke="${colour}" stroke-width="1.6"${dash}/>
    ${glyph}
  </svg>`;
}

const STYLE = `
  :host { all: initial; display: inline-flex; vertical-align: middle; margin-inline-start: 6px; }
  button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;
    border-radius: 999px; padding: 1px 4px; font: 600 11px/1.2 system-ui, sans-serif; color: #1b1d26; }
  button:hover { background: rgba(42,58,143,.10); }
  button:focus-visible { outline: 2px solid #2a3a8f; outline-offset: 1px; }
  .n { min-width: 10px; }
`;

/** Remove every marker we mounted under root. */
export function clearMarkers(root: ParentNode): void {
  root.querySelectorAll(`[${MARKER_ATTR}]`).forEach((el) => el.remove());
}

/** Mount one Shadow-DOM marker per placement. Idempotent per text node. */
export function mountMarkers(placements: Placement[], opts: MarkerOptions): HTMLElement[] {
  const hosts: HTMLElement[] = [];
  for (const p of placements) {
    const node = p.textNode;
    const doc = node.ownerDocument;
    if (!doc || !node.parentNode) continue;
    const next = node.nextSibling;
    if (next instanceof HTMLElement && next.hasAttribute(MARKER_ATTR)) {
      next.remove();
    }

    const status = topStatus(p.findings);
    const strongest = p.findings.find((f) => findingStatus(f) === status) ?? p.findings[0];
    const host = doc.createElement('span');
    host.setAttribute(MARKER_ATTR, strongest.id);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = STYLE;
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', opts.label(p));
    button.title = opts.label(p);
    button.innerHTML = sealSvg(status);
    if (p.findings.length > 1) {
      const n = doc.createElement('span');
      n.className = 'n';
      n.textContent = String(p.findings.length);
      button.append(n);
    }
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      opts.onActivate(strongest);
    });
    shadow.append(style, button);
    node.parentNode.insertBefore(host, node.nextSibling);
    hosts.push(host);
  }
  return hosts;
}
