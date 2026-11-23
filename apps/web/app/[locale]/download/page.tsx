import type { Metadata } from "next";
import { statSync } from "node:fs";
import { join } from "node:path";
import { createT, isLocale } from "@sahamati/i18n";
import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  return { title: createT(isLocale(locale) ? locale : "en")("download.title") };
}

const FILES = {
  ext: { href: "/downloads/sahamaticheck-extension-chrome.zip", version: "0.1.0" },
  apk: { href: "/downloads/sahamaticheck.apk", version: "0.1.0" },
} as const;

/** "129 KB": read from the file the site serves, so the page never shows a stale size. */
function fileSize(href: string): string | null {
  try {
    const bytes = statSync(join(process.cwd(), "public", href)).size;
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  } catch {
    return null;
  }
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICON = {
  ext: "M4 4h7v4a2 2 0 1 0 4 0V4h5v7h-4a2 2 0 1 0 0 4h4v5H4z",
  apk: "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M11 18.5h2",
  down: "M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 19.5h14",
};

export default async function DownloadPage({ params }: { params: LocaleParams }) {
  const { t } = await resolveLocale(params);
  return (
    <>
      <PageHeader eyebrow={t("nav.download")} title={t("download.title")} lede={t("download.lede")} />
      <div className="page grid gap-8 py-10 [&>*]:min-w-0">
        <div className="grid gap-6 lg:grid-cols-2">
          {(["ext", "apk"] as const).map((k) => {
            const f = FILES[k];
            const size = fileSize(f.href);
            const steps = t.raw<string[]>(`download.${k}.steps`);
            return (
              <section key={k} aria-labelledby={`dl-${k}`} className="panel grid content-start gap-4 p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-mudra bg-neel-soft text-neel">
                    <Icon d={ICON[k]} />
                  </span>
                  <div className="min-w-0">
                    <h2 id={`dl-${k}`} className="text-2xl font-semibold">
                      {t(`download.${k}.title`)}
                    </h2>
                    <p className="mt-1 text-ink-muted">{t(`download.${k}.body`)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <a href={f.href} download className="btn btn-primary">
                    <Icon d={ICON.down} />
                    {t(`download.${k}.button`)}
                  </a>
                  <span className="text-sm text-ink-muted">
                    {t("download.version", { v: f.version })}
                    {size ? ` · ${size}` : ""}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold">{t(`download.${k}.stepsTitle`)}</h3>
                  <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-[0.95rem]">
                    {steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
                <p className="border-t border-dashed border-line pt-3 text-sm text-ink-muted">{t(`download.${k}.note`)}</p>
              </section>
            );
          })}
        </div>

        <section aria-labelledby="dl-server" className="rounded-mudra border border-dashed border-line-strong bg-surface-sunken p-5 sm:p-6">
          <h2 id="dl-server" className="text-lg font-semibold">
            {t("download.server.title")}
          </h2>
          <p className="mt-1 max-w-[80ch] text-ink-muted">{t("download.server.body")}</p>
          <pre className="mt-3 overflow-x-auto rounded-mudra bg-ink p-4 text-[0.8rem] text-surface">
            <code>{`cd apps/web
NEXT_PUBLIC_API_BASE=same-origin npx next dev -H 0.0.0.0 -p 3100
# then, in the app:  http://<your-computer's-Wi-Fi-IP>:3100`}</code>
          </pre>
          <p className="mt-3 text-sm text-ink-muted">{t("download.server.hint")}</p>
        </section>
      </div>
    </>
  );
}
