import type { Metadata } from "next";
import { createT, isLocale } from "@sahamati/i18n";

import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { CopyButton } from "@/components/CopyButton";

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  return { title: createT(isLocale(locale) ? locale : "en")("rights.title") };
}

export default async function RightsPage({ params }: { params: LocaleParams }) {
  const { t } = await resolveLocale(params);
  const items = t.raw<Array<{ title: string; ref: string; body: string }>>("rights.items");
  const letter = t("rights.letter", { app: t("rights.letterApp"), dataType: t("rights.letterDataType") });
  return (
    <>
      <PageHeader eyebrow={t("nav.rights")} title={t("rights.title")} lede={t("rights.lede")}>
        <p className="mt-5 inline-flex rounded-full border border-dashed border-ink-muted px-3 py-1 text-xs font-semibold text-ink-muted">
          {t("common.notLegalAdvice")}
        </p>
      </PageHeader>
      <div className="page grid gap-14 py-12 [&>*]:min-w-0">
        <section aria-labelledby="rights-h">
          <h2 id="rights-h" className="display text-3xl">{t("rights.rightsTitle")}</h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => (
              <li key={it.title} className="panel p-5">
                <span className="font-mono text-xs font-semibold text-neel">{it.ref}</span>
                <h3 className="mt-1 text-lg font-semibold">{it.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{it.body}</p>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="duties-h" className="max-w-3xl border-l-2 border-behaviour pl-5">
          <h2 id="duties-h" className="text-2xl font-semibold">{t("rights.dutiesTitle")}</h2>
          <p className="mt-2 text-ink-muted">{t("rights.duties")}</p>
        </section>
        <section aria-labelledby="letter-h" className="max-w-3xl">
          <h2 id="letter-h" className="display text-3xl">{t("rights.letterTitle")}</h2>
          <p className="mt-2 text-ink-muted">{t("rights.letterIntro")}</p>
          <div className="panel mt-5 p-5">
            <pre className="whitespace-pre-wrap font-body text-[0.95rem] leading-relaxed text-ink">{letter}</pre>
            <div className="mt-4 border-t border-dashed border-line pt-4">
              <CopyButton text={letter} label={t("rights.copy")} done={t("rights.copied")} />
            </div>
          </div>
        </section>
        <p className="max-w-3xl text-sm text-ink-muted">{t("rights.disclaimer")}</p>
      </div>
    </>
  );
}
