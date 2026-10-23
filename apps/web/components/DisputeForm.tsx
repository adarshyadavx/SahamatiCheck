"use client";

import { useSearchParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { createT, type Locale } from "@sahamati/i18n";
import { postDispute } from "@/lib/api";

export function DisputeForm({ locale }: { locale: Locale }) {
  const t = createT(locale);
  const sp = useSearchParams();
  const id = useId();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setStatus("sending");
    try {
      await postDispute({
        report_id: String(fd.get("report_id") ?? ""),
        finding_id: String(fd.get("finding_id") ?? "") || undefined,
        contact_email: String(fd.get("contact_email") ?? ""),
        message: String(fd.get("message") ?? ""),
      });
      setStatus("sent");
    } catch {
      setStatus("failed");
    }
  }

  if (status === "sent")
    return (
      <p className="panel p-5 font-semibold text-agree" role="status">
        {t("about.sent")}
      </p>
    );

  return (
    <form onSubmit={submit} className="panel grid gap-4 p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-r`} className="field-label">{t("about.reportId")}</label>
          <input id={`${id}-r`} name="report_id" required className="input font-mono text-sm" defaultValue={sp.get("report") ?? ""} />
        </div>
        <div>
          <label htmlFor={`${id}-f`} className="field-label">
            {t("about.findingId")} <span className="font-normal text-ink-faint">({t("common.optional")})</span>
          </label>
          <input id={`${id}-f`} name="finding_id" className="input font-mono text-sm" defaultValue={sp.get("finding") ?? ""} />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-e`} className="field-label">{t("about.email")}</label>
        <input id={`${id}-e`} name="contact_email" type="email" required autoComplete="email" className="input" aria-describedby={`${id}-eh`} />
        <p id={`${id}-eh`} className="field-hint">{t("about.emailHint")}</p>
      </div>
      <div>
        <label htmlFor={`${id}-m`} className="field-label">{t("about.message")}</label>
        <textarea id={`${id}-m`} name="message" required rows={5} className="input" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={status === "sending"}>
          {status === "sending" ? t("about.sending") : t("about.submit")}
        </button>
        {status === "failed" ? (
          <span className="text-sm text-internal" role="alert">{t("about.failed")}</span>
        ) : null}
      </div>
    </form>
  );
}
