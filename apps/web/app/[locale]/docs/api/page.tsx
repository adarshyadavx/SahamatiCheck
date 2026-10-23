import type { Metadata } from "next";
import { createT, isLocale } from "@sahamati/i18n";
import { PUBLIC_API_BASE } from "@/lib/api";
import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  return { title: createT(isLocale(locale) ? locale : "en")("docs.title") };
}

const ENDPOINTS: Array<[string, string, string]> = [
  ["POST", "/v1/checks", "checks"],
  ["GET", "/v1/jobs/{id}", "job"],
  ["GET", "/v1/jobs/{id}/events", "events"],
  ["GET", "/v1/reports/{report_id}", "reportById"],
  ["GET", "/v1/apps/{package}/report", "report"],
  ["GET", "/v1/apps/{package}/policy-history", "history"],
  ["POST", "/v1/policy/segments", "segments"],
  ["POST", "/v1/self-check", "selfCheck"],
  ["GET", "/v1/ontology", "ontology"],
  ["GET", "/v1/rules", "rules"],
  ["POST", "/v1/findings/{id}/feedback", "feedback"],
  ["POST", "/v1/disputes", "disputes"],
  ["GET", "/v1/audit/aggregates", "aggregates"],
  ["GET", "/healthz", "health"],
];

export default async function ApiDocsPage({ params }: { params: LocaleParams }) {
  const { t } = await resolveLocale(params);
  const example = `curl -s -X POST ${PUBLIC_API_BASE}/v1/checks \\
  -H 'Content-Type: application/json' \\
  -d '{"package_name": "in.example.chaiwallet"}'`;
  return (
    <>
      <PageHeader eyebrow={t("nav.api")} title={t("docs.title")} lede={t("docs.lede")} />
      <div className="page grid gap-10 py-12 [&>*]:min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink-muted">{t("docs.base")}</span>
          <code className="rounded-md bg-neel-soft px-2 py-1 font-mono text-sm text-neel">{PUBLIC_API_BASE}</code>
          <a href={`${PUBLIC_API_BASE}/docs`} className="btn btn-secondary !py-1.5 text-sm" rel="noopener">{t("docs.interactive")}</a>
          <a href={`${PUBLIC_API_BASE}/openapi.json`} className="btn btn-ghost !py-1.5 text-sm" rel="noopener">{t("docs.openapi")}</a>
        </div>
        <div className="overflow-x-auto rounded-mudra border border-line bg-surface-raised">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wider text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5">{t("docs.method")}</th>
                <th scope="col" className="px-4 py-2.5">{t("docs.path")}</th>
                <th scope="col" className="px-4 py-2.5">{t("docs.purpose")}</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map(([m, p, k]) => (
                <tr key={`${m}${p}`} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold ${m === "GET" ? "bg-agree-soft text-agree" : "bg-neel-soft text-neel"}`}>{m}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[0.82rem] text-ink">{p}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{t(`docs.endpoints.${k}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <section className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <h2 className="text-xl font-semibold">{t("docs.exampleTitle")}</h2>
            <pre className="mt-3 overflow-x-auto rounded-mudra bg-ink p-4 text-[0.8rem] leading-relaxed text-surface"><code>{example}</code></pre>
          </div>
          <div>
            <h2 className="text-xl font-semibold">{t("docs.limitsTitle")}</h2>
            <p className="mt-3 text-ink-muted">{t("docs.limits")}</p>
          </div>
        </section>
      </div>
    </>
  );
}
