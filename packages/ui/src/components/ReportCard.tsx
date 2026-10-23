import type { ReactNode } from "react";
import type { CardAnswer, CardCategory, Finding, Indicator, ReportCard as ReportCardData } from "@sahamati/contracts";
import { STATUS_IDS, answerI18nKey, categoryI18nKey, formatDate } from "@sahamati/i18n";
import { cx, getT, langAttr, type Locale, type Translator } from "../util";
import { StatusBadge } from "./StatusBadge";

export interface ReportCardProps {
  card: ReportCardData;
  locale: Locale;
  /** Used only to label "See why" links with the rule id. */
  findings?: Finding[];
  indicators?: Indicator[];
  /** Rendered before the heading text (e.g. a section number). */
  leading?: ReactNode;
  id?: string;
  className?: string;
}

function Links({
  findingIds,
  indicatorIds,
  findings,
  t,
}: {
  findingIds: string[];
  indicatorIds: string[];
  findings?: Finding[];
  t: Translator;
}) {
  if (!findingIds.length && !indicatorIds.length) return null;
  return (
    <p className="mu-rc__links">
      {findingIds.map((fid) => {
        const rule = findings?.find((f) => f.id === fid)?.rule_id;
        return (
          <a key={fid} href={`#finding-${fid}`} className="mu-rc__link">
            {t("card.seeWhy")}
            {rule ? <code>{rule}</code> : null}
            <span aria-hidden="true"> →</span>
          </a>
        );
      })}
      {indicatorIds.map((iid) => (
        <a key={iid} href={`#indicator-${iid}`} className="mu-rc__link mu-rc__link--soft">
          {t("card.seeIndicator")}
          <span aria-hidden="true"> →</span>
        </a>
      ))}
    </p>
  );
}

function Row({ cat, findings, locale, t }: { cat: CardCategory; findings?: Finding[]; locale: Locale; t: Translator }) {
  // Grey and green rows must always say what could not be checked.
  const needsLimit = cat.color === "grey" || cat.color === "green";
  const note = (cat.note ?? "").trim();
  return (
    <li className={cx("mu-rc__row", `mu-rc__row--${cat.color}`)} data-category={cat.id} data-color={cat.color} data-status={cat.status}>
      <div className="mu-rc__rowhead">
        <h4 className="mu-rc__cat">{t(categoryI18nKey(cat.id))}</h4>
        <StatusBadge status={cat.status} color={cat.color} locale={locale} />
      </div>
      {needsLimit ? (
        <div className="mu-rc__limit">
          <p className="mu-rc__limit-title">{t("card.couldNotCheck")}</p>
          <p className="mu-rc__note" lang={note ? langAttr(locale, note) : undefined}>
            {note || t("card.noteMissing")}
          </p>
        </div>
      ) : note ? (
        <p className="mu-rc__note" lang={langAttr(locale, note)}>
          {note}
        </p>
      ) : null}
      <Links findingIds={cat.finding_ids} indicatorIds={cat.indicator_ids} findings={findings} t={t} />
    </li>
  );
}

function Answer({ a, findings, t, locale }: { a: CardAnswer; findings?: Finding[]; t: Translator; locale: Locale }) {
  return (
    <div className="mu-rc__answer" data-answer={a.id}>
      <dt>{t(answerI18nKey(a.id))}</dt>
      <dd>
        <span lang={langAttr(locale, a.text)}>{a.text}</span>
        <Links findingIds={a.finding_ids} indicatorIds={[]} findings={findings} t={t} />
      </dd>
    </div>
  );
}

/**
 * Per-area report card: five quick answers plus ten category rows.
 * There is deliberately no overall colour, score or grade.
 */
export function ReportCard({ card, locale, findings, leading, id = "card", className }: ReportCardProps) {
  const t = getT(locale);
  return (
    <section id={id} className={cx("mu-rc", className)} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="mu-section-title">
        {leading}
        {t("card.title")}
      </h2>
      <p className="mu-rc__lede">{t("card.lede")}</p>

      <div className="mu-rc__key" role="group" aria-label={t("card.keyTitle")}>
        <span className="mu-rc__key-title">{t("card.keyTitle")}</span>
        <ul>
          {STATUS_IDS.map((s) => (
            <li key={s}>
              <StatusBadge status={s} locale={locale} describe />
            </li>
          ))}
        </ul>
      </div>

      <section className="mu-rc__answers" aria-labelledby={`${id}-answers`}>
        <h3 id={`${id}-answers`} className="mu-rc__h3">
          {t("card.answersTitle")}
        </h3>
        <dl className="mu-rc__answers-list">
          {card.answers.map((a) => (
            <Answer key={a.id} a={a} findings={findings} t={t} locale={locale} />
          ))}
        </dl>
      </section>

      <section aria-labelledby={`${id}-areas`}>
        <h3 id={`${id}-areas`} className="mu-rc__h3">
          {t("card.categoriesTitle")}
        </h3>
        <ul className="mu-rc__rows">
          {card.categories.map((c) => (
            <Row key={c.id} cat={c} findings={findings} locale={locale} t={t} />
          ))}
        </ul>
      </section>

      <p className="mu-rc__foot">
        {t("card.checkedAt", { date: formatDate(locale, card.checked_at) })} · {t("card.noScore")}
      </p>
    </section>
  );
}
