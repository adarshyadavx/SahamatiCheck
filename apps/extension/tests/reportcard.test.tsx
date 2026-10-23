import type { CardColor, Finding, Report } from '@sahamati/contracts';
import sample from '@sahamati/contracts/fixtures/report.sample.json';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FindingCard } from '../components/FindingCard';
import { I18nProvider } from '../components/I18n';
import { ReportCardView, RulesNotEvaluated } from '../components/ReportCardView';
import { StatusIcon } from '../components/StatusIcon';
import {
  confidenceBand,
  findingStatus,
  groupFindings,
  hasCard,
  limitationText,
  reasonText,
  topStatus,
  unplacedFindings,
} from '../lib/card';
import { demoReport } from '../lib/demo';
import { translator, type Lang } from '../lib/i18n';
import { findDataSafetyAnchors, placeFindings } from '../lib/anchoring';
import { clearMarkers, mountMarkers } from '../lib/markers';
import { confirmedCount } from '../lib/reportService';
import en from '../locales/en.json';
import hi from '../locales/hi.json';

const base = sample as Report;
const clone = (): Report => structuredClone(base);
const noFeedback = async () => true;

function render(report: Report, opts: { lang?: Lang; open?: string[] } = {}) {
  return renderToStaticMarkup(
    <I18nProvider lang={opts.lang ?? 'en'}>
      <ReportCardView report={report} initialOpen={opts.open} canFeedback onFeedback={noFeedback} />
    </I18nProvider>,
  );
}

