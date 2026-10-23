import type { DisclosureGap } from '@sahamati/contracts';
import { formatDate } from '../lib/i18n';
import { Breadcrumbs } from './Breadcrumbs';
import { useI18n } from './I18n';
import { useOntologyLabel } from './Ontology';
import { CLASS_VAR, Seal } from './TierBadge';

/** "Not mentioned anywhere": kept apart from findings; silence is not a denial. */
export function GapList({ gaps }: { gaps: DisclosureGap[] }) {
  const { t, lang } = useI18n();
  const label = useOntologyLabel();
  return (
    <section className="card gaps" aria-labelledby="gaps-h">
      <h2 id="gaps-h" className="h2">
        <Seal tier="not_mentioned" colour={CLASS_VAR.disclosure_gap} /> {t('gaps.title')}
      </h2>
      <p className="muted small">{t('gaps.intro')}</p>
      {gaps.length === 0 ? (
        <p className="small">{t('gaps.none')}</p>
      ) : (
        <ul className="gap-list">
          {gaps.map((g) => (
            <li key={g.id}>
              <p className="h3">{label(g.data_type)}</p>
              <p className="small">
                {t(`source.${g.source}`)}:{' '}
                <span className="mono">{g.evidence.permission ?? g.evidence.sdk ?? g.evidence.label ?? ''}</span>
              </p>
              <Breadcrumbs path={g.ontology_path} />
              <p className="muted small">{t('finding.captured', { date: formatDate(g.evidence.captured_at, lang) })}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
