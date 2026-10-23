import { useEffect, useState } from 'react';
import { useI18n } from '../../components/I18n';
import { TupleLine } from '../../components/FindingCard';
import type { MessageKey } from '../../lib/i18n';
import { policyKey, sendToBackground, type PolicyTabResult } from '../../lib/messages';

export function PolicyView({ tabId }: { tabId: number | undefined }) {
  const { t } = useI18n();
  const [result, setResult] = useState<PolicyTabResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'injected' | 'needs_gesture' | 'error'>('idle');

  useEffect(() => {
    setResult(null);
    setStatus('idle');
    if (tabId === undefined) return;
    const key = policyKey(tabId);
    void chrome.storage.session.get(key).then((got) => setResult((got[key] as PolicyTabResult) ?? null));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[key]) setResult((changes[key].newValue as PolicyTabResult) ?? null);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [tabId]);

  const analyse = async () => {
    if (tabId === undefined) return;
    const res = await sendToBackground({ type: 'policy:analyse', tabId }).catch(() => ({ ok: false, reason: 'error' as const }));
    setStatus(res.ok ? 'injected' : res.reason === 'needs_gesture' ? 'needs_gesture' : 'error');
  };

  const legend: [string, MessageKey][] = [
    ['strong', 'policy.legend.strong'],
    ['indicative', 'policy.legend.indicative'],
    ['claim', 'policy.legend.claim'],
    ['vague', 'policy.legend.vague'],
    ['prelim', 'policy.legend.prelim'],
  ];

  return (
    <div className="stack">
      <section className="card">
        <h2 className="h2">{t('policy.title')}</h2>
        <p className="small">{t('policy.intro')}</p>
        <button type="button" className="btn" onClick={() => void analyse()} disabled={tabId === undefined}>
          {t('policy.analyse')}
        </button>
        {status === 'injected' && <p className="small ok" role="status">{t('policy.injected')}</p>}
        {(status === 'needs_gesture' || status === 'error') && <p className="small warn" role="status">{t('policy.needGesture')}</p>}
        <details className="legend">
          <summary className="small">{t('policy.legend')}</summary>
          <ul>
            {legend.map(([cls, key]) => (
              <li key={cls} className="small">
                <span className={`swatch sw-${cls}`} aria-hidden="true" /> {t(key)}
              </li>
            ))}
          </ul>
        </details>
      </section>

      {!result && <p className="muted">{t('policy.none')}</p>}
      {result && (
        <section className="card" aria-live="polite">
          <p className="row-between">
            <span className={result.kind === 'preliminary' ? 'pill pill-prelim' : 'pill'}>
              {result.kind === 'preliminary' ? t('policy.preliminary') : t('policy.server')}
            </span>
            <span className="small muted">{t('policy.vagueRatio', { pct: Math.round(result.vague_claim_ratio * 100) })}</span>
          </p>
          <p className="small mono ellipsis" title={result.url}>{result.title || result.url}</p>
          {result.kind === 'preliminary' && <p className="small muted">{t('policy.preliminaryNote')}</p>}
          {result.error && <p className="small warn">{t('policy.error', { error: result.error })}</p>}
          <p className="small">{t('policy.segments', { n: result.segments.length })}</p>
          <ol className="segments">
            {result.segments.map((s, i) => (
              <li key={`${s.char_start}-${i}`} className={s.vague ? 'seg-vague' : ''}>
                <p className="quote-sm">{s.text}</p>
                {s.prelimLabel ? (
                  <p className="small muted">{t(`prelim.${s.prelimLabel}` as MessageKey)}</p>
                ) : s.tuples.length ? (
                  s.tuples.map((tu, j) => <TupleLine key={j} tuple={tu} />)
                ) : (
                  <p className="small muted">{s.vague ? t('policy.vague') : t('policy.noTuples')}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
