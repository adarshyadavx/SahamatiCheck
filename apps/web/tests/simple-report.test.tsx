import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Report } from "@sahamati/contracts";
import sample from "@sahamati/contracts/fixtures/report.sample.json";
import en from "@sahamati/i18n/en.json";
import { SimpleReport } from "@/components/SimpleReport";

const report = sample as unknown as Report;
const html = (r: Report, locale: "en" | "hi" = "en") => renderToStaticMarkup(<SimpleReport report={r} locale={locale} />);

describe("SimpleReport (the plain view)", () => {
  it("says what was read, where data goes and what does not add up", () => {
    const out = html(report);
    for (const heading of [en.simple.read.title, en.simple.summary.title, en.simple.flow.title, en.simple.issues.title]) {
      expect(out).toContain(heading.replace(/'/g, "&#x27;"));
    }
    // the shared data type, who receives it and why (fabricated demo app)
    expect(out).toContain('data-flow="device_id"');
    expect(out).toContain("Third parties");
    expect(out).toContain("Advertising or marketing");
  });

  it("quotes both sides of every finding and never shows an empty quote", () => {
    const out = html(report);
    expect(out).not.toContain("“”");
    expect(out).toContain("Device or other IDs — Shared — Advertising or marketing");
    expect(out).toContain("READ_CONTACTS"); // an APK side is described in words, not as a blank quote
    for (const f of report.findings) expect(out).toContain(`id="sf-${f.id}"`);
  });

  it("links each data type to the finding about it", () => {
    const out = html(report);
    for (const flow of report.data_flows ?? []) {
      if (flow.finding_ids.length) expect(out).toContain(`href="#sf-${flow.finding_ids[0]}"`);
    }
  });

  it("degrades honestly for a report made before data flows existed", () => {
    const old = { ...report, data_flows: undefined } as Report;
    expect(html(old)).toContain(en.simple.flow.notAvailable);
  });

  it("renders in Hindi with Hindi labels and no raw keys", () => {
    const out = html(report, "hi");
    expect(out).toContain("आपका डेटा कहाँ जाता है");
    expect(out).not.toMatch(/\bsimple\.[a-zA-Z]+/);
  });
});
