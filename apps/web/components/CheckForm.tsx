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

/** The stages the backend reports, in order (backend/core/sahamati_core/pipeline.py STAGES). */
export const STAGES = [
  "queued",
  "ingest_listing",
  "fetch_policy",
  "map_declaration",
  "analyse_apk",
  "extract_claims",
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

export function CheckForm({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const t = createT(locale);
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      esRef.current?.close();
      if (pollRef.current) clearTimeout(pollRef.current);
    },
    [],
  );

  const running = phase.kind === "submitting" || phase.kind === "job";
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

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
    for (const name of ["message", "progress", "stage", "job", "status", "done", "error"]) es.addEventListener(name, onData as EventListener);
    es.onerror = () => {
      // Stream dropped (or never opened): fall back to polling.
      if (es.readyState === EventSource.CLOSED || es.readyState === EventSource.CONNECTING) {
        es.close();
        if (!pollRef.current) poll(statusUrl);
      }
    };
  }

  // `?q=<link or share text>` (the Android app's Share target, or any link) fills the box and starts the
  // check once. Read from window.location so the page stays statically renderable.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (!q) return;
    autoRan.current = true;
    setValue(q);
    void run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(value);
  }

  async function run(raw: string) {
    const req = parseCheckInput(raw);
    if (!req) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    setInvalid(false);
    setStartedAt(Date.now());
    setNow(Date.now());
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

  function reset() {
    esRef.current?.close();
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
    setPhase({ kind: "idle" });
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  const busy = running || phase.kind === "redirecting";
  const detected = value.trim() ? parseCheckInput(value) : null;
  // Only confirm the package when the input was a link or share text, not a bare package name.
  const showDetected = Boolean(detected && detected.package_name && detected.package_name !== value.trim());
  const job = phase.kind === "job" ? phase.job : null;
  const seen = phase.kind === "job" ? phase.seen : [];
  const stages = [...STAGES, ...seen.filter((s) => !(STAGES as readonly string[]).includes(s) && s !== "done")];
  const currentIdx = job?.stage ? stages.indexOf(job.stage) : -1;
  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const pct = Math.round((phase.kind === "redirecting" ? 1 : job?.progress ?? 0) * 100);

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <form onSubmit={submit} noValidate className={cx("grid gap-3", !compact && "panel p-5 sm:p-7")}>
        <label htmlFor={inputId} className={cx("field-label", compact && "sr-only")}>
          {t("check.label")}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            ref={inputRef}
            id={inputId}
            name="q"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="input text-[0.95rem]"
            placeholder={t("check.placeholder")}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (invalid) setInvalid(false);
            }}
            aria-invalid={invalid || undefined}
            aria-describedby={`${inputId}-hint${invalid ? ` ${inputId}-err` : ""}`}
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary shrink-0" disabled={busy}>
            {busy ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                {t("check.running")}
              </>
            ) : (
              <>
                {t("check.submit")}
                <span aria-hidden="true">→</span>
              </>
            )}
          </button>
        </div>
        <div id={`${inputId}-hint`} className="grid gap-1.5 text-sm">
          {invalid ? (
            <p id={`${inputId}-err`} className="font-medium text-internal" role="alert">
              {t("check.invalid")}
            </p>
          ) : showDetected && detected ? (
            <p className="flex items-center gap-2 font-medium text-agree" role="status">
              <Seal size={14} variant="filled" color="var(--agree)" />
              <span>
                {t("check.detected", { pkg: "" })}
                <code className="font-mono">{detected.package_name}</code>
              </span>
            </p>
          ) : (
            <p className="text-ink-muted">{t("check.shareTip")}</p>
          )}
          <p className="text-ink-muted">
            <button
              type="button"
              className="font-medium text-neel underline decoration-dotted underline-offset-4 hover:decoration-solid"
              onClick={() => {
                setValue(DEMO_PACKAGE);
                setInvalid(false);
              }}
              disabled={busy}
            >
              {t("check.hint")}
            </button>
          </p>
        </div>
        {!compact ? <p className="border-t border-dashed border-line pt-3 text-xs text-ink-muted">{t("check.etiquette")}</p> : null}
      </form>

      {phase.kind === "submitting" || phase.kind === "job" || phase.kind === "redirecting" ? (
        <section className="panel p-5 sm:p-6" aria-labelledby={`${inputId}-progress`} aria-live="polite">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id={`${inputId}-progress`} className="text-lg font-semibold">
              {t("check.progressTitle")}
            </h2>
            <span className="font-mono text-xs tabular-nums text-ink-muted">{t("check.elapsed", { s: elapsed })}</span>
          </div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-labelledby={`${inputId}-progress`}
          >
            <div className="h-full rounded-full bg-neel transition-[width] duration-500" style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
          <p className="mt-3 text-sm text-ink-muted">{t("check.slow")}</p>
          <ol className="mt-4 grid gap-2 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-4">
            {stages.map((s, i) => {
              const state =
                phase.kind === "redirecting" || i < currentIdx ? "done" : i === currentIdx || (phase.kind === "submitting" && i === 0) ? "active" : "pending";
              return (
                <li key={s} className={cx("flex items-center gap-2.5 text-sm", state === "pending" && "text-ink-faint")}>
                  <Seal
                    size={16}
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
          <div className="flex flex-wrap gap-3">
            <Link href={href(locale, `/r/${DEMO_REPORT_ID}`)} className="btn btn-primary">
              {t("check.openDemo")}
            </Link>
            <button type="button" className="btn btn-secondary" onClick={reset}>
              {t("common.retry")}
            </button>
          </div>
        </div>
      ) : null}

      {phase.kind === "error" ? (
        <div className="panel grid gap-3 border-l-4 border-l-internal p-5" role="alert">
          <p className="font-semibold text-ink">{phase.message}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" onClick={reset}>
              {t("common.retry")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
