import type { Metadata } from "next";
import { Suspense } from "react";
import { createT, isLocale } from "@sahamati/i18n";
import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { DisputeForm } from "@/components/DisputeForm";

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  return { title: createT(isLocale(locale) ? locale : "en")("about.title") };
}

export default async function AboutPage({ params }: { params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  const body = t.raw<string[]>("about.body");
  const dispute = t.raw<string[]>("about.dispute");
  return (
    <>
      <PageHeader eyebrow={t("nav.about")} title={t("about.title")} lede={t("about.lede")} />
      <div className="page grid gap-14 py-12 [&>*]:min-w-0">
        <section className="max-w-3xl">
          {body.map((p) => (
            <p key={p.slice(0, 24)} className="mt-3 text-lg leading-relaxed text-ink first:mt-0">{p}</p>
          ))}
        </section>
        <section id="dispute" aria-labelledby="dispute-h" className="grid scroll-mt-24 gap-8 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <h2 id="dispute-h" className="display text-3xl">{t("about.disputeTitle")}</h2>
            <ol className="mt-5 grid gap-4">
              {dispute.map((d, i) => (
                <li key={d.slice(0, 24)} className="flex gap-4">
                  <span className="stamp" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-ink">{d}</p>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="mb-3 text-xl font-semibold">{t("about.formTitle")}</h3>
            <Suspense fallback={null}>
              <DisputeForm locale={locale} />
            </Suspense>
          </div>
        </section>
        <section aria-labelledby="cite-h" className="max-w-3xl">
          <h2 id="cite-h" className="text-2xl font-semibold">{t("about.citeTitle")}</h2>
          <pre className="mt-3 whitespace-pre-wrap rounded-mudra border border-line bg-surface-raised p-4 font-mono text-sm">
            {t("about.citation")}
          </pre>
        </section>
      </div>
    </>
  );
}
