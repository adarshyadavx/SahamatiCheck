"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Job } from "@sahamati/contracts";
import { createT, type Locale } from "@sahamati/i18n";
import { Seal, cx } from "@sahamati/ui";
import { ApiError, ApiUnreachable, PUBLIC_API_BASE, absoluteApiUrl, getJob, parseCheckInput, postCheck } from "@/lib/api";
import { DEMO_PACKAGE, DEMO_REPORT_ID } from "@/lib/demo";
import { href } from "@/lib/i18n";

export const STAGES = [
  "queued",
  "ingest_listing",
  "fetch_policy",
  "map_declaration",
  "analyse_apk",
  "extract_claims",
  "normalise",
  "detect_conflicts",
  "snapshot_diff",
] as const;

type Phase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "job"; job: Partial<Job>; seen: string[] }
  | { kind: "redirecting" }
  | { kind: "unreachable" }
  | { kind: "error"; message: string };

function parseJob(raw: string): Partial<Job> | null {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const j = (d.job && typeof d.job === "object" ? d.job : d) as Record<string, unknown>;
    return {
      job_id: typeof j.job_id === "string" ? j.job_id : undefined,
      status: typeof j.status === "string" ? (j.status as Job["status"]) : undefined,
      stage: typeof j.stage === "string" ? j.stage : undefined,
      progress: typeof j.progress === "number" ? j.progress : undefined,
      report_id: typeof j.report_id === "string" ? j.report_id : undefined,
      error: typeof j.error === "string" ? j.error : undefined,
    };
  } catch {
    return null;
  }
}

