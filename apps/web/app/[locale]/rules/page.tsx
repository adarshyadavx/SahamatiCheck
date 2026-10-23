import type { Metadata } from "next";
import { createT, isLocale } from "@sahamati/i18n";
import { ApiError, PUBLIC_API_BASE, fetchRules, type RuleRegistryEntry } from "@/lib/api";
import { resolveLocale, type LocaleParams } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const { locale } = await params;
  return { title: createT(isLocale(locale) ? locale : "en")("rules.title") };
}

type Loaded = { kind: "ok"; rules: RuleRegistryEntry[] } | { kind: "notFound" } | { kind: "unreachable" };

async function load(): Promise<Loaded> {
  try {
    return { kind: "ok", rules: await fetchRules() };
  } catch (err) {
    // 404/405: the API is up but predates GET /v1/rules. Anything else: treat as unreachable.
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return { kind: "notFound" };
    return { kind: "unreachable" };
  }
}

export default async function RulesPage({ params }: { params: LocaleParams }) {
  const { t } = await resolveLocale(params);
  const loaded = await load();
  return (
    <>
      <PageHeader eyebrow={t("nav.rules")} title={t("rules.title")} lede={t("rules.lede")} />
      <div className="page py-10 [&>*]:min-w-0">
        {loaded.kind === "unreachable" ? (
          <p className="mu-empty" role="alert">
            {t("rules.unreachable", { base: PUBLIC_API_BASE })}
          </p>
        ) : loaded.kind === "notFound" ? (
          <p className="mu-empty" role="status">
            {t("rules.notFound")}
          </p>
        ) : loaded.rules.length === 0 ? (
          <p className="mu-empty" role="status">
            {t("rules.empty")}
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-muted">{t("rules.count", { n: loaded.rules.length })}</p>
            <div className="overflow-x-auto rounded-mudra border border-line bg-surface-raised">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wider text-ink-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">{t("rules.colId")}</th>
                    <th scope="col" className="px-4 py-2.5">{t("rules.colName")}</th>
                    <th scope="col" className="px-4 py-2.5">{t("rules.colFamily")}</th>
                    <th scope="col" className="px-4 py-2.5">{t("rules.colPhase")}</th>
                    <th scope="col" className="px-4 py-2.5">{t("rules.colEnabled")}</th>
                    <th scope="col" className="px-4 py-2.5">{t("rules.colVersion")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loaded.rules.map((r) => (
                    <tr key={r.id} className="border-t border-line" data-rule={r.id} data-enabled={r.enabled}>
                      <th scope="row" className="px-4 py-2.5 text-left font-mono text-[0.82rem] font-semibold text-ink">{r.id}</th>
                      <td className="px-4 py-2.5 text-ink">{r.name}</td>
                      <td className="px-4 py-2.5 font-mono text-ink-muted">{r.family}</td>
                      <td className="px-4 py-2.5 font-mono text-ink-muted">{r.phase}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            r.enabled ? "border-agree bg-agree-soft text-agree" : "border-dashed border-line-strong text-ink-muted"
                          }`}
                        >
                          <span aria-hidden="true">{r.enabled ? "●" : "○"}</span>
                          {r.enabled ? t("rules.on") : t("rules.off")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-ink-muted">{r.version ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
