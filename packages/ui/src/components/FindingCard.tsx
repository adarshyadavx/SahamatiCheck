"use client";

import { useEffect, useState } from "react";
import type { Evidence, Finding, FindingSide, Indicator } from "@sahamati/contracts";
import { formatDate } from "@sahamati/i18n";
import { cx, getT, langAttr, type Locale, type Translator } from "../util";
import { ClassIcon } from "./ClassIcon";
import { ConfidenceBand } from "./ConfidenceBand";
import { LimitationsList } from "./LimitationsList";
import { OntologyPath, TupleChips } from "./OntologyPath";
import { StatusBadge, statusColor } from "./StatusBadge";
import { TierBadge } from "./TierBadge";
import { WhatCanIDo } from "./WhatCanIDo";

function sourceHref(ev: Evidence): string | undefined {
  if (!ev.url) return undefined;
  if (!ev.text_fragment) return ev.url;
  return ev.url.includes("#") ? ev.url : `${ev.url}${ev.text_fragment}`;
}

function EvidenceBody({ ev, t }: { ev: Evidence; t: Translator }) {
  const href = sourceHref(ev);
  return (
    <div className="mu-ev">
      {ev.quote ? (
        <blockquote className="mu-ev__quote" cite={ev.url}>
          <p>{ev.quote}</p>
        </blockquote>
      ) : null}
      {ev.label ? <p className="mu-ev__row">{ev.label}</p> : null}
      {ev.permission ? (
        <p className="mu-ev__code">
          <code>{ev.permission}</code>
        </p>
      ) : null}
      {ev.sdk ? (
        <p className="mu-ev__code">
          <code>{ev.sdk}</code>
        </p>
      ) : null}
      <p className="mu-ev__meta">
        <span>{t("finding.captured", { date: formatDate(t.locale, ev.captured_at) })}</span>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="mu-ev__link">
            {t("finding.openSource")}
            <span aria-hidden="true"> ↗</span>
          </a>
        ) : null}
      </p>
    </div>
  );
}

function Side({ side, lead, t, labels }: { side: FindingSide; lead: string; t: Translator; labels?: Record<string, string> }) {
  return (
    <section className={cx("mu-side", `mu-side--${side.source}`)}>
      <header className="mu-side__head">
        <span className="mu-side__src">{t(`source.${side.source}`)}</span>
        <h4 className="mu-side__lead">{lead}</h4>
      </header>
      <EvidenceBody ev={side.evidence} t={t} />
      <TupleChips tuple={side.tuple} locale={t.locale} labels={labels} />
    </section>
  );
}

export type FeedbackStatus = "idle" | "sending" | "sent" | "failed";

export interface FindingCardProps {
  finding: Finding;
  locale: Locale;
  /** Called when the reader presses "Report a mistake". Reject to show a failure note. */
  onLooksWrong?: (finding: Finding) => Promise<unknown> | void;
  labels?: Record<string, string>;
  highlighted?: boolean;
  className?: string;
  /** Findings of the same group, shown nested under this one. */
  related?: Finding[];
  /** Indicators sharing this finding's group, linked as "also worth a closer look". */
  relatedIndicators?: Indicator[];
  /** Whether "See why" starts open. Nested cards start closed. Default true. */
  defaultOpen?: boolean;
  /** This card sits inside another finding's group. */
  nested?: boolean;
  /** Link to the rights page for the "What can I do?" block. */
  rightsHref?: string;
}