/** The <li> markup of one card row. */
function row(html: string, id: string): string {
  const start = html.indexOf(`id="cat-${id}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('<li id="cat-', start);
  const end = next === -1 ? html.indexOf('</ol>', start) : next;
  return html.slice(start, end);
}

const CATS = ['location', 'contacts', 'photos_files', 'camera_mic', 'messages_calls', 'money_payments', 'identity', 'health', 'ads_tracking', 'account_profile'];
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe('report card from the sample fixture', () => {
  it('shows the five answers first, then the ten rows in order, with label and note', () => {
    const html = render(clone());
    const answersAt = html.indexOf('id="answers-h"');
    const catsAt = html.indexOf('id="cats-h"');
    expect(answersAt).toBeGreaterThan(-1);
    expect(catsAt).toBeGreaterThan(answersAt);
    for (const a of base.card.answers) expect(html).toContain(a.text);
    expect(count(html, 'class="answer"')).toBe(5);

    const positions = CATS.map((id) => html.indexOf(`id="cat-${id}"`));
    expect(positions.every((p) => p > catsAt)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const cat of base.card.categories) {
      const r = row(html, cat.id);
      expect(r).toContain(`data-color="${cat.color}"`);
      expect(r).toContain(cat.note.replace(/'/g, '&#x27;'));
    }
    expect(row(html, 'ads_tracking')).toContain('Difference found');
    expect(row(html, 'location')).toContain('Possible difference');
    expect(row(html, 'camera_mic')).toContain('Unclear, needs a closer look');
    expect(row(html, 'health')).toContain('Couldn&#x27;t check');
  });

  it('renders every row in Hindi with real Hindi labels', () => {
    const html = render(clone(), { lang: 'hi' });
    expect(row(html, 'ads_tracking')).toContain('अंतर मिला');
    expect(row(html, 'ads_tracking')).toContain('विज्ञापन और ट्रैकिंग');
    expect(row(html, 'health')).toContain('जाँच नहीं हो सकी');
    expect(html).toContain('पाँच त्वरित उत्तर');
    expect(html).toContain('जो नियम जाँचे नहीं गए');
  });

  it('has no overall colour, score or grade', () => {
    const html = render(clone(), { open: CATS });
    expect(count(html, 'data-color=')).toBe(10);
    // The intro sentence says there is none; every other piece of text must not show one.
    const body = html.replace(/<p class="muted small">Each row is checked on its own[^<]*<\/p>/, '');
    expect(body).not.toContain('Each row is checked');
    expect(body.toLowerCase()).not.toMatch(/\bscore\b|\bgrade\b|\/100|overall (result|rating)/);
  });

  it('gives each colour its own icon, so colour is never the only signal', () => {
    const colours: CardColor[] = ['red', 'orange', 'yellow', 'grey', 'green'];
    const shapes = colours.map((c) => renderToStaticMarkup(<StatusIcon color={c} />).replace(/status-icon[\w-]*/g, '').replace(/var\(--[\w-]+\)/g, ''));
    expect(new Set(shapes).size).toBe(5);
    const html = render(clone());
    for (const cat of base.card.categories) expect(row(html, cat.id)).toMatch(/status-icon/);
  });

  it('the offline demo fallback has the new shape', () => {
    const d = demoReport();
    expect(hasCard(d)).toBe(true);
    expect(d.card.categories).toHaveLength(10);
    expect(d.card.answers).toHaveLength(5);
    expect(d.findings.every((f) => f.status && f.user_category)).toBe(true);
    expect(d.indicators.length).toBeGreaterThan(0);
    expect(d.rule_runs.length).toBeGreaterThan(0);
    expect(Object.keys(d.status_counts).sort()).toEqual(['confirmed_conflict', 'inconclusive', 'needs_review', 'no_issue_detected', 'potential_conflict']);
  });
});

describe('grey and green are never shown as safe', () => {
  it('uses the exact approved labels and no reassuring wording', () => {
    const r = clone();
    const health = r.card.categories.find((c) => c.id === 'health')!;
    health.color = 'green';
    health.status = 'no_issue_detected';
    health.note = 'Nothing found in the sources we could read.';
    for (const lang of ['en', 'hi'] as Lang[]) {
      const html = render(r, { lang, open: ['health', 'identity'] });
      const green = row(html, 'health');
      const grey = row(html, 'identity');
      expect(green).toContain(lang === 'en' ? 'No issue found in what we could check' : 'जो हम जाँच सके, उसमें कोई समस्या नहीं मिली');
      expect(grey).toContain(lang === 'en' ? 'Couldn&#x27;t check' : 'जाँच नहीं हो सकी');
      for (const r2 of [green, grey]) {
        expect(r2.toLowerCase()).not.toMatch(/\bsafe\b|compliant|\bpassed\b|all clear|no risk|सुरक्षित है|अनुपालन/);
      }
    }
    // the green drill-down says it is not a guarantee
    expect(row(render(r, { open: ['health'] }), 'health')).toContain('not a guarantee');
    // the grey drill-down points at the rules that could not run
    expect(row(render(r, { open: ['identity'] }), 'identity')).toContain('Rules not evaluated');
  });

  it('locale strings for green and grey avoid "safe"', () => {
    for (const cat of [en, hi] as Record<string, string>[]) {
      for (const k of ['color.green', 'color.grey', 'why.empty.green', 'why.empty.grey']) {
        expect(cat[k].toLowerCase()).not.toMatch(/\bsafe\b|compliant/);
      }
    }
  });
});

describe('red only for a confirmed conflict', () => {
  it('shows red only on rows and findings whose status is confirmed_conflict', () => {
    const html = render(clone(), { open: CATS });
    for (const cat of base.card.categories) {
      const r = row(html, cat.id);
      expect(r.includes('cat-red')).toBe(cat.status === 'confirmed_conflict');
    }
    expect(count(html, 'cat-red')).toBe(1);
    // potential findings never carry the confirmed class
    expect(html).toContain('finding-s-confirmed_conflict');
    expect(html).toContain('finding-s-potential_conflict');
    for (const f of base.findings) {
      const at = html.indexOf(`id="finding-${f.id}"`);
      const tag = html.slice(html.lastIndexOf('<article', at), html.indexOf('>', at));
      expect(tag.includes('finding-s-confirmed_conflict')).toBe(f.status === 'confirmed_conflict');
    }
  });

  it('does not recompute: a row keeps the colour the API gave it', () => {
    const r = clone();
    r.card.categories.find((c) => c.id === 'ads_tracking')!.color = 'orange';
    r.card.categories.find((c) => c.id === 'ads_tracking')!.status = 'potential_conflict';
    expect(render(r)).not.toContain('cat-red');
  });

  it('shows a finding with no status (an old cached report) as needs a closer look, never red', () => {
    const f = { ...base.findings[0] } as Partial<Finding>;
    delete f.status;
    expect(findingStatus(f as Finding)).toBe('needs_review');
    const html = renderToStaticMarkup(
      <I18nProvider lang="en">
        <FindingCard finding={f as Finding} canFeedback={false} onFeedback={noFeedback} />
      </I18nProvider>,
    );
    expect(html).toContain('finding-s-needs_review');
    expect(html).not.toContain('finding-s-confirmed_conflict');
  });

  it('colours in-page markers by status', () => {
    document.body.innerHTML = '<div><h2>Data shared</h2><div><span>Device or other IDs</span><span>Optional</span></div></div>';
    const r = clone();
    const f = { ...r.findings[0], status: 'potential_conflict' as const };
    const hosts = mountMarkers(
      [{ findings: [f], textNode: document.querySelector('span')!.firstChild as Text, row: null, term: 'Device or other IDs', viaSection: false }],
      { label: () => 'm', onActivate: () => undefined },
    );
    const svg = hosts[0].shadowRoot!.innerHTML;
    expect(svg).not.toContain('#b3261e');
    expect(svg).toContain('#a3470a');
    clearMarkers(document);

    const hosts2 = mountMarkers(
      [{ findings: [{ ...f, status: 'confirmed_conflict' }], textNode: document.querySelector('span')!.firstChild as Text, row: null, term: 'x', viaSection: false }],
      { label: () => 'm', onActivate: () => undefined },
    );
    expect(hosts2[0].shadowRoot!.innerHTML).toContain('#b3261e');
    clearMarkers(document);
    void [findDataSafetyAnchors, placeFindings];
  });

  it('badge counts only confirmed conflicts', () => {
    expect(confirmedCount(base)).toBe(1);
    expect(topStatus([{ status: 'potential_conflict' }, { status: 'needs_review' }])).toBe('potential_conflict');
  });
});

describe('drill-down', () => {
  it('shows both evidence sides side by side, the confidence band and the benign explanations', () => {
    const html = render(clone(), { open: ['ads_tracking'] });
    const r = row(html, 'ads_tracking');
    const sides = r.slice(r.indexOf('class="sides"'));
    expect(sides.indexOf('We never share your personal information')).toBeGreaterThan(-1);
    expect(sides.indexOf('Device or other IDs — Shared')).toBeGreaterThan(sides.indexOf('We never share'));
    expect(count(r, 'class="side side-')).toBe(2);
    expect(r).toContain('Confidence: Strong (0.91)');
    expect(r).toContain('Why this might be fine');
    expect(r).toContain('Report a mistake');
  });

  it('renders indicators as a separate "Worth a closer look" list, not as findings', () => {
    const html = render(clone(), { open: ['ads_tracking', 'camera_mic'] });
    const cam = row(html, 'camera_mic');
    expect(cam).toContain('Worth a closer look');
    expect(cam).toContain('The app can use the camera. The policy does not say why.');
    expect(cam).not.toContain('class="card finding');
    expect(cam).not.toContain('<h4 class="h3">Findings</h4>');
    const ads = row(html, 'ads_tracking');
    expect(ads).toContain('The app can read the advertising ID.');
    expect(ads.indexOf('Worth a closer look')).toBeGreaterThan(ads.lastIndexOf('class="card finding'));
  });

  it('lists inconclusive rules with a human sentence for the reason code', () => {
    const html = render(clone());
    const sec = html.slice(html.indexOf('id="rules-h"'));
    expect(sec).toContain('Rules not evaluated');
    expect(sec).toContain('Tracking before consent');
    expect(sec).toContain('Needs the app to be run and watched');
    expect(sec).toContain('Account deletion functionality');
    expect(sec).toContain('Needs a test account');
    expect(sec).not.toContain('Collection contradiction'); // ran: no_issue_detected
    expect(sec).not.toContain('runtime_evidence_unavailable'); // code is translated, not shown
    expect(count(sec, '<li>')).toBe(4);
  });

  it('falls back to a generic sentence for unknown reason codes and says so when nothing was skipped', () => {
    const t = translator('en');
    expect(reasonText(t, 'brand_new_reason')).toContain('brand_new_reason');
    expect(reasonText(t, undefined)).toBe('This check could not run.');
    const html = renderToStaticMarkup(
      <I18nProvider lang="en">
        <RulesNotEvaluated runs={[{ rule_id: 'X1', name: 'Odd rule', family: 'AI', phase: 3, status: 'inconclusive', reason: 'brand_new_reason' }]} />
      </I18nProvider>,
    );
    expect(html).toContain('brand_new_reason');
    const none = renderToStaticMarkup(
      <I18nProvider lang="en">
        <RulesNotEvaluated runs={base.rule_runs.filter((r) => r.status !== 'inconclusive')} />
      </I18nProvider>,
    );
    expect(none).toContain('No checks were skipped.');
  });
});

describe('limitation codes', () => {
  it('renders the known codes through i18n in both languages', () => {
    for (const lang of ['en', 'hi'] as Lang[]) {
      const t = translator(lang);
      for (const code of ['permission_only', 'sdk_presence_only', 'runtime_not_observed', 'confidence_below_confirm_threshold']) {
        const text = limitationText(t, code);
        expect(text).toBe((lang === 'en' ? en : hi)[`limitation.${code}` as keyof typeof en]);
        expect(text).not.toContain(code);
      }
    }
    expect(limitationText(translator('hi'), 'permission_only')).toMatch(/[ऀ-ॿ]/);
  });

  it('falls back to a generic sentence naming an unknown code', () => {
    const en1 = limitationText(translator('en'), 'some_future_code');
    expect(en1).toBe('Another limit was noted by the checker (some_future_code).');
    expect(limitationText(translator('hi'), 'some_future_code')).toMatch(/some_future_code/);
    const f = { ...base.findings[2], limitations: ['permission_only', 'some_future_code'] };
    const html = renderToStaticMarkup(
      <I18nProvider lang="en">
        <FindingCard finding={f} canFeedback={false} onFeedback={noFeedback} />
      </I18nProvider>,
    );
    expect(html).toContain('Based on a permission only.');
    expect(html).toContain('some_future_code');
    expect(html).toContain('Limits of this finding');
  });
});

describe('grouped findings', () => {
  function withGroupMate(): Report {
    const r = clone();
    const mate: Finding = {
      ...structuredClone(r.findings[0]),
      id: 'f_bm_ads',
      class: 'behavioural_mismatch',
      tier: 'indicative',
      rule_id: 'BM-02',
      summary: 'The app package includes an advertising SDK that the policy does not mention.',
      status: 'potential_conflict',
      confidence: 0.7,
      limitations: ['sdk_presence_only'],
      group_id: 'g_ads',
    };
    r.findings.push(mate);
    // The API lists the mate only on the row's own list once; the other row must not repeat it.
    r.card.categories.find((c) => c.id === 'ads_tracking')!.finding_ids = ['f_dm_01', 'f_bm_ads'];
    return r;
  }

  it('groups by group_id with the most serious status as the primary', () => {
    const r = withGroupMate();
    const groups = groupFindings([r.findings[3], r.findings[0]]);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.id).toBe('f_dm_01');
    expect(groups[0].related.map((f) => f.id)).toEqual(['f_bm_ads']);
  });

  it('also groups through related_finding_ids', () => {
    const r = clone();
    r.findings[0] = { ...r.findings[0], group_id: undefined, related_finding_ids: ['f_bm_01'] };
    r.findings[2] = { ...r.findings[2], group_id: undefined };
    const groups = groupFindings(r.findings);
    expect(groups.map((g) => [g.primary.id, g.related.map((f) => f.id)])).toEqual([
      ['f_dm_01', ['f_bm_01']],
      ['f_ic_01', []],
    ]);
  });

  it('shows each finding in a group once, with the related one nested', () => {
    const r = withGroupMate();
    const html = render(r, { open: CATS });
    for (const f of r.findings) expect(count(html, `id="finding-${f.id}"`)).toBe(1);
    expect(count(html, r.findings[3].summary)).toBe(1);
    const ads = row(html, 'ads_tracking');
    const relatedAt = ads.indexOf('class="related"');
    expect(relatedAt).toBeGreaterThan(ads.indexOf('id="finding-f_dm_01"'));
    expect(ads.indexOf('id="finding-f_bm_ads"')).toBeGreaterThan(relatedAt);
    expect(ads).toContain('Related to the finding above');
    expect(count(ads, 'class="finding-group"')).toBe(1);
  });

  it('pulls a group mate into the row even when the API lists only one id there', () => {
    const r = withGroupMate();
    r.card.categories.find((c) => c.id === 'ads_tracking')!.finding_ids = ['f_dm_01'];
    const html = render(r, { open: ['ads_tracking'] });
    expect(count(html, 'id="finding-f_bm_ads"')).toBe(1);
    expect(unplacedFindings(r)).toEqual([]);
  });

  it('does not drop a finding that no row lists', () => {
    const r = clone();
    r.card.categories.forEach((c) => (c.finding_ids = []));
    const html = render(r);
    expect(html).toContain('Other findings');
    for (const f of r.findings) expect(count(html, `id="finding-${f.id}"`)).toBe(1);
  });
});

describe('interaction', () => {
  let host: HTMLElement | null = null;
  afterEach(() => {
    host?.remove();
    host = null;
  });

  async function mount(report: Report, onFeedback: (id: string) => Promise<boolean>) {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <I18nProvider lang="en">
          <ReportCardView report={report} canFeedback onFeedback={onFeedback} />
        </I18nProvider>,
      );
    });
    return host;
  }

  it('opens a row with "See why" and sends "Report a mistake" for that finding', async () => {
    const onFeedback = vi.fn(async () => true);
    const el = await mount(clone(), onFeedback);
    const li = el.querySelector('#cat-ads_tracking')!;
    expect(li.querySelector('.why')).toBeNull();
    const toggle = li.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(li.querySelector('.why')).not.toBeNull();
    const report = [...li.querySelectorAll('button')].find((b) => b.textContent === 'Report a mistake') as HTMLButtonElement;
    await act(async () => report.click());
    expect(onFeedback).toHaveBeenCalledWith('f_dm_01');
    expect(li.textContent).toContain('Thank you');
    await act(async () => toggle.click());
    expect(li.querySelector('.why')).toBeNull();
  });
});

describe('confidence bands', () => {
  it('uses the backend confirm threshold for strong', () => {
    expect(confidenceBand(0.849)).toBe('moderate');
    expect(confidenceBand(0.85)).toBe('strong');
    expect(confidenceBand(0.4)).toBe('weak');
  });
});
