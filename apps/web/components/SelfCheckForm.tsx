"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { Report } from "@sahamati/contracts";
import { createT, type Locale } from "@sahamati/i18n";
import { ApiError, ApiUnreachable, PUBLIC_API_BASE, fetchReportClient, getJob, postSelfCheck } from "@/lib/api";
import { ReportView } from "./ReportView";

const DS_PLACEHOLDER = `{
  "collected": [
    { "category": "Location", "type": "Precise location", "purposes": ["App functionality"], "optional": false }
  ],
  "shared": [],
  "no_data_shared": true
}`;

type State =
  | { kind: "idle" }
  | { kind: "running"; note?: string }
  | { kind: "done"; report: Report }
  | { kind: "error"; message: string };

export function SelfCheckForm({ locale, defaultPackage }: { locale: Locale; defaultPackage?: string }) {
  const t = createT(locale);
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [errors, setErrors] = useState<string[]>([]);

  async function waitForJob(statusUrl: string): Promise<Report> {
    for (let i = 0; i < 240; i++) {
      const job = await getJob(statusUrl);
      if (job.status === "done" && job.report_id) return fetchReportClient(job.report_id);
      if (job.status === "error") throw new ApiError(job.error ?? "error", 500);
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new ApiError("timeout", 504);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const errs: string[] = [];
    const apk = fd.get("apk");
    if (!(apk instanceof File) || apk.size === 0) errs.push(t("selfCheck.needApk"));
    const policyUrl = String(fd.get("policy_url") ?? "").trim();
    const policyText = String(fd.get("policy_text") ?? "").trim();
    if (!policyUrl && !policyText) errs.push(t("selfCheck.needPolicy"));
    if (!fd.get("owner_confirmed")) errs.push(t("selfCheck.consent"));

    // Data-safety answers: textarea wins, else the uploaded JSON file.
    let ds = String(fd.get("data_safety") ?? "").trim();
    const dsFile = fd.get("data_safety_file");
    if (!ds && dsFile instanceof File && dsFile.size > 0) ds = (await dsFile.text()).trim();
    fd.delete("data_safety_file");
    if (ds) {
      try {
        JSON.parse(ds);
        fd.set("data_safety", ds);
      } catch {
        errs.push(t("selfCheck.badJson"));
      }
    } else fd.delete("data_safety");
    if (!policyUrl) fd.delete("policy_url");
    if (!policyText) fd.delete("policy_text");

    setErrors(errs);
    if (errs.length) return;

    setState({ kind: "running" });
    try {
      const res = await postSelfCheck(fd);
      if (res.kind === "report") setState({ kind: "done", report: res.report });
      else {
        setState({ kind: "running", note: t("selfCheck.jobQueued", { id: res.job_id }) });
        setState({ kind: "done", report: await waitForJob(res.status_url) });
      }
    } catch (err) {
      const msg =
        err instanceof ApiUnreachable ? t("check.apiDown", { base: PUBLIC_API_BASE }) : err instanceof Error ? err.message : String(err);
      setState({ kind: "error", message: t("selfCheck.failed", { error: msg }) });
    }
  }

  if (state.kind === "done") {
    return (
      <div className="grid gap-6">
        <div className="rounded-mudra border border-dashed border-neel bg-neel-soft px-4 py-3 text-sm text-ink" role="status">
          <strong className="text-neel">{t("selfCheck.resultTitle")}.</strong> {t("selfCheck.private")}
        </div>
        <ReportView report={state.report} locale={locale} privateMode />
      </div>
    );
  }

  const running = state.kind === "running";
  return (
    <form ref={formRef} onSubmit={submit} noValidate className="panel grid gap-6 p-5 sm:p-7" encType="multipart/form-data">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-apk`} className="field-label">
            {t("selfCheck.apk")}
          </label>
          <input
            id={`${id}-apk`}
            name="apk"
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            className="input file:mr-3 file:rounded-full file:border-0 file:bg-neel-soft file:px-3 file:py-1 file:font-semibold file:text-neel"
            aria-describedby={`${id}-apk-hint`}
            required
          />
          <p id={`${id}-apk-hint`} className="field-hint">
            {t("selfCheck.apkHint")}
          </p>
        </div>
        <div>
          <label htmlFor={`${id}-pkg`} className="field-label">
            {t("selfCheck.package")} <span className="font-normal text-ink-faint">({t("common.optional")})</span>
          </label>
          <input id={`${id}-pkg`} name="package_name" type="text" className="input font-mono text-sm" placeholder="in.example.myapp" spellCheck={false} defaultValue={defaultPackage} />
        </div>
        <div>
          <label htmlFor={`${id}-purl`} className="field-label">
            {t("selfCheck.policyUrl")}
          </label>
          <input id={`${id}-purl`} name="policy_url" type="url" className="input" placeholder="https://example.in/privacy" />
        </div>
        <div>
          <label htmlFor={`${id}-ptext`} className="field-label">
            {t("selfCheck.policyText")}
          </label>
          <textarea id={`${id}-ptext`} name="policy_text" rows={3} className="input" />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-ds`} className="field-label">
          {t("selfCheck.dataSafety")}
        </label>
        <textarea
          id={`${id}-ds`}
          name="data_safety"
          rows={7}
          className="input font-mono text-xs"
          placeholder={DS_PLACEHOLDER}
          spellCheck={false}
          aria-describedby={`${id}-ds-hint`}
        />
        <p id={`${id}-ds-hint`} className="field-hint">
          {t("selfCheck.dataSafetyHint")}
        </p>
        <label htmlFor={`${id}-dsf`} className="field-label mt-3 !text-xs !font-medium">
          {t("selfCheck.dataSafetyFile")}
        </label>
        <input id={`${id}-dsf`} name="data_safety_file" type="file" accept=".json,application/json" className="input text-sm" />
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="owner_confirmed" value="true" required className="mt-1 h-4 w-4 accent-[var(--neel)]" />
        <span>{t("selfCheck.consent")}</span>
      </label>

      {errors.length ? (
        <ul className="grid gap-1 rounded-mudra border border-internal bg-internal-soft px-4 py-3 text-sm text-ink" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {state.kind === "error" ? (
        <p className="rounded-mudra border border-internal bg-internal-soft px-4 py-3 text-sm" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 border-t border-dashed border-line pt-5">
        <button type="submit" className="btn btn-primary" disabled={running}>
          {running ? t("selfCheck.running") : t("selfCheck.submit")}
        </button>
        {state.kind === "running" && state.note ? (
          <span className="text-sm text-ink-muted" role="status">
            {state.note}
          </span>
        ) : null}
        <p className="text-xs text-ink-muted">{t("selfCheck.private")}</p>
      </div>
    </form>
  );
}
