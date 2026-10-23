import type { ReactNode } from "react";
import type { DisclosureGap } from "@sahamati/contracts";
import { dataTypeLabel, formatDate } from "@sahamati/i18n";
import { cx, getT, richTemplate, type Locale } from "../util";
import { ClassIcon } from "./ClassIcon";
import { OntologyPath } from "./OntologyPath";
import { TierBadge } from "./TierBadge";

export interface GapCardProps {
  gap: DisclosureGap;
  locale: Locale;
  labels?: Record<string, string>;
  className?: string;
}

/** One disclosure gap. Never rendered among findings. */
export function GapCard({ gap, locale, labels, className }: GapCardProps) {
  const t = getT(locale);
  const name = gap.evidence.permission ?? gap.evidence.sdk ?? "";
  const dt = dataTypeLabel(t, gap.data_type, labels);
  const evidence = richTemplate(t(gap.source === "apk_sdk" ? "gap.sdk" : "gap.permission"), { name: <code>{name}</code> });
  const body = richTemplate(t("gap.body"), { evidence: <>{evidence}</>, dataType: <strong>{dt}</strong> });
  return (
    <li id={`gap-${gap.id}`} className={cx("mu-card", "mu-gap", className)}>
      <div className="mu-gap__head">
        <ClassIcon cls="disclosure_gap" size={22} />
        <h3 className="mu-gap__title">{dt}</h3>
        <TierBadge tier="not_mentioned" locale={locale} />
      </div>
      <p className="mu-gap__body">{body}</p>
      <OntologyPath path={gap.ontology_path} locale={locale} labels={labels} />
      <p className="mu-gap__meta">
        {t(`source.${gap.source}`)} · {t("finding.captured", { date: formatDate(locale, gap.evidence.captured_at) })}
      </p>
    </li>
  );
}

export interface GapListProps {
  gaps: DisclosureGap[];
  locale: Locale;
  labels?: Record<string, string>;
  /** Heading level id, so pages can link to the section. */
  id?: string;
  className?: string;
  highlighted?: boolean;
  /** Rendered before the heading text (e.g. a section number). */
  leading?: ReactNode;
}

/** The separate "Not mentioned anywhere" section. */
export function GapList({ gaps, locale, labels, id = "not-mentioned", className, highlighted, leading }: GapListProps) {
  const t = getT(locale);
  return (
    <section id={id} className={cx("mu-gaps", highlighted && "is-highlighted", className)} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="mu-section-title">
        {leading}
        {t("gap.title")}
        <span className="mu-count">{gaps.length}</span>
      </h2>
      <p className="mu-gaps__intro">{t("gap.intro")}</p>
      {gaps.length ? (
        <ul className="mu-gaps__list">
          {gaps.map((g) => (
            <GapCard key={g.id} gap={g} locale={locale} labels={labels} />
          ))}
        </ul>
      ) : (
        <p className="mu-empty">{t("gap.none")}</p>
      )}
    </section>
  );
}
