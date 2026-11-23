import type { Coverage, SourceName, SourceNote } from "@sahamati/contracts";
import { cx, getT, type Locale, type Translator } from "../util";

const ORDER: SourceName[] = ["policy", "data_safety", "apk"];

function StatusMark({ status }: { status: Coverage }) {
  // ok = solid tick; obfuscated = half; anything else = open ring with a bar
  return (
    <svg className="mu-cov__mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      {status === "ok" ? (
        <>
          <circle cx="9" cy="9" r="8" fill="var(--agree)" />
          <path d="M5.2 9.3l2.4 2.4 5-5.2" fill="none" stroke="var(--surface-raised)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : status === "obfuscated" ? (
        <>
          <circle cx="9" cy="9" r="7.2" fill="none" stroke="var(--class-behaviour)" strokeWidth="1.6" />
          <path d="M9 1.8a7.2 7.2 0 0 1 0 14.4z" fill="var(--class-behaviour)" />
        </>
      ) : (
        <>
          <circle cx="9" cy="9" r="7.2" fill="none" stroke="var(--class-gap)" strokeWidth="1.6" strokeDasharray="2 2.2" />
          <path d="M5.5 9h7" stroke="var(--class-gap)" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export interface CoverageStripProps {
  coverage: Record<SourceName, Coverage>;
  /** Where each source came from and, when it could not be used, why (Report.sources). */
  sources?: Partial<Record<SourceName, SourceNote>>;
  locale: Locale;
  className?: string;
}

/** Plain-language text for a source reason code (see SourceNote in packages/contracts). */
export function sourceReasonText(t: Translator, reason: string | undefined): string | null {
  if (!reason) return null;
  const http = /^http_(\d{3})$/.exec(reason);
  if (http) return t("coverage.reason.http", { code: http[1] ?? "" });
  const key = `coverage.reason.${reason}`;
  return t.has(key) ? t(key) : t("coverage.reason.unknown");
}

/** Only plain web links are rendered as links. */
export function safeHref(url: string | undefined | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function CoverageStrip({ coverage, sources, locale, className }: CoverageStripProps) {
  const t = getT(locale);
  const partial = ORDER.some((s) => coverage[s] !== "ok");
  return (
    <section className={cx("mu-cov", className)} aria-label={t("coverage.label")}>
      <ul className="mu-cov__list">
        {ORDER.map((s) => {
          const note = sources?.[s];
          const reason = coverage[s] !== "ok" ? sourceReasonText(t, note?.reason) : null;
          const link = safeHref(note?.url);
          return (
            <li key={s} className={cx("mu-cov__item", `is-${coverage[s]}`)} data-source={s}>
              <StatusMark status={coverage[s]} />
              <span className="mu-cov__src">{t(`source.${s}`)}</span>
              <span className="mu-cov__status">{t(`coverage.${coverage[s]}`)}</span>
              {reason ? <span className="mu-cov__reason">{reason}</span> : null}
              {coverage[s] === "ok" && note?.method === "androzoo" ? (
                <span className="mu-cov__reason">{t("coverage.viaAndroZoo")}</span>
              ) : null}
              {coverage[s] === "ok" && note?.method === "browser" ? (
                <span className="mu-cov__reason">{t("coverage.viaBrowser")}</span>
              ) : null}
              {link ? (
                <a className="mu-cov__link" href={link} target="_blank" rel="noopener noreferrer nofollow">
                  {s === "data_safety" ? t("coverage.openPlay") : t("coverage.openPolicy")}
                  <span aria-hidden="true"> ↗</span>
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mu-cov__note">{partial ? t("coverage.partial") : t("coverage.full")}</p>
    </section>
  );
}
