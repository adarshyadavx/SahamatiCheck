import type { ReportSummary } from '@sahamati/contracts';
import { useI18n } from './I18n';
import { Seal } from './TierBadge';

/** Tier counts only. There is deliberately no score or grade (CLAUDE.md rule 3). */
export function TierCounts({ summary }: { summary: ReportSummary }) {
  const { t } = useI18n();
  return (
    <section className="card" aria-labelledby="counts-h">
      <h2 id="counts-h" className="h2">{t('counts.title')}</h2>
      <p className="agree">
        <strong className="agree-n">{summary.agree_types}</strong> <span>{t('counts.agree')}</span>
      </p>
      <dl className="counts">
        <div>
          <dt><Seal tier="strong" colour="var(--ink)" size={14} /> {t('counts.strong')}</dt>
          <dd>{summary.strong}</dd>
        </div>
        <div>
          <dt><Seal tier="indicative" colour="var(--ink)" size={14} /> {t('counts.indicative')}</dt>
          <dd>{summary.indicative}</dd>
        </div>
        <div>
          <dt><Seal tier="not_mentioned" colour="var(--ink)" size={14} /> {t('counts.not_mentioned')}</dt>
          <dd>{summary.not_mentioned}</dd>
        </div>
      </dl>
      <p className="muted small">
        {t('counts.vague', { pct: Math.round(summary.vague_claim_ratio * 100) })} · {t('counts.noScore')}
      </p>
    </section>
  );
}
