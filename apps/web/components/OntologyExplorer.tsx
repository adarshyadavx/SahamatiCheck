"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { Ontology, OntologyNode } from "@sahamati/contracts";
import { createT, formatNumber, type Locale } from "@sahamati/i18n";
import { DemoBanner, cx } from "@sahamati/ui";
import { getOntology } from "@/lib/api";
import { DEMO_ONTOLOGY } from "@/lib/demo";

type Kind = "all" | OntologyNode["kind"];
const KINDS: Kind[] = ["all", "data_type", "actor", "purpose"];

export function OntologyExplorer({ locale }: { locale: Locale }) {
  const t = createT(locale);
  const searchId = useId();
  const [onto, setOnto] = useState<Ontology | null>(null);
  const [offline, setOffline] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");

  useEffect(() => {
    let live = true;
    getOntology()
      .then((o) => live && setOnto(o?.nodes?.length ? o : DEMO_ONTOLOGY))
      .catch(() => {
        if (!live) return;
        setOffline(true);
        setOnto(DEMO_ONTOLOGY);
      });
    return () => {
      live = false;
    };
  }, []);

  const byId = useMemo(() => new Map((onto?.nodes ?? []).map((n) => [`${n.kind}:${n.id}`, n])), [onto]);
  const children = useMemo(() => {
    const m = new Map<string, OntologyNode[]>();
    for (const n of onto?.nodes ?? []) for (const p of n.parents) {
      const k = `${n.kind}:${p}`;
      m.set(k, [...(m.get(k) ?? []), n]);
    }
    return m;
  }, [onto]);

  const label = (n: OntologyNode) => (locale === "hi" ? n.label_hi || n.label_en : n.label_en);

  function pathOf(n: OntologyNode): OntologyNode[] {
    const out: OntologyNode[] = [n];
    const seen = new Set([n.id]);
    let cur = n;
    while (cur.parents[0]) {
      const p = byId.get(`${cur.kind}:${cur.parents[0]}`);
      if (!p || seen.has(p.id)) break;
      seen.add(p.id);
      out.unshift(p);
      cur = p;
    }
    return out;
  }

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (onto?.nodes ?? []).filter(
      (n) =>
        (kind === "all" || n.kind === kind) &&
        (!needle || n.id.toLowerCase().includes(needle) || n.label_en.toLowerCase().includes(needle) || n.label_hi.includes(q.trim())),
    );
  }, [onto, q, kind]);

  if (!onto) return <p className="text-ink-muted" role="status">{t("common.loading")}</p>;

  return (
    <div className="grid gap-6">
      {offline ? <DemoBanner locale={locale} reason="ontologyDemo" /> : null}
      <div className="panel grid gap-4 p-4 sm:p-5">
        <div>
          <label htmlFor={searchId} className="field-label">
            {t("ontology.search")}
          </label>
          <input
            id={searchId}
            type="search"
            className="input"
            placeholder={t("ontology.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-controls={`${searchId}-results`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("ontology.kind.all")}>
          {KINDS.map((k) => (
            <button key={k} type="button" className={cx("mu-chip", kind === k && "is-on")} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(`ontology.kind.${k}`)}
            </button>
          ))}
          <span className="ml-auto font-mono text-xs text-ink-muted" role="status">
            {t("ontology.results", { count: formatNumber(locale, results.length) })} · {t("ontology.version", { version: onto.version })}
          </span>
        </div>
      </div>

      {results.length ? (
        <ul id={`${searchId}-results`} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((n) => {
            const path = pathOf(n);
            const kids = children.get(`${n.kind}:${n.id}`) ?? [];
            return (
              <li key={`${n.kind}:${n.id}`} className="panel grid content-start gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold leading-snug">{label(n)}</h2>
                  <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-[0.68rem] text-ink-muted">
                    {t(`ontology.kind.${n.kind}`)}
                  </span>
                </div>
                <code className="w-fit rounded bg-neel-soft px-1.5 py-0.5 font-mono text-xs text-neel">{n.id}</code>
                <p className="text-xs text-ink-muted" lang={locale === "hi" ? "en" : "hi"}>
                  {locale === "hi" ? n.label_en : n.label_hi}
                </p>
                <div>
                  <p className="text-[0.68rem] font-semibold uppercase tracking-wider text-ink-faint">{t("ontology.path")}</p>
                  {path.length > 1 ? (
                    <ol className="mu-path mt-1 flex flex-wrap gap-1 text-xs text-ink-muted">
                      {path.map((p, i) => (
                        <li key={p.id} className={cx(i === path.length - 1 && "font-semibold text-ink")}>
                          {i > 0 ? <span aria-hidden="true" className="mr-1 text-line-strong">›</span> : null}
                          {label(p)}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-1 text-xs text-ink-muted">{t("ontology.root")}</p>
                  )}
                </div>
                {kids.length ? (
                  <p className="text-xs text-ink-muted">
                    <span className="font-semibold">{t("ontology.children")}:</span> {kids.map(label).join(", ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mu-empty">{t("ontology.none")}</p>
      )}
    </div>
  );
}
