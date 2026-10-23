import type { Coverage, Report, SourceName } from '@sahamati/contracts';
import { useI18n } from './I18n';

const ORDER: SourceName[] = ['policy', 'data_safety', 'apk'];

export function CoverageStrip({ coverage }: { coverage: Report['coverage'] }) {
  const { t } = useI18n();
  const partial = ORDER.some((s) => coverage[s] !== 'ok');
  return (
    <section className="card" aria-labelledby="cov-h">
      <h2 id="cov-h" className="h2">{t('coverage.title')}</h2>
      <ul className="coverage">
        {ORDER.map((s) => {
          const status: Coverage = coverage[s];
          return (
            <li key={s} className={`cov cov-${status === 'ok' ? 'ok' : 'partial'}`}>
              <span className="cov-dot" aria-hidden="true">{status === 'ok' ? '●' : '○'}</span>
              <span className="cov-name">{t(`coverage.source.${s}`)}</span>
              <span className="cov-status">{t(`coverage.status.${status}`)}</span>
            </li>
          );
        })}
      </ul>
      {partial && <p className="muted small">{t('coverage.partial')}</p>}
    </section>
  );
}
