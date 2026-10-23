import { confidenceBand, type ConfidenceBand } from '../lib/card';
import { useI18n } from './I18n';

const SEGMENTS: Record<ConfidenceBand, number> = { weak: 1, moderate: 2, strong: 3 };

/** Confidence as a band (strong, moderate, weak) plus the number on hover. Shape (filled segments) and word, not colour. */
export function ConfidenceMeter({ value }: { value: number }) {
  const { t } = useI18n();
  const band = confidenceBand(value);
  const filled = SEGMENTS[band];
  const word = t(`band.${band}`);
  return (
    <span className="meter" title={`${t('finding.confidence')}: ${value.toFixed(2)}`}>
      <span className="meter-bar" role="img" aria-label={`${t('finding.confidence')}: ${word}`}>
        {[1, 2, 3].map((i) => (
          <span key={i} className={i <= filled ? 'seg on' : 'seg'} />
        ))}
      </span>
      <span className="meter-word">
        {t('finding.confidence')}: {word} ({value.toFixed(2)})
      </span>
    </span>
  );
}
