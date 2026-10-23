import type { Metadata } from "next";
import { createT, isLocale } from "@sahamati/i18n";
import { ClassIcon, TierBadge, type ClassId } from "@sahamati/ui";
import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  return { title: createT(isLocale(locale) ? locale : "en")("methodology.title") };
}

const CLASSES: Array<{ cls: ClassId; tier: "strong" | "indicative" | "not_mentioned"; w: string }> = [
  { cls: "internal_contradiction", tier: "strong", w: "1.0" },
  { cls: "declaration_mismatch", tier: "strong", w: "1.0" },
  { cls: "behavioural_mismatch", tier: "indicative", w: "0.7" },
  { cls: "disclosure_gap", tier: "not_mentioned", w: "0.4" },
];

export default async function MethodologyPage({ params }: { params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  const sections = t.raw<Array<{ title: string; body: string[] }>>("methodology.sections");
  return (
    <>
      <PageHeader eyebrow={t("nav.methodology")} title={t("methodology.title")} lede={t("methodology.lede")} />
      <div className="page grid gap-12 py-12 lg:grid-cols-[14rem_1fr] [&>*]:min-w-0">
        <nav aria-label={t("methodology.title")} className="hidden lg:block">
          <ol className="sticky top-24 grid gap-2 text-sm">
            {sections.map((s, i) => (
              <li key={s.title}>
                <a href={`#m-${i + 1}`} className="text-ink-muted no-underline hover:text-neel">
                  <span className="font-mono text-xs">{String(i + 1).padStart(2, "0")}</span> {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="grid max-w-3xl gap-12 [&>*]:min-w-0">
          {sections.map((s, i) => (
            <section key={s.title} id={`m-${i + 1}`} aria-labelledby={`m-${i + 1}-h`} className="scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="stamp" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 id={`m-${i + 1}-h`} className="text-2xl font-semibold">
                  {s.title}
                </h2>
              </div>
              {s.body.map((p) => (
                <p key={p.slice(0, 24)} className="mt-3 leading-relaxed text-ink">
                  {p}
                </p>
              ))}
              {i === 2 ? (
                <div className="mt-5 overflow-x-auto rounded-mudra border border-line bg-surface-raised">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wider text-ink-muted">
                      <tr>
                        <th scope="col" className="px-4 py-2.5">{t("methodology.classTable.class")}</th>
                        <th scope="col" className="px-4 py-2.5">{t("methodology.classTable.compares")}</th>
                        <th scope="col" className="px-4 py-2.5">{t("methodology.classTable.tier")}</th>
                        <th scope="col" className="px-4 py-2.5 text-right">{t("methodology.classTable.weight")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CLASSES.map((c) => (
                        <tr key={c.cls} className="border-t border-line">
                          <th scope="row" className="px-4 py-3 text-left font-semibold">
                            <span className="inline-flex items-center gap-2">
                              <ClassIcon cls={c.cls} size={18} />
                              {t(`class.${c.cls}`)}
                            </span>
                          </th>
                          <td className="px-4 py-3 text-ink-muted">{t(`class.desc.${c.cls}`)}</td>
                          <td className="px-4 py-3"><TierBadge tier={c.tier} locale={locale} /></td>
                          <td className="px-4 py-3 text-right font-mono">{c.w}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {i === 3 ? (
                <pre className="mt-5 overflow-x-auto rounded-mudra bg-ink p-4 text-sm text-surface">
                  <code>{t("methodology.formula")}</code>
                </pre>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