export function CheckForm({ locale }: { locale: Locale }) {
  const t = createT(locale);
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      esRef.current?.close();
      if (pollRef.current) clearTimeout(pollRef.current);
    },
    [],
  );

  function openReport(reportId: string) {
    esRef.current?.close();
    if (pollRef.current) clearTimeout(pollRef.current);
    setPhase({ kind: "redirecting" });
    router.push(href(locale, `/r/${encodeURIComponent(reportId)}`));
  }

  function applyJob(update: Partial<Job>) {
    setPhase((prev) => {
      const job = { ...(prev.kind === "job" ? prev.job : {}), ...Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)) };
      const seen = prev.kind === "job" ? [...prev.seen] : [];
      if (job.stage && !seen.includes(job.stage)) seen.push(job.stage);
      return { kind: "job", job, seen };
    });
    if (update.status === "done" && update.report_id) openReport(update.report_id);
    else if (update.status === "error") setPhase({ kind: "error", message: t("check.jobError", { error: update.error ?? "unknown" }) });
  }

  function poll(statusUrl: string) {
    const tick = async () => {
      try {
        const job = await getJob(statusUrl);
        applyJob(job);
        if (job.status === "done" || job.status === "error") return;
      } catch {
        /* keep trying */
      }
      pollRef.current = setTimeout(tick, 1500);
    };
    void tick();
  }

  function follow(jobId: string, eventsUrl: string, statusUrl: string) {
    setPhase({ kind: "job", job: { job_id: jobId, status: "queued", stage: "queued", progress: 0 }, seen: ["queued"] });
    if (typeof EventSource === "undefined") return poll(statusUrl);
    const es = new EventSource(absoluteApiUrl(eventsUrl));
    esRef.current = es;
    const onData = (e: MessageEvent<string>) => {
      const j = parseJob(e.data);
      if (j) applyJob(j);
      if (j?.status === "done" || j?.status === "error") es.close();
    };
    for (const name of ["message", "progress", "stage", "job", "status", "done"]) es.addEventListener(name, onData as EventListener);
    es.onerror = () => {
      // Stream dropped (or never opened): fall back to polling.
      if (es.readyState === EventSource.CLOSED || es.readyState === EventSource.CONNECTING) {
        es.close();
        if (!pollRef.current) poll(statusUrl);
      }
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const req = parseCheckInput(value);
    if (!req) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setPhase({ kind: "submitting" });
    try {
      const res = await postCheck(req);
      if (res.kind === "report") openReport(res.report.report_id);
      else follow(res.job_id, res.events_url, res.status_url);
    } catch (err) {
      if (err instanceof ApiUnreachable) setPhase({ kind: "unreachable" });
      else setPhase({ kind: "error", message: err instanceof ApiError ? err.message : String(err) });
    }
  }

  const busy = phase.kind === "submitting" || phase.kind === "job" || phase.kind === "redirecting";
  const job = phase.kind === "job" ? phase.job : null;
  const seen = phase.kind === "job" ? phase.seen : [];
  const stages = [...STAGES, ...seen.filter((s) => !(STAGES as readonly string[]).includes(s) && s !== "done")];
  const currentIdx = job?.stage ? stages.indexOf(job.stage) : -1;

  return (
    <div className="grid gap-8 [&>*]:min-w-0">
      <form onSubmit={submit} noValidate className="panel grid gap-4 p-5 sm:p-7">
        <div>
          <label htmlFor={inputId} className="field-label">
            {t("check.label")}
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id={inputId}
              name="q"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="input font-mono text-sm"
              placeholder={t("check.placeholder")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={invalid || undefined}
              aria-describedby={`${inputId}-hint ${invalid ? `${inputId}-err` : ""}`}
              disabled={busy}
            />
            <button type="submit" className="btn btn-primary shrink-0" disabled={busy}>
              {busy ? t("check.running") : t("check.submit")}
            </button>
          </div>
          <p id={`${inputId}-hint`} className="field-hint">
            <button
              type="button"
              className="font-mono text-neel underline underline-offset-2"
              onClick={() => setValue(DEMO_PACKAGE)}
              disabled={busy}
            >
              {t("check.hint")}
            </button>
          </p>
          {invalid ? (
            <p id={`${inputId}-err`} className="mt-2 text-sm font-medium text-internal" role="alert">
              {t("check.invalid")}
            </p>
          ) : null}
        </div>
        <p className="border-t border-dashed border-line pt-3 text-xs text-ink-muted">{t("check.etiquette")}</p>
      </form>

      {phase.kind === "job" || phase.kind === "redirecting" ? (
        <section className="panel p-5 sm:p-7" aria-labelledby="progress-title" aria-live="polite">
          <div className="flex items-center justify-between gap-4">
            <h2 id="progress-title" className="text-xl font-semibold">
              {t("check.progressTitle")}
            </h2>
            {job?.job_id ? <code className="font-mono text-xs text-ink-faint">{job.job_id}</code> : null}
          </div>
          <div
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((phase.kind === "redirecting" ? 1 : job?.progress ?? 0) * 100)}
            aria-labelledby="progress-title"
          >
            <div
              className="h-full rounded-full bg-neel transition-[width] duration-500"
              style={{ width: `${Math.round((phase.kind === "redirecting" ? 1 : job?.progress ?? 0) * 100)}%` }}
            />
          </div>
          <ol className="mt-5 grid gap-2">
            {stages.map((s, i) => {
              const state = phase.kind === "redirecting" || i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
              return (
                <li key={s} className={cx("flex items-center gap-3 text-sm", state === "pending" && "text-ink-faint")}>
                  <Seal
                    size={18}
                    variant={state === "done" ? "filled" : state === "active" ? "outlined" : "dashed"}
                    color={state === "done" ? "var(--agree)" : state === "active" ? "var(--neel)" : "var(--border-strong)"}
                  />
                  <span className={cx(state === "active" && "font-semibold text-ink")}>
                    {t.has(`check.stage.${s}`) ? t(`check.stage.${s}`) : s}
                  </span>
                  <span className="sr-only">· {t(`check.status.${state}`)}</span>
                </li>
              );
            })}
          </ol>
          {phase.kind === "redirecting" ? <p className="mt-4 font-semibold text-agree">{t("check.redirecting")}</p> : null}
        </section>
      ) : null}

      {phase.kind === "unreachable" ? (
        <div className="panel grid gap-3 border-dashed p-5" role="alert">
          <p className="font-semibold">{t("check.apiDown", { base: PUBLIC_API_BASE })}</p>
          <p className="text-ink-muted">{t("check.apiDownDemo")}</p>
          <div>
            <Link href={href(locale, `/r/${DEMO_REPORT_ID}`)} className="btn btn-primary">
              {t("check.openDemo")}
            </Link>
          </div>
        </div>
      ) : null}

      {phase.kind === "error" ? (
        <div className="panel grid gap-3 p-5" role="alert">
          <p className="font-semibold text-internal">{phase.message}</p>
          <div>
            <button type="button" className="btn btn-secondary" onClick={() => setPhase({ kind: "idle" })}>
              {t("common.retry")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
