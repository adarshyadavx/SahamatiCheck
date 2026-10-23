import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Report } from '@sahamati/contracts';
import sample from '@sahamati/contracts/fixtures/report.sample.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findDataSafetyAnchors, findingTerms, placeFindings, preferredSection, MARKER_ATTR } from '../lib/anchoring';
import { clearMarkers, mountMarkers } from '../lib/markers';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'fixtures/play-datasafety.html'), 'utf8');
const report = sample as Report;

function load() {
  document.open();
  document.write(html);
  document.close();
}

describe('data-safety anchoring on a fabricated Play page', () => {
  beforeEach(load);

  it('finds rows by vocabulary text only, ignoring scripts and prose', () => {
    const { anchors, sections } = findDataSafetyAnchors(document.body);
    const terms = anchors.map((a) => a.term);
    expect(terms).toEqual(
      expect.arrayContaining([
        'Device or other IDs',
        'Location',
        'Precise location',
        'Personal info',
        'Name',
        'Email address',
        'Phone number',
        'Financial info',
        'User payment info',
        'App info and performance',
        'Crash logs',
      ]),
    );
    // The intro paragraph mentions "Location, Contacts and Device or other IDs" inside
    // a sentence; that must not anchor. Contacts is not listed on the page at all.
    expect(terms).not.toContain('Contacts');
    expect(anchors.every((a) => a.label.tagName !== 'SCRIPT')).toBe(true);
    expect(sections.map((s) => s.kind)).toEqual(['shared', 'collected', 'security']);
  });

  it('works without relying on any CSS class name', () => {
    document.querySelectorAll('[class]').forEach((el) => el.setAttribute('class', `r${Math.random().toString(36).slice(2)}`));
    const { anchors } = findDataSafetyAnchors(document.body);
    expect(anchors.length).toBeGreaterThanOrEqual(11);
  });

  it('assigns each anchor to its section', () => {
    const { anchors } = findDataSafetyAnchors(document.body);
    const ids = anchors.filter((a) => a.term === 'Device or other IDs');
    expect(ids.length).toBe(3);
    expect(ids.every((a) => a.section === 'shared')).toBe(true);
    expect(anchors.find((a) => a.term === 'Precise location')?.section).toBe('collected');
  });

  it('places the sample findings on the matching rows', () => {
    const scan = findDataSafetyAnchors(document.body);
    const placements = placeFindings(report, scan);
    const byFinding = new Map(placements.flatMap((p) => p.findings.map((f) => [f.id, p] as const)));

    const dm = byFinding.get('f_dm_01');
    expect(dm?.term).toBe('Device or other IDs');
    expect(dm?.viaSection).toBe(false);
    expect(dm?.textNode.parentElement?.nextElementSibling?.textContent).toBe('Optional');

    const ic = byFinding.get('f_ic_01');
    expect(ic?.term).toBe('Precise location');

    // "Contacts — Not collected" has no row, so it goes next to the "Data collected" heading.
    const bm = byFinding.get('f_bm_01');
    expect(bm?.viaSection).toBe(true);
    expect(bm?.textNode.nodeValue).toBe('Data collected');
  });

  it('derives terms and sections from the finding evidence', () => {
    const dm = report.findings.find((f) => f.id === 'f_dm_01')!;
    expect(findingTerms(dm)[0]).toBe('Device or other IDs');
    expect(preferredSection(dm)).toBe('shared');
    const bm = report.findings.find((f) => f.id === 'f_bm_01')!;
    expect(preferredSection(bm)).toBe('collected');
  });

  it('mounts Shadow-DOM markers next to rows and clears them again', () => {
    const scan = findDataSafetyAnchors(document.body);
    const onActivate = vi.fn();
    const hosts = mountMarkers(placeFindings(report, scan), { label: (p) => `marker ${p.term}`, onActivate });
    expect(hosts.length).toBe(3);
    expect(document.querySelectorAll(`[${MARKER_ATTR}]`).length).toBe(3);
    const button = hosts[0].shadowRoot!.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toMatch(/^marker /);
    button.click();
    expect(onActivate).toHaveBeenCalledTimes(1);

    // Re-scanning ignores our own markers and remounting does not duplicate them.
    const again = findDataSafetyAnchors(document.body);
    mountMarkers(placeFindings(report, again), { label: () => 'm', onActivate });
    expect(document.querySelectorAll(`[${MARKER_ATTR}]`).length).toBe(3);

    clearMarkers(document);
    expect(document.querySelectorAll(`[${MARKER_ATTR}]`).length).toBe(0);
  });

  it('degrades quietly on a page with no data-safety section', () => {
    document.body.innerHTML = '<div>Nothing to see here</div>';
    const scan = findDataSafetyAnchors(document.body);
    expect(scan.anchors).toEqual([]);
    expect(placeFindings(report, scan)).toEqual([]);
  });
});
