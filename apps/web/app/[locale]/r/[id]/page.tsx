import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Report } from "@sahamati/contracts";
import { createT, isLocale, type Locale } from "@sahamati/i18n";
import { ApiError, fetchReport, fetchVersion, isStaleBackend } from "@/lib/api";
import { DEMO_REPORT, DEMO_REPORT_ID, isKnownDemoId } from "@/lib/demo";
import { href, resolveLocale } from "@/lib/i18n";
import { ReportView } from "@/components/ReportView";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; id: string }>;

type Loaded =
  | { kind: "report"; report: Report; offline: boolean; requestedId?: string }
  | { kind: "unavailable" }
  | null;

/**
 * GET /v1/reports/{id}.
 * - Known demo id the API lacks (404), or API unreachable / 5xx: show the committed Chai Wallet
 *   fixture. If another demo id was requested, a note says so.
 * - Unknown id + 404: 404 page.
 * - Unknown id + API unreachable / 5xx: an honest "could not load" page, never a demo.
 */
async function loadReport(id: string, locale: Locale): Promise<Loaded> {
  try {
    return { kind: "report", report: await fetchReport(id, locale), offline: false };
  } catch (err) {
    const known = isKnownDemoId(id);
    if (err instanceof ApiError && err.status === 404) {
      if (!known) return null;
      return { kind: "report", report: DEMO_REPORT, offline: false, requestedId: id };
    }
    if (known) return { kind: "report", report: DEMO_REPORT, offline: true, requestedId: id };
    return { kind: "unavailable" };
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = createT(isLocale(locale) ? locale : "en");
  return {
    title: t("report.eyebrow"),
    description: t("meta.reportDescription"),
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  };
}

export default async function ReportPage({ params }: { params: Params }) {
  const { id } = await params;
  const { locale, t } = await resolveLocale(params);
  const loaded = await loadReport(id, locale);
  if (!loaded) notFound();
  // Warn when the backend is older than this build. Skipped when the report itself came from the offline fixture.
  const probe = loaded.kind === "report" && !loaded.offline ? await fetchVersion().then((v) => ({ v }), () => null) : null;
  const stale = probe ? isStaleBackend(probe.v) : false;
  if (loaded.kind === "unavailable") {
    return (
      <div className="page py-16">
        <div className="panel mx-auto grid max-w-2xl gap-4 p-6 sm:p-8" role="alert">
          <h1 className="display text-3xl">{t("report.unreachableTitle")}</h1>
          <p className="text-ink-muted">{t("report.unreachableBody")}</p>
          <div className="flex flex-wrap gap-3">
            <Link className="btn btn-primary" href={href(locale, `/r/${DEMO_REPORT_ID}`)}>
              {t("report.tryDemo")}
            </Link>
            <Link className="btn btn-secondary" href={href(locale, "/check")}>
              {t("nav.check")}
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="page py-10 sm:py-14">
      {stale ? (
        <p className="panel mb-6 p-4" role="alert" data-testid="stale-backend">
          {t("report.staleBackend")}
        </p>
      ) : null}
      <ReportView
        report={loaded.report}
        locale={locale}
        offline={loaded.offline}
        fallbackFor={loaded.requestedId && loaded.requestedId !== loaded.report.report_id ? loaded.requestedId : undefined}
      />
    </div>
  );
}
