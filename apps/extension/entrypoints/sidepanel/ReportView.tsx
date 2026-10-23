import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CoverageStrip } from '../../components/CoverageStrip';
import { DemoBanner, Disclaimer } from '../../components/Disclaimer';
import { FindingCard } from '../../components/FindingCard';
import { GapList } from '../../components/GapList';
import { ReportCardView } from '../../components/ReportCardView';
import { useI18n } from '../../components/I18n';
import { JobProgress } from '../../components/JobProgress';
import { TierCounts } from '../../components/TierCounts';
import { hasCard } from '../../lib/card';
import { DEMO_PACKAGE } from '../../lib/demo';
import { formatDate } from '../../lib/i18n';
import { sendToBackground } from '../../lib/messages';
import { isPackageName } from '../../lib/play';
import { openReceiptStore } from '../../lib/receipts';
import { reportKey, type ReportResult } from '../../lib/reportService';

interface Props {
  pkg: string | null;
  tabPkg: string | null;
  tabId: number | undefined;
  apiBase: string;
  focusFindingId?: string;
  onPickPackage: (pkg: string) => void;
}

const receipts = openReceiptStore();

function PackageForm({ onPick }: { onPick: (p: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isPackageName(value)) onPick(value.trim());
  };
  return (
    <form className="card pkg-form" onSubmit={submit}>
      <p>{t('panel.noPackage')}</p>
      <label htmlFor="pkg-input" className="small">{t('panel.packageLabel')}</label>
      <div className="row">
        <input
          id="pkg-input"
          className="input mono"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('panel.packagePlaceholder')}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="btn" disabled={!isPackageName(value)}>{t('panel.check')}</button>
      </div>
      <button type="button" className="btn-link" onClick={() => onPick(DEMO_PACKAGE)}>{t('panel.tryDemo')}</button>
    </form>
  );
}

export function ReportView({ pkg, tabPkg, tabId, apiBase, focusFindingId, onPickPackage }: Props) {
  const { t, lang } = useI18n();
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!pkg) return;
      setLoading(true);
      try {
        setResult(await sendToBackground({ type: 'report:get', package: pkg, tabId, force, startCheck: true }));
      } catch (err) {
        setResult({ kind: 'error', message: String(err) });
      } finally {
        setLoading(false);
      }
    },
    [pkg, tabId],
  );

  useEffect(() => {
    setResult(null);
    void load(false);
  }, [load]);

  // The background alarm writes the finished report to storage.local.
  useEffect(() => {
    if (!pkg) return;
    const key = reportKey(pkg);
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[key] && result?.kind === 'job') void load(false);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [pkg, result, load]);

  // Consent receipt: saved locally when the claims differ from the last one.
  useEffect(() => {
    if (result?.kind === 'report') void receipts.saveIfChanged(result.report).catch(() => undefined);
  }, [result]);

  const onJobDone = useCallback(() => {
    if (result?.kind !== 'job' || !pkg) return;
    void sendToBackground({ type: 'job:done', jobId: result.job.job_id, package: pkg, tabId }).then(setResult);
  }, [result, pkg, tabId]);

  const onFeedback = useCallback(async (findingId: string) => {
    const res = await sendToBackground({ type: 'feedback', findingId }).catch(() => ({ ok: false }));
    return res.ok;
  }, []);

  if (!pkg) return <PackageForm onPick={onPickPackage} />;

  return (
    <div className="stack">
      <div className="app-head">
        <div>
          <p className="muted small">{t('panel.currentApp')}</p>
          <p className="h3">{result?.kind === 'report' ? result.report.app.title : pkg}</p>
          <p className="mono small">{result?.kind === 'report' ? result.report.app.package : pkg}</p>
        </div>
        <button type="button" className="btn secondary" onClick={() => void load(true)} disabled={loading}>
          {t('panel.refresh')}
        </button>
      </div>
      {pkg !== tabPkg && tabPkg === null && (
        <button type="button" className="btn-link small" onClick={() => onPickPackage('')}>
          {t('panel.packageLabel')}…
        </button>
      )}

      {loading && !result && <p role="status">{t('panel.loading')}</p>}
      {result?.kind === 'error' && <p className="warn" role="alert">{t('panel.error', { error: result.message })}</p>}
      {result?.kind === 'not_found' && <p>{t('panel.notFound')}</p>}
      {result?.kind === 'job' && <JobProgress job={result.job} apiBase={apiBase} onDone={onJobDone} />}

      {result?.kind === 'report' && (
        <>
          {result.demo && (
            <DemoBanner otherPackage={result.report.app.package !== pkg ? pkg : null} />
          )}
          {result.source === 'stale-cache' && (
            <p className="notice" role="status">{t('panel.staleCopy', { date: formatDate(result.fetchedAt, lang) })}</p>
          )}
          {hasCard(result.report) ? (
            <ReportCardView
              report={result.report}
              focusFindingId={focusFindingId}
              canFeedback={!result.demo}
              onFeedback={onFeedback}
            />
          ) : (
            <>
              <p className="notice" role="status">{t('card.legacy')}</p>
              <section aria-labelledby="findings-h" className="stack">
                <h2 id="findings-h" className="h2">{t('findings.title')}</h2>
                {result.report.findings.length === 0 && <p className="card">{t('findings.none')}</p>}
                {result.report.findings.map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    focused={f.id === focusFindingId}
                    canFeedback={!result.demo}
                    onFeedback={onFeedback}
                  />
                ))}
              </section>
            </>
          )}
          <CoverageStrip coverage={result.report.coverage} />
          {!hasCard(result.report) && <TierCounts summary={result.report.summary} />}
          <GapList gaps={result.report.disclosure_gaps} />
          <Disclaimer />
          <p className="muted small">
            {t('report.generated', { date: formatDate(result.report.generated_at, lang) })}
            {result.source === 'cache' && ` · ${t('panel.savedCopy', { date: formatDate(result.fetchedAt, lang) })}`}
            <br />
            {t('report.versions', result.report.versions)}
          </p>
        </>
      )}
    </div>
  );
}
