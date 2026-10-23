import type { Job } from '@sahamati/contracts';
import { useEffect, useState } from 'react';
import type { InFlightJob } from '../lib/reportService';
import { useI18n } from './I18n';

/** Live progress over SSE; the background alarm keeps polling if the stream drops. */
export function JobProgress({ job, apiBase, onDone }: { job: InFlightJob; apiBase: string; onDone: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<Partial<Job>>({ stage: job.stage ?? 'queued', progress: job.progress ?? 0 });

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const url = /^https?:\/\//.test(job.events_url) ? job.events_url : `${apiBase}${job.events_url}`;
    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch {
      return;
    }
    const handle = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as Partial<Job>;
        setState((s) => ({ ...s, ...data }));
        if (data.status === 'done') {
          es?.close();
          onDone();
        }
        if (data.status === 'error') es?.close();
      } catch {
        /* ignore non-JSON keepalives */
      }
    };
    es.onmessage = handle;
    for (const name of ['progress', 'stage', 'status', 'done']) es.addEventListener(name, handle as EventListener);
    es.onerror = () => es?.close();
    return () => es?.close();
  }, [job.events_url, apiBase, onDone]);

  const pct = Math.round((state.progress ?? 0) * 100);
  return (
    <section className="card" aria-live="polite" aria-busy={state.status !== 'done'}>
      <h2 className="h2">{t('job.title')}</h2>
      {state.status === 'error' ? (
        <p className="warn">{t('job.error', { error: state.error ?? '' })}</p>
      ) : (
        <>
          <p>{t('job.stage', { stage: state.stage ?? '' })}</p>
          <progress max={100} value={pct} aria-label={t('job.progress', { pct })} />
          <p className="muted small">{t('job.progress', { pct })}</p>
          <p className="muted small">{t('job.background')}</p>
        </>
      )}
    </section>
  );
}
