import type { Metadata } from "next";
import { createT, isLocale } from "@sahamati/i18n";
import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { OntologyExplorer } from "@/components/OntologyExplorer";

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  return { title: createT(isLocale(locale) ? locale : "en")("ontology.title") };
}

export default async function OntologyPage({ params }: { params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  return (
    <>
      <PageHeader eyebrow={t("nav.ontology")} title={t("ontology.title")} lede={t("ontology.lede")} />
      <div className="page py-10">
        <OntologyExplorer locale={locale} />
      </div>
    </>
  );
}
