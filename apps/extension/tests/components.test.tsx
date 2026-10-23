import type { Report } from '@sahamati/contracts';
import sample from '@sahamati/contracts/fixtures/report.sample.json';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoverageStrip } from '../components/CoverageStrip';
import { DemoBanner, Disclaimer } from '../components/Disclaimer';
import { FindingCard } from '../components/FindingCard';
import { GapList } from '../components/GapList';
import { I18nProvider } from '../components/I18n';
import { TierCounts } from '../components/TierCounts';
import { confidenceBand } from '../lib/card';
import type { Lang } from '../lib/i18n';

const report = sample as Report;

function renderReport(lang: Lang) {
  return renderToStaticMarkup(
    <I18nProvider lang={lang}>
      <DemoBanner otherPackage="in.example.other" />
      <CoverageStrip coverage={report.coverage} />
      <TierCounts summary={report.summary} />
      {report.findings.map((f) => (
        <FindingCard key={f.id} finding={f} canFeedback={false} onFeedback={async () => true} />
      ))}
      <GapList gaps={report.disclosure_gaps} />
      <Disclaimer />
    </I18nProvider>,
  );
}

describe('report components', () => {
  it('render the sample report with verbatim quotes from both sides', () => {
    const html = renderReport('en');
    expect(html).toContain('Demo data');
    expect(html).toContain('We never share your personal information with third parties.');
    expect(html).toContain('Device or other IDs — Shared — Advertising or marketing');
    expect(html).toContain('android.permission.READ_CONTACTS');
    expect(html).toContain('These appear inconsistent.');
    expect(html).toContain('Not mentioned anywhere');
    expect(html).toContain('android.permission.CAMERA');
    expect(html).toContain('Why this might be fine');
    expect(html).toContain('#:~:text=We%20never%20share');
  });

  it('shows no score or grade', () => {
    const html = renderReport('en').toLowerCase();
    expect(html).not.toMatch(/\bscore:|\/100|grade:/);
  });

  it('renders in Hindi', () => {
    const html = renderReport('hi');
    expect(html).toContain('डेमो डेटा');
    expect(html).toContain('ये आपस में असंगत प्रतीत होते हैं।');
    expect(html).toContain('कहीं उल्लेख नहीं');
  });

  it('maps confidence to strong, moderate and weak bands', () => {
    expect(confidenceBand(0.91)).toBe('strong');
    expect(confidenceBand(0.85)).toBe('strong');
    expect(confidenceBand(0.84)).toBe('moderate');
    expect(confidenceBand(0.7)).toBe('moderate');
    expect(confidenceBand(0.62)).toBe('weak');
  });
});
