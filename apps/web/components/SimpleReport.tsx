import Link from "next/link";
import type { ReactNode } from "react";
import type { DataFlow, DisclosureGap, Evidence, Finding, Report, SourceName } from "@sahamati/contracts";
import { categoryI18nKey, createT, type Locale, type Translator } from "@sahamati/i18n";
import { StatusBadge, cx, safeHref, sourceReasonText } from "@sahamati/ui";

/**
 * The plain-language report: what was read, the numbers that matter, where each kind of data goes,
 * and what does not add up. Display only: every fact comes from the report JSON (CLAUDE.md rule 5).
 */

const SOURCES: SourceName[] = ["policy", "data_safety", "apk"];

function sideSource(s: string): SourceName {
  return s === "apk_permission" || s === "apk_sdk" ? "apk" : (s as SourceName);
}

function label(locale: Locale, x: { label_en: string; label_hi: string }): string {
  return locale === "hi" ? x.label_hi : x.label_en;
}

/** What one side of a finding says, in words: a policy quote, a Play Store row, or what the app's code asks for. */
function evidenceText(t: Translator, e: Evidence): { text: string; quoted: boolean } {
  if (e.quote) return { text: e.quote, quoted: true };
  if (e.label) return { text: e.label, quoted: true };
  if (e.permission)
    return { text: t("simple.ev.permission", { p: e.permission.replace(/^android\.permission\./, "") }), quoted: false };
  if (e.sdk) return { text: t("simple.ev.sdk", { s: e.sdk }), quoted: false };
  return { text: "", quoted: false };
}

/* ---------- small icons (stroke = currentColor) ---------- */

const ICONS: Record<string, string> = {
  location: "M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z M12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  contacts: "M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M4.5 20c.9-3.6 3.9-5.5 7.5-5.5s6.6 1.9 7.5 5.5",
  photos_files: "M4 5h16v14H4z M4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17 M15.5 9.5h.01",
  camera_mic: "M4 8h3l1.5-2h7L17 8h3v11H4z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  messages_calls: "M4 5h16v11H9l-5 4z M8 9.5h8 M8 12.5h5",
  money_payments: "M3 6h18v12H3z M3 10h18 M7 15h3",
  identity: "M3 5h18v14H3z M8.5 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M5.5 16c.5-1.8 1.6-2.7 3-2.7s2.5.9 3 2.7 M14 9h4 M14 12.5h4",
  health: "M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z",
  ads_tracking: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12.5a.5.5 0 1 0 0-1",
  account_profile:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6.5 18.2c1.2-2 3.2-3.2 5.5-3.2s4.3 1.2 5.5 3.2",
  other: "M6 6h.01 M12 6h.01 M18 6h.01 M6 12h.01 M12 12h.01 M18 12h.01 M6 18h.01 M12 18h.01 M18 18h.01",
  company: "M4 20V6l6-2v16 M10 9h10v11 M4 20h17 M7 8h.01 M7 12h.01 M7 16h.01 M14 13h.01 M17 13h.01 M14 16.5h.01 M17 16.5h.01",
};

function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx("h-5 w-5 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name] ?? ICONS.other} />
    </svg>
  );
}

