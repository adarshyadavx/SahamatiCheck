import type { Metadata } from "next";
import { createT, isLocale } from "@sahamati/i18n";
import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { AuditView } from "@/components/AuditView";

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  return { title: createT(isLocale(locale) ? locale : "en")("audit.title") };
}

export default async function AuditPage({ params }: { params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  return (
    <>
      <PageHeader eyebrow={t("nav.audit")} title={t("audit.title")} lede={t("audit.lede")} />
      <div className="page py-10">
        <AuditView locale={locale} />
      </div>
    </>
  );
}
