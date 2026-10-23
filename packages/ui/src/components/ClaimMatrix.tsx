import type { CSSProperties } from "react";
import type { ClaimMatrixRow } from "@sahamati/contracts";
import { dataTypeLabel } from "@sahamati/i18n";
import { cx, getT, groupOf, type Locale } from "../util";
import { CLASS_COLOR, ClassIcon } from "./ClassIcon";

export type GlyphKind = "collects" | "shares" | "denies" | "vague" | "silent" | "evidence" | "unknown";
export const GLYPHS: GlyphKind[] = ["collects", "shares", "denies", "vague", "silent", "evidence", "unknown"];

/** Drawn glyphs (not font characters) so they render identically everywhere. */
export function Glyph({ kind, size = 16 }: { kind: GlyphKind; size?: number }) {
  return (
    <svg className={cx("mu-glyph", `mu-glyph--${kind}`)} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {kind === "collects" && <circle cx="8" cy="8" r="5" fill="currentColor" />}
      {kind === "shares" && (
        <>
          <circle cx="7" cy="9" r="4.2" fill="currentColor" />
          <path d="M9.5 6.5L14 2M10 2h4v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {kind === "denies" && (
        <>
          <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M4.2 11.8l7.6-7.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {kind === "vague" && <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="0.1 2.9" strokeLinecap="round" />}
      {kind === "silent" && <path d="M4.5 8h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
      {kind === "evidence" && <path d="M8 2.5l5.5 5.5L8 13.5 2.5 8z" fill="currentColor" />}
      {kind === "unknown" && (
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
          <path d="M6.3 6.4a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3M8 11.2v.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function Cell({ kind, label }: { kind: GlyphKind; label: string }) {
  return (
    <td className={cx("mu-matrix__cell", `is-${kind}`)}>
      <span className="mu-matrix__glyph">
        <Glyph kind={kind} />
        <span className="mu-matrix__glyph-text">{label}</span>
      </span>
    </td>
  );
}

export interface ClaimMatrixProps {
  rows: ClaimMatrixRow[];
  locale: Locale;
  labels?: Record<string, string>;
  className?: string;
  /** Show the glyph legend under the table. */
  legend?: boolean;
}

/** An accessible <table>: data types grouped by ontology ancestor, P/D/A columns. */
export function ClaimMatrix({ rows, locale, labels, className, legend = true }: ClaimMatrixProps) {
  const t = getT(locale);
  const groups = new Map<string, ClaimMatrixRow[]>();
  for (const r of rows) {
    const g = groupOf(r.ontology_path);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }
  const g = (k: GlyphKind) => t(`matrix.glyph.${k}`);

  return (
    <div className={cx("mu-matrix", className)}>
      <div className="mu-matrix__scroll" role="region" aria-label={t("matrix.title")} tabIndex={0}>
        <table className="mu-matrix__table">
          <caption>{t("matrix.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("matrix.dataType")}</th>
              <th scope="col">
                <abbr title={t("source.policy")}>{t("matrix.policy")}</abbr>
              </th>
              <th scope="col">
                <abbr title={t("source.data_safety")}>{t("matrix.dataSafety")}</abbr>
              </th>
              <th scope="col">{t("matrix.apk")}</th>
              <th scope="col">{t("matrix.note")}</th>
            </tr>
          </thead>
          {[...groups.entries()].map(([group, items]) => (
            <tbody key={group}>
              <tr className="mu-matrix__group">
                <th scope="rowgroup" colSpan={5}>
                  {dataTypeLabel(t, group, labels)}
                </th>
              </tr>
              {items.map((r) => (
                  <tr
                    key={r.data_type}
                    className={cx("mu-matrix__row", r.conflict_class && "has-conflict")}
                    style={r.conflict_class ? ({ "--row-accent": CLASS_COLOR[r.conflict_class] } as CSSProperties) : undefined}
                  >
                    <th scope="row">
                      <span className="mu-matrix__dt">{dataTypeLabel(t, r.data_type, labels)}</span>
                      <code className="mu-matrix__id">{r.data_type}</code>
                    </th>
                    <Cell kind={r.policy} label={g(r.policy)} />
                    <Cell kind={r.data_safety} label={g(r.data_safety)} />
                    <Cell kind={r.apk} label={g(r.apk)} />
                    <td className="mu-matrix__note">
                      {r.conflict_class ? (
                        <span className="mu-matrix__class">
                          <ClassIcon cls={r.conflict_class} size={16} />
                          <span>{t(`class.${r.conflict_class}`)}</span>
                        </span>
                      ) : (
                        <span className="mu-matrix__none" aria-label="—">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {legend ? (
        <div className="mu-matrix__legend">
          <span className="mu-matrix__legend-title">{t("matrix.legend")}</span>
          <ul>
            {GLYPHS.map((k) => (
              <li key={k}>
                <span className={cx("mu-matrix__cell", `is-${k}`)}>
                  <Glyph kind={k} />
                </span>
                {g(k)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