export function FindingCard({
  finding,
  locale,
  onLooksWrong,
  labels,
  highlighted,
  className,
  related,
  relatedIndicators,
  defaultOpen,
  nested = false,
  rightsHref,
}: FindingCardProps) {
  const t = getT(locale);
  const [status, setStatus] = useState<FeedbackStatus>("idle");
  const [open, setOpen] = useState(defaultOpen ?? !nested);
  const [a, b] = finding.sides;
  const leadA = t(`lead.${a.source}`);
  const leadB = a.source === "policy" && b.source === "policy" ? t("lead.policyAgain") : t(`lead.${b.source}`);
  const headingId = `finding-${finding.id}-title`;
  const bodyId = `finding-${finding.id}-why`;

  // A link such as #finding-f_dm_01 (from the report card) opens the evidence it points at.
  useEffect(() => {
    const check = () => {
      if (typeof window !== "undefined" && window.location.hash === `#finding-${finding.id}`) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [finding.id]);

  async function report() {
    if (!onLooksWrong || status === "sending" || status === "sent") return;
    setStatus("sending");
    try {
      await onLooksWrong(finding);
      setStatus("sent");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <article
      id={`finding-${finding.id}`}
      className={cx(
        "mu-card",
        "mu-finding",
        `mu-finding--${finding.class}`,
        `mu-finding--st-${statusColor(finding.status)}`,
        nested && "is-nested",
        highlighted && "is-highlighted",
        className,
      )}
      aria-labelledby={headingId}
      data-status={finding.status}
      data-tier={finding.tier}
    >
      <header className="mu-finding__head">
        <span className="mu-finding__class">
          <ClassIcon cls={finding.class} size={22} tint="var(--ink)" />
          <span>
            <span className="mu-finding__class-name">{t(`class.${finding.class}`)}</span>
            <span className="mu-finding__class-desc">{t(`class.desc.${finding.class}`)}</span>
          </span>
        </span>
        <span className="mu-finding__badges">
          <StatusBadge status={finding.status} locale={locale} />
          <TierBadge tier={finding.tier} locale={locale} />
          <ConfidenceBand value={finding.confidence} locale={locale} />
        </span>
      </header>

      <h3 id={headingId} className="mu-finding__summary" lang={langAttr(locale, finding.summary)}>
        {finding.summary}
      </h3>
      <OntologyPath path={finding.ontology_path} locale={locale} labels={labels} />
      <p className="mu-finding__strength">
        <span className="mu-finding__strength-label">{t("finding.strengthLabel")}</span>
        <span className="mu-finding__strength-val">{t(`finding.strength.${finding.evidence_strength}`)}</span>
      </p>
      <LimitationsList limitations={finding.limitations} locale={locale} />

      <details
        className="mu-finding__see"
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary aria-controls={bodyId}>{t("finding.seeWhy")}</summary>
        <div id={bodyId} className="mu-finding__see-body">
          <h4 className="mu-sr-only">{t("finding.evidenceTitle")}</h4>
          <div className="mu-finding__sides">
            <Side side={a} lead={leadA} t={t} labels={labels} />
            <div className="mu-finding__versus" role="separator" aria-label={t("lead.inconsistent")}>
              <span aria-hidden="true" className="mu-finding__versus-mark">≠</span>
              <span aria-hidden="true">{t("lead.inconsistent")}</span>
            </div>
            <Side side={b} lead={leadB} t={t} labels={labels} />
          </div>
          <p className="mu-finding__quote-note">{t("finding.quoteNote")}</p>

          {finding.benign_explanations.length > 0 ? (
            <details className="mu-finding__why">
              <summary>{t("finding.why")}</summary>
              <ul>
                {finding.benign_explanations.map((x, i) => (
                  <li key={i} lang={langAttr(locale, x)}>
                    {x}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </details>

      <WhatCanIDo category={finding.user_category} status={finding.status} locale={locale} rightsHref={rightsHref} />

      {related && related.length > 0 ? (
        <section className="mu-finding__related" aria-label={t("finding.related")}>
          <h4 className="mu-finding__related-title">{t("finding.related")}</h4>
          <div className="mu-finding__related-list">
            {related.map((r) => (
              <FindingCard
                key={r.id}
                finding={r}
                locale={locale}
                labels={labels}
                onLooksWrong={onLooksWrong}
                nested
                rightsHref={rightsHref}
              />
            ))}
          </div>
        </section>
      ) : null}

      {relatedIndicators && relatedIndicators.length > 0 ? (
        <p className="mu-finding__rel-ind">
          <span>{t("finding.relatedIndicators")}: </span>
          {relatedIndicators.map((i) => (
            <a key={i.id} href={`#indicator-${i.id}`}>
              <code>{i.rule_id}</code>
            </a>
          ))}
        </p>
      ) : null}

      <footer className="mu-finding__foot">
        <span className="mu-finding__ids">
          <code>{t("finding.rule", { rule: finding.rule_id })}</code>
          <code>{finding.id}</code>
        </span>
        {onLooksWrong ? (
          <span className="mu-finding__fb">
            <button
              type="button"
              className="mu-btn mu-btn--quiet"
              onClick={report}
              disabled={status === "sending" || status === "sent"}
              aria-describedby={status !== "idle" ? `${headingId}-fb` : undefined}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
                <path d="M3 1.5v11M3 2h7.5l-1.8 2.8L10.5 7.5H3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              {status === "sending" ? t("finding.sending") : t("finding.reportMistake")}
            </button>
            <span id={`${headingId}-fb`} role="status" className={cx("mu-finding__fb-status", `is-${status}`)}>
              {status === "sent" ? t("finding.sent") : status === "failed" ? t("finding.sendFailed") : ""}
            </span>
          </span>
        ) : null}
      </footer>
    </article>
  );
}
