import type { ClaimTupleView } from "@sahamati/contracts";
import { actorLabel, dataTypeLabel } from "@sahamati/i18n";
import { cx, getT, type Locale } from "../util";

export interface OntologyPathProps {
  path: string[];
  locale: Locale;
  labels?: Record<string, string>;
  className?: string;
}

/** Breadcrumb from the root to the most specific overlap node. */
export function OntologyPath({ path, locale, labels, className }: OntologyPathProps) {
  const t = getT(locale);
  return (
    <nav className={cx("mu-path", className)} aria-label={t("finding.path")}>
      <ol>
        {path.map((id, i) => (
          <li key={`${id}-${i}`} aria-current={i === path.length - 1 ? "true" : undefined}>
            <span className="mu-path__label">{dataTypeLabel(t, id, labels)}</span>
            {i === path.length - 1 ? <code className="mu-path__id">{id}</code> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A claim tuple as a compact row of labelled chips. */
export function TupleChips({ tuple, locale, labels }: { tuple: ClaimTupleView; locale: Locale; labels?: Record<string, string> }) {
  const t = getT(locale);
  const action = t.has(`action.${tuple.action}`) ? t(`action.${tuple.action}`) : tuple.action;
  return (
    <dl className="mu-tuple" aria-label={t("tuple.label")}>
      <div>
        <dt>{t("tuple.actor")}</dt>
        <dd>{actorLabel(t, tuple.actor)}</dd>
      </div>
      <div>
        <dt>{t("tuple.action")}</dt>
        <dd>{action}</dd>
      </div>
      <div className={`is-${tuple.polarity}`}>
        <dt>{t("tuple.polarity")}</dt>
        <dd>{t(`polarity.${tuple.polarity}`)}</dd>
      </div>
      <div>
        <dt>{t("tuple.dataType")}</dt>
        <dd>{dataTypeLabel(t, tuple.data_type, labels)}</dd>
      </div>
      {tuple.condition ? (
        <div>
          <dt>{t("tuple.condition")}</dt>
          {/* purpose ids are source data, shown verbatim */}
          <dd>
            <code>{tuple.condition}</code>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