function Pill({ tone, children }: { tone: "shared" | "kept" | "sold" | "muted" | "warn"; children: ReactNode }) {
  const tones = {
    shared: "bg-behaviour-soft text-ink border-behaviour",
    sold: "bg-internal-soft text-ink border-internal",
    kept: "bg-neel-soft text-ink border-neel",
    muted: "bg-surface-sunken text-ink-muted border-line",
    warn: "bg-internal-soft text-ink border-internal",
  } as const;
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

/* ---------- 1. what we read ---------- */

function SourcesRead({ report, t }: { report: Report; t: Translator }) {
  return (
    <section aria-labelledby="sr-read" className="grid gap-2">
      <h2 id="sr-read" className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        {t("simple.read.title")}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-3">
        {SOURCES.map((s) => {
          const ok = report.coverage[s] === "ok";
          const note = report.sources?.[s];
          const reason = ok ? null : sourceReasonText(t, note?.reason);
          const link = safeHref(note?.url);
          return (
            <li
              key={s}
              className={cx(
                "flex gap-3 rounded-mudra border p-3",
                ok ? "border-line bg-surface-raised" : "border-dashed border-line-strong bg-surface-sunken",
              )}
              data-source={s}
            >
              <span
                className={cx(
                  "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm font-bold",
                  ok ? "bg-agree text-surface-raised" : "border-2 border-dashed border-gap text-gap",
                )}
                aria-hidden="true"
              >
                {ok ? "✓" : "–"}
              </span>
              <div className="min-w-0">
                <p className="font-semibold leading-tight">{t(`simple.src.${s}`)}</p>
                <p className="text-sm text-ink-muted">{ok ? t("simple.read.ok") : t("simple.read.notOk")}</p>
                {reason ? <p className="mt-1 text-sm leading-snug text-ink">{reason}</p> : null}
                {ok && note?.method === "androzoo" ? (
                  <p className="mt-1 text-sm leading-snug text-ink-muted">{t("coverage.viaAndroZoo")}</p>
                ) : null}
                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="mt-1 inline-block text-sm font-medium"
                  >
                    {s === "data_safety" ? t("coverage.openPlay") : t("coverage.openPolicy")} <span aria-hidden="true">↗</span>
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- 2. in short ---------- */

function Stat({ n, text, note, tone, href }: { n: number; text: string; note: string; tone: string; href?: string }) {
  const body = (
    <>
      <span className={cx("font-display text-4xl font-bold leading-none tabular-nums", tone)}>{n}</span>
      <span className="font-semibold leading-snug text-ink">{text}</span>
      <span className="text-sm leading-snug text-ink-muted">{note}</span>
    </>
  );
  const cls = "grid content-start gap-1.5 rounded-mudra border border-line bg-surface-raised p-4 no-underline shadow-1";
  return href ? (
    <a href={href} className={cx(cls, "transition-colors hover:border-neel")}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function InShort({ report, flows, t }: { report: Report; flows: DataFlow[]; t: Translator }) {
  const collected = flows.filter((f) => f.collected).length;
  const shared = flows.filter((f) => f.shared).length;
  const mismatches = report.findings.length;
  const gaps = report.disclosure_gaps.length;
  return (
    <section aria-labelledby="sr-short" className="grid gap-3">
      <h2 id="sr-short" className="font-display text-2xl font-bold">
        {t("simple.summary.title")}
      </h2>
      <div className={cx("grid grid-cols-2 gap-3", report.coverage.apk === "ok" ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        <Stat
          n={collected}
          text={t("simple.summary.collected")}
          note={t("simple.summary.collectedNote")}
          tone="text-neel"
          href="#data-flows"
        />
        <Stat
          n={shared}
          text={t("simple.summary.shared")}
          note={t("simple.summary.sharedNote")}
          tone="text-behaviour"
          href="#data-flows"
        />
        <Stat
          n={mismatches}
          text={t("simple.summary.mismatch")}
          note={mismatches ? t("simple.summary.mismatchNote") : t("simple.summary.noIssues")}
          tone={mismatches ? "text-internal" : "text-agree"}
          href="#issues"
        />
        {report.coverage.apk === "ok" ? (
          <Stat n={gaps} text={t("simple.summary.gaps")} note={t("simple.summary.gapsNote")} tone="text-gap" href="#issues" />
        ) : null}
      </div>
    </section>
  );
}

/* ---------- 3. where your data goes ---------- */

function Recipients({ flows, locale, t }: { flows: DataFlow[]; locale: Locale; t: Translator }) {
  const by = new Map<string, { name: string; items: string[] }>();
  for (const f of flows) {
    for (const r of f.recipients) {
      const e = by.get(r.id) ?? { name: label(locale, r), items: [] };
      e.items.push(label(locale, f));
      by.set(r.id, e);
    }
  }
  return (
    <div className="grid gap-2">
      <h3 className="text-lg font-semibold">{t("simple.flow.recipientsTitle")}</h3>
      {by.size ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[...by.entries()].map(([id, e]) => (
            <li key={id} className="flex gap-3 rounded-mudra border border-behaviour bg-behaviour-soft p-3">
              <Icon name="company" className="mt-0.5 text-behaviour" />
              <div className="min-w-0">
                <p className="font-semibold">{e.name}</p>
                <p className="text-sm text-ink-muted">
                  {e.items.length === 1 ? t("simple.flow.kinds_one") : t("simple.flow.kinds", { n: e.items.length })}
                </p>
                <p className="mt-1 text-sm leading-snug text-ink">{e.items.join(", ")}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-mudra border border-line bg-surface-raised p-3 text-ink-muted">{t("simple.flow.recipientsNone")}</p>
      )}
    </div>
  );
}

function FlowRow({ f, locale, t }: { f: DataFlow; locale: Locale; t: Translator }) {
  const names = (xs: { label_en: string; label_hi: string }[]) => xs.map((x) => label(locale, x)).join(", ");
  return (
    <li
      className={cx(
        "grid gap-3 border-t border-line p-4 first:border-t-0 lg:grid-cols-[minmax(13rem,1.1fr)_1fr_1.3fr] lg:gap-6",
        f.finding_ids.length > 0 && "border-l-4 border-l-internal",
      )}
      data-flow={f.data_type}
    >
      <div className="flex gap-3">
        <span
          className={cx(
            "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full",
            f.shared ? "bg-behaviour-soft text-behaviour" : "bg-neel-soft text-neel",
          )}
        >
          <Icon name={f.category ?? "other"} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{label(locale, f)}</p>
          {f.category ? <p className="text-xs text-ink-muted">{t(categoryI18nKey(f.category))}</p> : null}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {f.collected ? <Pill tone="kept">{t("simple.flow.collected")}</Pill> : null}
            {f.shared ? <Pill tone="shared">{t("simple.flow.shared")}</Pill> : null}
            {f.sold ? <Pill tone="sold">{t("simple.flow.sold")}</Pill> : null}
          </div>
        </div>
      </div>

      <div className="text-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t("simple.flow.why")}</p>
        <p className="mt-0.5 leading-snug">
          {names([...f.collect_purposes, ...f.share_purposes.filter((p) => !f.collect_purposes.some((c) => c.id === p.id))]) || (
            <span className="text-ink-muted">{t("simple.flow.whyNotStated")}</span>
          )}
        </p>
        {f.shared ? (
          <>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">{t("simple.flow.goesTo")}</p>
            <p className="mt-0.5 font-medium leading-snug text-ink">{names(f.recipients)}</p>
          </>
        ) : null}
      </div>

      <div className="grid content-start gap-1.5 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t("simple.flow.saidBy")}</p>
        <div className="flex flex-wrap gap-1.5">
          {f.sources.map((s) => (
            <Pill key={s} tone="muted">
              {t(`simple.srcShort.${s}`)}
            </Pill>
          ))}
        </div>
        {f.denied_by.map((s) => (
          <p key={s} className="font-medium text-internal">
            {t("simple.flow.deniedBy", { source: t(`simple.srcShort.${s}`) })}
          </p>
        ))}
        {f.finding_ids.length ? (
          <a href={`#sf-${f.finding_ids[0]}`} className="w-fit font-semibold text-internal">
            {t("simple.flow.mismatch")} <span aria-hidden="true">→</span>
          </a>
        ) : null}
        {f.evidence.length ? (
          <details className="group">
            <summary className="cursor-pointer text-neel">{t("simple.flow.showQuotes")}</summary>
            <ul className="mt-2 grid gap-2">
              {f.evidence.map((e, i) => (
                <li key={i} className="rounded-md border-l-2 border-line-strong bg-surface-sunken px-3 py-2">
                  <p className="text-xs font-semibold text-ink-muted">{t(`simple.srcShort.${e.source}`)}</p>
                  <p className="mt-0.5 leading-snug">“{e.quote}”</p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </li>
  );
}

function DataFlows({
  report,
  flows,
  locale,
  t,
}: {
  report: Report;
  flows: DataFlow[] | undefined;
  locale: Locale;
  t: Translator;
}) {
  const shared = (flows ?? []).filter((f) => f.shared);
  const kept = (flows ?? []).filter((f) => !f.shared && f.collected);
  return (
    <section id="data-flows" aria-labelledby="sr-flows" className="grid scroll-mt-24 gap-4">
      <div>
        <h2 id="sr-flows" className="font-display text-2xl font-bold">
          {t("simple.flow.title")}
        </h2>
        <p className="mt-1 max-w-[80ch] text-ink-muted">{t("simple.flow.lede")}</p>
      </div>
      {flows === undefined ? (
        <p className="rounded-mudra border border-dashed border-line-strong p-4 text-ink-muted">
          {t("simple.flow.notAvailable")}
        </p>
      ) : flows.length === 0 ? (
        <p className="rounded-mudra border border-line bg-surface-raised p-4 text-ink-muted">{t("simple.flow.none")}</p>
      ) : (
        <>
          <Recipients flows={shared} locale={locale} t={t} />
          {shared.length ? (
            <div className="grid gap-2">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                {t("simple.flow.sharedTitle")} <span className="mu-count">{shared.length}</span>
              </h3>
              <ul className="overflow-hidden rounded-mudra border border-behaviour bg-surface-raised">
                {shared.map((f) => (
                  <FlowRow key={f.data_type} f={f} locale={locale} t={t} />
                ))}
              </ul>
            </div>
          ) : null}
          {kept.length ? (
            <div className="grid gap-2">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                {t("simple.flow.keptTitle")} <span className="mu-count">{kept.length}</span>
              </h3>
              <p className="-mt-1 text-sm text-ink-muted">{t("simple.flow.keptNote")}</p>
              <ul className="overflow-hidden rounded-mudra border border-line bg-surface-raised">
                {kept.map((f) => (
                  <FlowRow key={f.data_type} f={f} locale={locale} t={t} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/* ---------- 4. things that don't add up ---------- */

function IssueCard({
  f,
  locale,
  t,
  disputeHref,
}: {
  f: Finding;
  locale: Locale;
  t: Translator;
  disputeHref?: (f: Finding) => string;
}) {
  return (
    <li
      id={`sf-${f.id}`}
      className="grid scroll-mt-24 gap-3 rounded-mudra border border-line bg-surface-raised p-4 shadow-1 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-[80ch] text-lg font-semibold leading-snug">{f.summary}</p>
        <StatusBadge status={f.status} locale={locale} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {f.sides.map((s, i) => (
          <figure key={i} className="m-0 rounded-md border-l-4 border-line-strong bg-surface-sunken px-4 py-3">
            <figcaption className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              {t("simple.issues.says", { source: t(`simple.srcShort.${sideSource(s.source)}`) })}
            </figcaption>
            <EvidenceText e={s.evidence} t={t} />
          </figure>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        {f.benign_explanations.length ? (
          <details>
            <summary className="cursor-pointer font-medium text-agree">{t("simple.issues.fine")}</summary>
            <ul className="mt-2 list-disc pl-5 text-ink-muted">
              {f.benign_explanations.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </details>
        ) : (
          <span />
        )}
        {disputeHref ? (
          <Link href={disputeHref(f)} className="text-ink-muted underline underline-offset-2 hover:text-ink">
            {t("simple.issues.report")}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function EvidenceText({ e, t }: { e: Evidence; t: Translator }) {
  const ev = evidenceText(t, e);
  return ev.quoted ? (
    <blockquote className="m-0 mt-1 leading-snug">“{ev.text}”</blockquote>
  ) : (
    <p className="m-0 mt-1 leading-snug">{ev.text}</p>
  );
}

function GapCard({ g, t, flows, locale }: { g: DisclosureGap; t: Translator; flows: DataFlow[]; locale: Locale }) {
  const flow = flows.find((f) => f.data_type === g.data_type);
  const data = flow ? label(locale, flow).toLowerCase() : g.data_type.replace(/_/g, " ");
  const how = evidenceText(t, g.evidence);
  return (
    <li className="flex gap-3 rounded-mudra border border-dashed border-gap bg-surface-raised p-4">
      <Icon name="other" className="mt-0.5 text-gap" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t("simple.issues.gapTitle")}</p>
        <p className="mt-0.5 font-medium leading-snug">{t("simple.issues.gap", { data })}</p>
        {how.text ? <p className="mt-1 text-sm text-ink-muted">{how.text}</p> : null}
      </div>
    </li>
  );
}

function Issues({
  report,
  locale,
  t,
  disputeHref,
}: {
  report: Report;
  locale: Locale;
  t: Translator;
  disputeHref?: (f: Finding) => string;
}) {
  const has = report.findings.length || report.disclosure_gaps.length;
  return (
    <section id="issues" aria-labelledby="sr-issues" className="grid scroll-mt-24 gap-4">
      <div>
        <h2 id="sr-issues" className="font-display text-2xl font-bold">
          {t("simple.issues.title")}
        </h2>
        <p className="mt-1 max-w-[80ch] text-ink-muted">{t("simple.issues.lede")}</p>
      </div>
      {has ? (
        <ul className="grid gap-3">
          {report.findings.map((f) => (
            <IssueCard key={f.id} f={f} locale={locale} t={t} disputeHref={disputeHref} />
          ))}
          {report.disclosure_gaps.map((g) => (
            <GapCard key={g.id} g={g} t={t} flows={report.data_flows ?? []} locale={locale} />
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-3 rounded-mudra border border-agree bg-agree-soft p-4 font-medium">
          <span
            className="grid h-6 w-6 place-items-center rounded-full bg-agree text-sm font-bold text-surface-raised"
            aria-hidden="true"
          >
            ✓
          </span>
          {t("simple.issues.none")}
        </p>
      )}
    </section>
  );
}

/* ---------- 5. what we couldn't check ---------- */

function NotChecked({ report, t }: { report: Report; t: Translator }) {
  const missing = SOURCES.filter((s) => report.coverage[s] !== "ok");
  const areas = (report.card?.categories ?? []).filter((c) => c.color === "grey");
  if (!missing.length && !areas.length) return null;
  return (
    <section
      aria-labelledby="sr-nc"
      className="grid gap-2 rounded-mudra border border-dashed border-line-strong bg-surface-sunken p-4"
    >
      <h2 id="sr-nc" className="font-semibold">
        {t("simple.notChecked.title")}
      </h2>
      <ul className="grid gap-1 text-sm">
        {missing.map((s) => (
          <li key={s}>
            <span className="font-semibold">{t(`simple.src.${s}`)}:</span>{" "}
            <span className="text-ink-muted">
              {sourceReasonText(t, report.sources?.[s]?.reason) ?? t(`coverage.${report.coverage[s]}`)}
            </span>
          </li>
        ))}
        {areas.length ? (
          <li>
            <span className="font-semibold">{t("card.notCheckedTitle")}:</span>{" "}
            <span className="text-ink-muted">{areas.map((c) => t(categoryI18nKey(c.id))).join(", ")}</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/* ---------- the whole simple view ---------- */

export function SimpleReport({
  report,
  locale,
  disputeHref,
}: {
  report: Report;
  locale: Locale;
  disputeHref?: (f: Finding) => string;
}) {
  const t = createT(locale);
  const flows = report.data_flows;
  return (
    <div className="grid gap-10 [&>*]:min-w-0">
      <SourcesRead report={report} t={t} />
      <InShort report={report} flows={flows ?? []} t={t} />
      <DataFlows report={report} flows={flows} locale={locale} t={t} />
      <Issues report={report} locale={locale} t={t} disputeHref={disputeHref} />
      <NotChecked report={report} t={t} />
    </div>
  );
}
