import type { Metadata } from "next";
import { createT, isLocale } from "@sahamati/i18n";
import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { SelfCheckForm } from "@/components/SelfCheckForm";

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  return { title: createT(isLocale(locale) ? locale : "en")("selfCheck.title"), robots: { index: false } };
}

export default async function SelfCheckPage({ params }: { params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  return (
    <>
      <PageHeader eyebrow={t("nav.selfCheck")} title={t("selfCheck.title")} lede={t("selfCheck.lede")} />
      <div className="page py-10">
        <SelfCheckForm locale={locale} />
        <div className="mt-8 max-w-3xl">
          <p className="text-sm text-ink-muted">{t("selfCheck.cli")}</p>
          <pre className="mt-2 overflow-x-auto rounded-mudra bg-ink p-4 text-[0.8rem] text-surface">
            <code>sahamati-check --apk app-release.apk --policy https://example.in/privacy --data-safety ds.json</code>
          </pre>
        </div>
      </div>
    </>
  );
}
