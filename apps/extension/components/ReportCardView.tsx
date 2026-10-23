import type { CardCategory, CardColor, Indicator, Report, RuleRun } from '@sahamati/contracts';
import { useEffect, useState } from 'react';
import {
  categoryOfFinding,
  findingsForCategory,
  groupFindings,
  indicatorsForCategory,
  reasonText,
  unplacedFindings,
  unplacedIndicators,
} from '../lib/card';
import { formatDate } from '../lib/i18n';
import { FindingGroupView } from './FindingCard';
import { useI18n } from './I18n';
import { StatusIcon } from './StatusIcon';

interface ActionProps {
  canFeedback: boolean;
  onFeedback: (id: string) => Promise<boolean>;
}

/** Text label for a colour. Shown next to the icon in every row. */
export function ColorLabel({ color }: { color: CardColor }) {
  const { t } = useI18n();
  return <span className="cat-label">{t(`color.${color}`)}</span>;
}

// ---------------------------------------------------------------- answers

function Answers({ report, onSeeFinding }: { report: Report; onSeeFinding: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <section className="card" aria-labelledby="answers-h">
      <h2 id="answers-h" className="h2">{t('card.answers')}</h2>
      <dl className="answers">
        {report.card.answers.map((a) => (
          <div key={a.id} className="answer">
            <dt>{t(`answer.${a.id}`)}</dt>
            <dd>
              {a.text}
              {a.finding_ids.length > 0 && (
                <>
                  {' '}
                  <button type="button" className="btn-link small" onClick={() => onSeeFinding(a.finding_ids[0])}>
                    {t('card.seeWhy')}
                  </button>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------- indicators

export function IndicatorList({ indicators }: { indicators: Indicator[] }) {
  const { t } = useI18n();
  if (!indicators.length) return null;
  return (
    <div className="indicators">
      <h4 className="h3">{t('why.indicators')}</h4>
      <p className="muted small">{t('why.indicatorsIntro')}</p>
      <ul>
        {indicators.map((i) => (
          <li key={i.id}>
            <p>{i.summary}</p>
            <p className="small muted">
              {t(`source.${i.source}`)}:{' '}
              <span className="mono">{i.evidence.permission ?? i.evidence.sdk ?? i.evidence.label ?? i.evidence.quote ?? ''}</span>
              {' · '}
              {t('finding.rule', { rule: i.rule_id })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- one row

function CategoryRow({
  report,
  cat,
  open,
  onToggle,
  focusId,
  canFeedback,
  onFeedback,
}: { report: Report; cat: CardCategory; open: boolean; onToggle: () => void; focusId?: string } & ActionProps) {
  const { t } = useI18n();
  const groups = groupFindings(findingsForCategory(report, cat));
  const indicators = indicatorsForCategory(report, cat);
  const bodyId = `why-${cat.id}`;
  const empty = groups.length === 0 && indicators.length === 0;
  return (
    <li id={`cat-${cat.id}`} tabIndex={-1} className={`cat cat-${cat.color}`} data-color={cat.color}>
      <div className="cat-head">
        <StatusIcon color={cat.color} />
        <div className="cat-text">
          <h3 className="cat-name">{t(`category.${cat.id}`)}</h3>
          <p className="cat-state"><ColorLabel color={cat.color} /></p>
          <p className="cat-note">{cat.note}</p>
        </div>
      </div>
      <button type="button" className="btn-link small" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        {open ? t('card.hideWhy') : t('card.seeWhy')}
      </button>
      {open && (
        <div id={bodyId} className="why">
          {groups.length > 0 && (
            <div className="stack">
              <h4 className="h3">{t('why.findings')}</h4>
              {groups.map((g) => (
                <FindingGroupView
                  key={g.primary.id}
                  group={g}
                  focusId={focusId}
                  canFeedback={canFeedback}
                  onFeedback={onFeedback}
                />
              ))}
            </div>
          )}
          <IndicatorList indicators={indicators} />
          {empty && <p className="small">{t(cat.color === 'grey' ? 'why.empty.grey' : cat.color === 'green' ? 'why.empty.green' : 'why.empty.other')}</p>}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- rules not evaluated

export function RulesNotEvaluated({ runs }: { runs: RuleRun[] }) {
  const { t } = useI18n();
  const skipped = (runs ?? []).filter((r) => r.status === 'inconclusive');
  return (
    <section className="card" aria-labelledby="rules-h">
      <h2 id="rules-h" className="h2">{t('rules.title')}</h2>
      <p className="muted small">{t('rules.intro')}</p>
      {skipped.length === 0 ? (
        <p className="small">{t('rules.none')}</p>
      ) : (
        <ul className="rules">
          {skipped.map((r) => (
            <li key={r.rule_id}>
              <p><strong>{r.name}</strong> <span className="mono muted">{r.rule_id}</span></p>
              <p className="small">{reasonText(t, r.reason)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- the card

interface Props extends ActionProps {
  report: Report;
  focusFindingId?: string;
  /** Rows to start open (tests and deep links). */
  initialOpen?: string[];
}

/**
 * The report card: five answers, then ten category rows, each with its own colour, label and note.
 * There is deliberately no overall colour, score or grade (CLAUDE.md rule 3).
 */
export function ReportCardView({ report, focusFindingId, initialOpen = [], canFeedback, onFeedback }: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<Set<string>>(new Set(initialOpen));

  const openRowOf = (findingId: string): string | null => {
    const cat = categoryOfFinding(report, findingId);
    return cat ? cat.id : null;
  };

  const focusFinding = (findingId: string) => {
    const id = openRowOf(findingId);
    if (id) setOpen((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      const el = document.getElementById(`finding-${findingId}`) ?? (id ? document.getElementById(`cat-${id}`) : null);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.focus({ preventScroll: true });
    }, 0);
  };

  useEffect(() => {
    if (focusFindingId) focusFinding(focusFindingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFindingId, report.report_id]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const extra = groupFindings(unplacedFindings(report));
  const extraIndicators = unplacedIndicators(report);

  return (
    <>
      <Answers report={report} onSeeFinding={focusFinding} />
      <section aria-labelledby="cats-h" className="stack">
        <div>
          <h2 id="cats-h" className="h2">{t('card.categories')}</h2>
          <p className="muted small">{t('card.intro')}</p>
          <p className="muted small">{t('card.checkedAt', { date: formatDate(report.card.checked_at, lang) })}</p>
        </div>
        <ol className="cats">
          {report.card.categories.map((cat) => (
            <CategoryRow
              key={cat.id}
              report={report}
              cat={cat}
              open={open.has(cat.id)}
              onToggle={() => toggle(cat.id)}
              focusId={focusFindingId}
              canFeedback={canFeedback}
              onFeedback={onFeedback}
            />
          ))}
        </ol>
      </section>
      {extra.length > 0 && (
        <section className="stack" aria-labelledby="other-h">
          <h2 id="other-h" className="h2">{t('findings.other')}</h2>
          {extra.map((g) => (
            <FindingGroupView
              key={g.primary.id}
              group={g}
              focusId={focusFindingId}
              canFeedback={canFeedback}
              onFeedback={onFeedback}
            />
          ))}
        </section>
      )}
      {extraIndicators.length > 0 && (
        <section className="card">
          <IndicatorList indicators={extraIndicators} />
        </section>
      )}
      <RulesNotEvaluated runs={report.rule_runs} />
    </>
  );
}
