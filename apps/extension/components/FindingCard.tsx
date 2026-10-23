import type { ClaimTupleView, Finding, FindingSide } from '@sahamati/contracts';
import { forwardRef, useState } from 'react';
import { findingStatus, limitationText, type FindingGroup } from '../lib/card';
import { formatDate } from '../lib/i18n';
import { Breadcrumbs } from './Breadcrumbs';
import { ConfidenceMeter } from './ConfidenceMeter';
import { useI18n } from './I18n';
import { useOntologyLabel } from './Ontology';
import { StatusIcon } from './StatusIcon';
import { TierBadge } from './TierBadge';

export function TupleLine({ tuple }: { tuple: ClaimTupleView }) {
  const { t } = useI18n();
  const label = useOntologyLabel();
  return (
    <p className="tuple">
      <span className="k">{t('finding.tuple')}:</span>{' '}
      <code>
        {label(tuple.actor)} · {t(`action.${tuple.action}`)} · {label(tuple.data_type)} · {t(`polarity.${tuple.polarity}`)}
        {tuple.condition ? ` · ${label(tuple.condition)}` : ''}
      </code>
    </p>
  );
}

function policyLink(side: FindingSide): string | null {
  const { url, text_fragment } = side.evidence;
  if (!url || !/^https?:\/\//.test(url)) return null;
  return `${url.split('#')[0]}${text_fragment ?? ''}`;
}

export function SideEvidence({ side }: { side: FindingSide }) {
  const { t, lang } = useI18n();
  const ev = side.evidence;
  const link = policyLink(side);
  return (
    <div className={`side side-${side.source}`}>
      <p className="side-src">{t(`source.${side.source}`)}</p>
      {ev.quote && <blockquote className="quote">“{ev.quote}”</blockquote>}
      {ev.label && <p className="ds-label">{ev.label}</p>}
      {ev.permission && <p className="mono">{ev.permission}</p>}
      {ev.sdk && <p className="mono">{ev.sdk}</p>}
      <TupleLine tuple={side.tuple} />
      <p className="muted small">
        {t('finding.captured', { date: formatDate(ev.captured_at, lang) })}
        {link && (
          <>
            {' · '}
            <a href={link} target="_blank" rel="noreferrer noopener">
              {t('finding.openInPage')}
            </a>
          </>
        )}
      </p>
    </div>
  );
}

const STATUS_COLOR = {
  confirmed_conflict: 'red',
  potential_conflict: 'orange',
  needs_review: 'yellow',
} as const;

/** Status as icon + words, so colour is never the only signal. */
export function StatusPill({ status }: { status: Finding['status'] }) {
  const { t } = useI18n();
  const s = findingStatus({ status });
  return (
    <span className={`status-pill status-${s}`}>
      <StatusIcon color={STATUS_COLOR[s]} size={16} />
      <span>{t(`status.${s}`)}</span>
    </span>
  );
}

interface Props {
  finding: Finding;
  focused?: boolean;
  nested?: boolean;
  canFeedback: boolean;
  onFeedback: (id: string) => Promise<boolean>;
}

export const FindingCard = forwardRef<HTMLElement, Props>(function FindingCard(
  { finding, focused, nested, canFeedback, onFeedback },
  ref,
) {
  const { t } = useI18n();
  const [fb, setFb] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const headingId = `f-${finding.id}`;
  const status = findingStatus(finding);
  const limitations = finding.limitations ?? [];

  const send = async () => {
    setFb('sending');
    setFb((await onFeedback(finding.id)) ? 'sent' : 'failed');
  };

  return (
    <article
      ref={ref}
      id={`finding-${finding.id}`}
      className={`card finding finding-${finding.class} finding-s-${status}${focused ? ' focused' : ''}${nested ? ' nested' : ''}`}
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <header className="finding-head">
        <StatusPill status={status} />
        <ConfidenceMeter value={finding.confidence} />
      </header>
      <h4 id={headingId} className="h3">{t(`class.${finding.class}`)}</h4>
      <p className="row small muted">
        <TierBadge tier={finding.tier} cls={finding.class} />
        {finding.evidence_strength && <span>{t(`strength.${finding.evidence_strength}`)}</span>}
      </p>
      <p>{finding.summary}</p>
      <div className="sides">
        {finding.sides.map((s, i) => (
          <SideEvidence key={i} side={s} />
        ))}
      </div>
      <p className="inconsistent">{t('finding.inconsistent')}</p>
      {limitations.length > 0 && (
        <div className="limits">
          <p className="small"><strong>{t('limitations.title')}</strong></p>
          <ul>
            {limitations.map((code) => (
              <li key={code}>{limitationText(t, code)}</li>
            ))}
          </ul>
        </div>
      )}
      <Breadcrumbs path={finding.ontology_path} />
      {finding.benign_explanations.length > 0 && (
        <details className="benign">
          <summary>{t('finding.benign')}</summary>
          <ul>
            {finding.benign_explanations.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </details>
      )}
      <footer className="finding-foot">
        <span className="muted small mono">{t('finding.rule', { rule: finding.rule_id })}</span>
        {canFeedback && (
          <span>
            {fb === 'sent' ? (
              <span className="small ok" role="status">{t('finding.feedbackSent')}</span>
            ) : (
              <button type="button" className="btn-link" onClick={send} disabled={fb === 'sending'}>
                {t('finding.looksWrong')}
              </button>
            )}
            {fb === 'failed' && <span className="small warn" role="status"> {t('finding.feedbackFailed')}</span>}
          </span>
        )}
      </footer>
    </article>
  );
});

/** A group is shown once: the primary finding in full, related findings nested beneath it. */
export function FindingGroupView({
  group,
  focusId,
  canFeedback,
  onFeedback,
}: {
  group: FindingGroup;
  focusId?: string;
  canFeedback: boolean;
  onFeedback: (id: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  return (
    <div className="finding-group">
      <FindingCard
        finding={group.primary}
        focused={group.primary.id === focusId}
        canFeedback={canFeedback}
        onFeedback={onFeedback}
      />
      {group.related.length > 0 && (
        <div className="related" role="group" aria-label={t('why.related')}>
          <p className="small muted related-h">{t('why.related')}</p>
          {group.related.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              nested
              focused={f.id === focusId}
              canFeedback={canFeedback}
              onFeedback={onFeedback}
            />
          ))}
        </div>
      )}
    </div>
  );
}
