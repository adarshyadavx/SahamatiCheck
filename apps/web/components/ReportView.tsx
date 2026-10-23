"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type { Finding, Report } from "@sahamati/contracts";
import { createT, formatDate, type Locale } from "@sahamati/i18n";
import {
  ClaimMatrix,
  CoverageStrip,
  DemoBanner,
  Disclaimer,
  FindingCard,
  GapList,
  IndicatorList,
  ReportCard,
  RulesNotEvaluated,
  StatusCounts,
  SummaryCounts,
  TierBadge,
  TriSourceTriangle,
  edgeOfFinding,
  groupFindings,
  type EdgeId,
  type FindingGroup,
} from "@sahamati/ui";
import { postFeedback } from "@/lib/api";
import { href } from "@/lib/i18n";

export interface ReportViewProps {
  report: Report;
  locale: Locale;
  /** The API was unreachable and this is the bundled fixture. */
  offline?: boolean;
  /** Private self-check result: no dispute link, no share note. */
  privateMode?: boolean;
  /** The demo id that was requested when the Chai Wallet fixture is shown in its place. */
  fallbackFor?: string;
}

function Section({ n, id, title, children, aside }: { n: number; id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="stamp" aria-hidden="true">
          {String(n).padStart(2, "0")}
        </span>
        <h2 id={`${id}-h`} className="mu-section-title !mb-0">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const ORDER: Record<Finding["class"], number> = { declaration_mismatch: 0, internal_contradiction: 1, behavioural_mismatch: 2 };

export function ReportView({ report, locale, offline = false, privateMode = false, fallbackFor }: ReportViewProps) {
  const t = createT(locale);
  const [edge, setEdge] = useState<EdgeId | null>(null);

  const findings = useMemo(
    () =>
      [...report.findings].sort(
        (a, b) => (a.tier === b.tier ? 0 : a.tier === "strong" ? -1 : 1) || ORDER[a.class] - ORDER[b.class] || b.confidence - a.confidence,
      ),
    [report.findings],
  );
  // Older API builds may omit the newer arrays; render what is there and never compute substitutes.
  const indicators = report.indicators ?? [];
  const ruleRuns = report.rule_runs ?? [];
  const groups = useMemo(() => groupFindings(findings), [findings]);
  const filtered = edge && edge !== "gap";
  const visible: FindingGroup[] = filtered
    ? groups.filter((g) => [g.primary, ...g.related].some((f) => edgeOfFinding(f) === edge))
    : groups;
  const strongGroups = visible.filter((g) => g.primary.tier === "strong");
  const indicativeGroups = visible.filter((g) => g.primary.tier !== "strong");
  const rightsHref = href(locale, "/rights");
  const relatedIndicators = (g: FindingGroup) => {
    const ids = new Set([g.primary, ...g.related].map((f) => f.group_id).filter((x): x is string => Boolean(x)));
    return indicators.filter((i) => i.group_id !== undefined && ids.has(i.group_id));
  };
  let n = 0;
  const stamp = () => {
    n += 1;
    return (
      <span className="stamp" aria-hidden="true">
        {String(n).padStart(2, "0")}
      </span>
    );
  };
  const renderGroup = (g: FindingGroup) => (
    <FindingCard
      key={g.primary.id}
      finding={g.primary}
      related={g.related}
      relatedIndicators={relatedIndicators(g)}
      locale={locale}
      highlighted={Boolean(filtered)}
      rightsHref={rightsHref}
      onLooksWrong={(x) => postFeedback(x.id, report.report_id)}
    />
  );

  function select(next: EdgeId | null) {
    setEdge(next);
    if (!next) return;
    const target = next === "gap" ? "not-mentioned" : "findings";
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(target)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sahamaticheck-${report.app.package}-${report.report_id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const exportButton = (
    <button type="button" onClick={exportJson} className="btn btn-secondary !px-4 !py-2 text-sm">
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2v8M4.5 6.8L8 10.3l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t("report.export")}
    </button>
  );

  return (
    <div className="grid gap-14 [&>*]:min-w-0">
      {/* 1. Header, coverage, disclaimer */}
      <header className="grid gap-5 [&>*]:min-w-0">
        {offline ? <DemoBanner locale={locale} reason="offline" /> : null}
        {fallbackFor ? (
          <p className="mu-demo" role="status">
            <span className="mu-demo__tag">{t("common.demo.label")}</span>
            <span>{t("report.fallbackNote", { id: fallbackFor })}</span>
          </p>
        ) : null}
        {report.app.is_demo ? <DemoBanner locale={locale} reason="fabricated" /> : null}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow">{t("report.eyebrow")}</p>
            <h1 className="display mt-3 text-4xl sm:text-5xl">{report.app.title}</h1>
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-ink-muted">{t("report.package")}</dt>
                <dd className="font-mono text-ink">{report.app.package}</dd>
              </div>
              {report.app.developer ? (
                <div className="flex gap-2">
                  <dt className="text-ink-muted">{t("report.developer")}</dt>
                  <dd className="text-ink">{report.app.developer}</dd>
                </div>
              ) : null}
              <div className="flex gap-2">
                <dt className="text-ink-muted">{t("report.generated")}</dt>
                <dd className="text-ink">
                  <time dateTime={report.generated_at}>{formatDate(locale, report.generated_at)}</time>
                </dd>
              </div>
            </dl>
          </div>
          {exportButton}
        </div>
        <CoverageStrip coverage={report.coverage} locale={locale} />
        <Disclaimer locale={locale} generatedAt={report.generated_at} versionCode={report.app.version_code} />
      </header>

      {/* 2. Report card: five answers + ten areas. No overall grade. */}
      {report.card ? <ReportCard card={report.card} findings={report.findings} locale={locale} leading={stamp()} /> : null}

      {/* 3. Triangle and counts: agreement first */}
      <Section n={++n} id="overview" title={t("triangle.title")}>
        <div className="grid gap-6 [&>*]:min-w-0">
          <SummaryCounts summary={report.summary} locale={locale} />
          <div className="panel p-4 sm:p-6">
            <TriSourceTriangle
              summary={report.summary}
              findings={report.findings}
              gaps={report.disclosure_gaps}
              locale={locale}
              selected={edge}
              onSelect={select}
            />
          </div>
        </div>
      </Section>

      {/* 4. Evidence tiers: strong and indicative stay separate; groups shown once with related nested */}
      <Section
        n={++n}
        id="findings"
        title={t("report.findingsTitle")}
        aside={<span className="mu-count">{report.findings.length}</span>}
      >
        <p className="mb-4 max-w-[70ch] text-ink-muted">{t("report.findingsIntro")}</p>
        {filtered ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-mudra border border-neel bg-neel-soft px-4 py-2.5 text-sm" role="status">
            <span className="font-semibold text-neel">{t("triangle.showing", { label: t(`triangle.edge.${edge}`) })}</span>
            <button type="button" className="mu-btn mu-btn--quiet ml-auto" onClick={() => setEdge(null)}>
              {t("triangle.clear")}
            </button>
          </div>
        ) : null}
        <div className="grid gap-10">
          <section id="findings-strong" aria-labelledby="findings-strong-h" className="grid gap-4">
            <div>
              <h3 id="findings-strong-h" className="mu-tier-heading">
                <TierBadge tier="strong" locale={locale} describe={false} />
                <span>{t("report.strongTitle")}</span>
              </h3>
              <p className="mt-1 max-w-[70ch] text-sm text-ink-muted">{t("report.strongIntro")}</p>
            </div>
            {strongGroups.length ? (
              <div className="grid gap-5">{strongGroups.map(renderGroup)}</div>
            ) : (
              <p className="mu-empty">{filtered ? t("report.noneForFilter") : t("report.noStrong")}</p>
            )}
          </section>
          <section id="findings-indicative" aria-labelledby="findings-indicative-h" className="grid gap-4">
            <div>
              <h3 id="findings-indicative-h" className="mu-tier-heading">
                <TierBadge tier="indicative" locale={locale} describe={false} />
                <span>{t("report.indicativeTitle")}</span>
              </h3>
              <p className="mt-1 max-w-[70ch] text-sm text-ink-muted">{t("report.indicativeIntro")}</p>
            </div>
            {indicativeGroups.length ? (
              <div className="grid gap-5">{indicativeGroups.map(renderGroup)}</div>
            ) : (
              <p className="mu-empty">{filtered ? t("report.noneForFilter") : t("report.noIndicative")}</p>
            )}
          </section>
        </div>
      </Section>

      {/* 5. Not mentioned anywhere: its own section, never counted as conflicts */}
      <GapList
        gaps={report.disclosure_gaps}
        locale={locale}
        highlighted={edge === "gap"}
        className="scroll-mt-24"
        leading={stamp()}
      />

      {/* 6. Worth a closer look: investigation rules, never counted as differences */}
      <IndicatorList indicators={indicators} findings={report.findings} locale={locale} leading={stamp()} />

      {/* 7. Claim matrix */}
      <Section n={++n} id="matrix" title={t("matrix.title")}>
        <ClaimMatrix rows={report.matrix} locale={locale} />
      </Section>

      {/* 8. Coverage and rule outcomes */}
      <Section n={++n} id="coverage" title={t("report.coverageTitle")}>
        <div className="grid gap-5 [&>*]:min-w-0">
          <CoverageStrip coverage={report.coverage} locale={locale} />
          {report.status_counts ? <StatusCounts counts={report.status_counts} locale={locale} /> : null}
        </div>
      </Section>

      {/* 9. Appendix: rules that could not run */}
      <RulesNotEvaluated ruleRuns={ruleRuns} locale={locale} leading={stamp()} />

      {/* Footer: dispute, versions, export */}
      <footer className="grid gap-4 border-t border-dashed border-line-strong pt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {!privateMode ? (
              <Link
                href={`${href(locale, "/about")}?report=${encodeURIComponent(report.report_id)}#dispute`}
                className="font-semibold"
              >
                {t("report.dispute")} →
              </Link>
            ) : null}
            <Link href={href(locale, "/rules")} className="font-semibold">
              {t("rules.title")} →
            </Link>
          </span>
          {exportButton}
        </div>
        <p className="font-mono text-xs text-ink-muted">
          {t("report.versions", {
            engine: report.versions.engine,
            ontology: report.versions.ontology,
            extractor: report.versions.extractor,
          })}{" "}
          · {report.report_id}
        </p>
        {!privateMode ? <p className="text-xs text-ink-faint">{t("report.share")}</p> : null}
      </footer>
    </div>
  );
}
