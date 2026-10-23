import type { Metadata } from "next";
import { createT, isLocale } from "@sahamati/i18n";
import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { CheckForm } from "@/components/CheckForm";

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  return { title: createT(isLocale(locale) ? locale : "en")("check.title") };
}

export default async function CheckPage({ params }: { params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  return (
    <>
      <PageHeader eyebrow={t("nav.check")} title={t("check.title")} lede={t("check.lede")} />
      <div className="page py-10">
        <div className="max-w-3xl">
          <CheckForm locale={locale} />
        </div>
      </div>
    </>
  );
}
