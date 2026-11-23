import type { ReactNode } from "react";
import type { CardAnswer, CardCategory, Finding, Indicator, ReportCard as ReportCardData } from "@sahamati/contracts";
import { STATUS_IDS, answerI18nKey, categoryI18nKey, formatDate } from "@sahamati/i18n";
import { cx, getT, langAttr, type Locale, type Translator } from "../util";
import { StatusBadge } from "./StatusBadge";

export interface ReportCardProps {
  card: ReportCardData;
  locale: Locale;
  /** Kept for API compatibility; links no longer show internal rule ids. */
  findings?: Finding[];
  indicators?: Indicator[];
  /** Rendered before the heading text (e.g. a section number). */
  leading?: ReactNode;
  id?: string;
  className?: string;
}

function Links({ findingIds, indicatorIds, t }: { findingIds: string[]; indicatorIds: string[]; t: Translator }) {
  if (!findingIds.length && !indicatorIds.length) return null;
  // One "See why" per finding (each one points at its own evidence), but a single link for the
  // investigation notes: several identical "See details" links read as a rendering glitch.
  return (
    <p className="mu-rc__links">
      {findingIds.map((fid) => (
        <a key={fid} href={`#finding-${fid}`} className="mu-rc__link">
          {t("card.seeWhy")}
          <span aria-hidden="true"> →</span>
        </a>
      ))}
      {indicatorIds.length ? (
        <a href={`#indicator-${indicatorIds[0]}`} className="mu-rc__link mu-rc__link--soft">
          {indicatorIds.length > 1 ? t("card.seeDetails", { n: indicatorIds.length }) : t("card.seeIndicator")}
          <span aria-hidden="true"> →</span>
        </a>
      ) : null}
    </p>
  );
}

function Row({ cat, locale, t, compact = false }: { cat: CardCategory; locale: Locale; t: Translator; compact?: boolean }) {
  // Grey and green rows must always say what could not be checked.
  const needsLimit = cat.color === "grey" || cat.color === "green";
  const note = (cat.note ?? "").trim();
  return (
    <li
      className={cx("mu-rc__row", `mu-rc__row--${cat.color}`, compact && "mu-rc__row--compact")}
      data-category={cat.id}
      data-color={cat.color}
      data-status={cat.status}
    >
      <div className="mu-rc__rowhead">
        <h4 className="mu-rc__cat">{t(categoryI18nKey(cat.id))}</h4>
        <StatusBadge status={cat.status} color={cat.color} locale={locale} />
      </div>
      {needsLimit ? (
        <div className="mu-rc__limit">
          <p className={cx("mu-rc__limit-title", compact && "mu-sr-only")}>{t("card.couldNotCheck")}</p>
          <p className="mu-rc__note" lang={note ? langAttr(locale, note) : undefined}>
            {note || t("card.noteMissing")}
          </p>
        </div>
      ) : note ? (
        <p className="mu-rc__note" lang={langAttr(locale, note)}>
          {note}
        </p>
      ) : null}
      <Links findingIds={cat.finding_ids} indicatorIds={cat.indicator_ids} t={t} />
    </li>
  );
}

function Answer({ a, t, locale }: { a: CardAnswer; t: Translator; locale: Locale }) {
  return (
    <div className="mu-rc__answer" data-answer={a.id}>
      <dt>{t(answerI18nKey(a.id))}</dt>
      <dd>
        <span lang={langAttr(locale, a.text)}>{a.text}</span>
        <Links findingIds={a.finding_ids} indicatorIds={[]} t={t} />
      </dd>
    </div>
  );
}

/**
 * Per-area report card: five quick answers plus ten category rows.
 * Areas with something to say come first as cards; areas that could not be checked are
 * grouped into one compact list underneath (each still says why).
 * There is deliberately no overall colour, score or grade.
 */
export function ReportCard({ card, locale, leading, id = "card", className }: ReportCardProps) {
  const t = getT(locale);
  const checked = card.categories.filter((c) => c.color !== "grey");
  const unchecked = card.categories.filter((c) => c.color === "grey");
  return (
    <section id={id} className={cx("mu-rc", className)} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="mu-section-title">
        {leading}
        {t("card.title")}
      </h2>
      <p className="mu-rc__lede">{t("card.lede")}</p>

      <section className="mu-rc__answers" aria-labelledby={`${id}-answers`}>
        <h3 id={`${id}-answers`} className="mu-rc__h3">
          {t("card.answersTitle")}
        </h3>
        <dl className="mu-rc__answers-list">
          {card.answers.map((a) => (
            <Answer key={a.id} a={a} t={t} locale={locale} />
          ))}
        </dl>
      </section>

      <section aria-labelledby={`${id}-areas`} className="mu-rc__areas">
        <div className="mu-rc__areas-head">
          <h3 id={`${id}-areas`} className="mu-rc__h3">
            {t("card.categoriesTitle")}
          </h3>
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
        </div>
        {checked.length ? (
          <ul className="mu-rc__rows">
            {checked.map((c) => (
              <Row key={c.id} cat={c} locale={locale} t={t} />
            ))}
          </ul>
        ) : null}
        {unchecked.length ? (
          <div className="mu-rc__unchecked">
            <h4 className="mu-rc__unchecked-title">
              {t("card.notCheckedTitle")} <span className="mu-count">{unchecked.length}</span>
            </h4>
            <ul className="mu-rc__rows mu-rc__rows--compact">
              {unchecked.map((c) => (
                <Row key={c.id} cat={c} locale={locale} t={t} compact />
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <p className="mu-rc__foot">
        {t("card.checkedAt", { date: formatDate(locale, card.checked_at) })} · {t("card.noScore")}
      </p>
    </section>
  );
}
