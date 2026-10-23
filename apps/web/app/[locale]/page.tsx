import Link from "next/link";
import { ClassIcon, TierBadge, TriSourceTriangle, type ClassId } from "@sahamati/ui";
import { DEMO_REPORT, DEMO_REPORT_ID } from "@/lib/demo";
import { href, resolveLocale, type LocaleParams } from "@/lib/i18n";
import { SealRings } from "@/components/PageHeader";

const CLASSES: Array<{ cls: ClassId; tier: "strong" | "indicative" | "not_mentioned" }> = [
  { cls: "internal_contradiction", tier: "strong" },
  { cls: "declaration_mismatch", tier: "strong" },
  { cls: "behavioural_mismatch", tier: "indicative" },
  { cls: "disclosure_gap", tier: "not_mentioned" },
];

export default async function HomePage({ params }: { params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  const how = t.raw<Array<{ title: string; body: string }>>("home.how");
  const principles = t.raw<Array<{ title: string; body: string }>>("home.principles");
  const surfaces = t.raw<Array<{ title: string; body: string }>>("home.surfaces");
  const r = DEMO_REPORT;

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <span
          aria-hidden="true"
          lang="hi"
          className="pointer-events-none absolute -left-6 bottom-[-0.32em] select-none font-display text-[clamp(7rem,22vw,17rem)] font-bold leading-none text-neel opacity-[0.05]"
        >
          सहमति
        </span>
        <div className="page relative grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="eyebrow">{t("home.eyebrow")}</p>
            <h1 className="display mt-4 text-[2.6rem] sm:text-6xl lg:text-[4.1rem]">{t("home.title")}</h1>
            <p className="lede mt-6">{t("home.lede")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={href(locale, "/check")} className="btn btn-primary">
                {t("home.ctaCheck")}
                <span aria-hidden="true">→</span>
              </Link>
              <Link href={href(locale, `/r/${DEMO_REPORT_ID}`)} className="btn btn-secondary">
                {t("home.ctaDemo")}
              </Link>
              <Link href={href(locale, "/self-check")} className="btn btn-ghost">
                {t("home.ctaSelf")}
              </Link>
            </div>
          </div>

          <div className="relative">
            <SealRings className="pointer-events-none absolute left-1/2 top-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 text-neel opacity-[0.07]" />
            <div className="panel relative p-5 shadow-2 sm:p-6">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-semibold leading-tight">{r.app.title}</p>
                  <p className="font-mono text-xs text-ink-muted">{r.app.package}</p>
                </div>
                <span className="rounded-md border border-dashed border-behaviour bg-behaviour-soft px-2 py-1 font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-ink">
                  {t("common.demo.label")}
                </span>
              </div>
              <TriSourceTriangle
                summary={r.summary}
                findings={r.findings}
                gaps={r.disclosure_gaps}
                locale={locale}
                animated
                showLegend={false}
              />
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-dashed border-line pt-3 text-xs text-ink-muted">
                <span>{t("home.demoCaption")}</span>
                <Link href={href(locale, `/r/${DEMO_REPORT_ID}`)} className="font-semibold">
                  {t("home.ctaDemo")} →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="page py-16 sm:py-20" aria-labelledby="how">
        <h2 id="how" className="display text-3xl sm:text-4xl">
          {t("home.howTitle")}
        </h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {how.map((s, i) => (
            <li key={s.title} className="panel relative p-5">
              <span className="stamp">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
              <p className="mt-2 text-[0.95rem] text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Classes */}
      <section className="border-y border-line bg-surface-raised" aria-labelledby="classes">
        <div className="page py-16 sm:py-20">
          <h2 id="classes" className="display text-3xl sm:text-4xl">
            {t("home.classesTitle")}
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CLASSES.map(({ cls, tier }) => (
              <li key={cls} className="panel flex flex-col gap-3 p-5">
                <ClassIcon cls={cls} size={34} />
                <h3 className="text-lg font-semibold">{t(`class.${cls}`)}</h3>
                <p className="flex-1 text-sm text-ink-muted">{t(`class.desc.${cls}`)}</p>
                <div>
                  <TierBadge tier={tier} locale={locale} />
                </div>
                <p className="text-xs text-ink-faint">{t(`tier.desc.${tier}`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Principles */}
      <section className="page py-16 sm:py-20" aria-labelledby="principles">
        <h2 id="principles" className="display text-3xl sm:text-4xl">
          {t("home.principlesTitle")}
        </h2>
        <dl className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {principles.map((p) => (
            <div key={p.title} className="border-l-2 border-neel pl-5">
              <dt className="font-display text-xl font-semibold">{p.title}</dt>
              <dd className="mt-1.5 text-ink-muted">{p.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Surfaces */}
      <section className="page pb-4" aria-labelledby="surfaces">
        <h2 id="surfaces" className="sr-only">
          {t("home.surfacesTitle")}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {surfaces.map((s, i) => (
            <div
              key={s.title}
              className={`rounded-mudra p-7 ${i === 0 ? "bg-neel text-onneel" : "panel"}`}
            >
              <h3 className={`text-2xl font-semibold ${i === 0 ? "text-onneel" : ""}`}>{s.title}</h3>
              <p className={`mt-2 ${i === 0 ? "opacity-90" : "text-ink-muted"}`}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
