import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Finding, Report, ReportCard as ReportCardData, Status } from "@sahamati/contracts";
import sample from "@sahamati/contracts/fixtures/report.sample.json";
import en from "@sahamati/i18n/en.json";
import hi from "@sahamati/i18n/hi.json";
import {
  CATEGORY_IDS,
  COLOR_STATUS,
  STATUS_COLOR,
  STATUS_IDS,
  createT,
  limitationI18nKey,
  reasonI18nKey,
  statusI18nKey,
} from "@sahamati/i18n";
import {
  ConfidenceBand,
  FindingCard,
  IndicatorList,
  LimitationsList,
  ReportCard,
  RulesNotEvaluated,
  StatusBadge,
  StatusCounts,
  confidenceBand,
  groupFindings,
} from "@sahamati/ui";
import { isKnownDemoId, DEMO_REPORT_ID } from "@/lib/demo";
import { normaliseRules } from "@/lib/api";

const report = sample as unknown as Report;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const dataColors = (markup: string) => [...markup.matchAll(/data-color="(\w+)"/g)].map((m) => m[1]);

describe("StatusBadge: status is never colour alone", () => {
  it.each(STATUS_IDS)("%s renders its label, an icon and a colour class", (status) => {
    const out = html(<StatusBadge status={status} locale="en" />);
    expect(out).toContain(esc(en.status[status]));
    expect(out).toContain("<svg");
    expect(out).toContain(`data-icon="${STATUS_COLOR[status]}"`);
    expect(out).toContain(`mu-status--${STATUS_COLOR[status]}`);
  });

  it("uses a different icon and a different label for each of the five statuses", () => {
    const icons = new Set(STATUS_IDS.map((s) => html(<StatusBadge status={s} locale="en" />).match(/data-icon="(\w+)"/)![1]));
    const labels = new Set(STATUS_IDS.map((s) => en.status[s]));
    expect(icons.size).toBe(5);
    expect(labels.size).toBe(5);
  });

  it("draws red only for confirmed_conflict", () => {
    const red = STATUS_IDS.filter((s) => dataColors(html(<StatusBadge status={s} locale="en" />)).includes("red"));
    expect(red).toEqual(["confirmed_conflict"]);
    expect(COLOR_STATUS.red).toBe("confirmed_conflict");
  });

  it("labels green 'No issue found in what we could check', never safe or compliant", () => {
    expect(en.status.no_issue_detected).toBe("No issue found in what we could check");
    for (const cat of [en.status, hi.status]) {
      for (const s of STATUS_IDS) expect(cat[s]).not.toMatch(/\b(safe|compliant|secure|सुरक्षित|अनुपालन)\b/i);
    }
  });

  it("honours an explicit backend colour", () => {
    const out = html(<StatusBadge status="needs_review" color="yellow" locale="en" />);
    expect(out).toContain('data-color="yellow"');
    expect(out).toContain(en.status.needs_review);
  });

  it("renders in Hindi", () => {
    expect(html(<StatusBadge status="potential_conflict" locale="hi" />)).toContain(hi.status.potential_conflict);
  });
});

describe("ConfidenceBand", () => {
  it("is strong at 0.85 and above, moderate below that, weak under 0.7", () => {
    expect(confidenceBand(0.85)).toBe("strong");
    expect(confidenceBand(0.97)).toBe("strong");
    expect(confidenceBand(0.849)).toBe("moderate");
    expect(confidenceBand(0.7)).toBe("moderate");
    expect(confidenceBand(0.69)).toBe("weak");
  });
  it("shows words, not just bars", () => {
    expect(html(<ConfidenceBand value={0.91} locale="en" />)).toContain(en.confidenceBand.strong);
    expect(html(<ConfidenceBand value={0.72} locale="en" />)).toContain(en.confidenceBand.moderate);
    expect(html(<ConfidenceBand value={0.3} locale="en" />)).toContain(en.confidenceBand.weak);
  });
});

describe("ReportCard", () => {
  const out = html(<ReportCard card={report.card} findings={report.findings} locale="en" />);

  it("renders ten category rows and five answers", () => {
    expect((out.match(/class="mu-rc__row /g) ?? []).length).toBe(10);
    expect((out.match(/class="mu-rc__answer"/g) ?? []).length).toBe(5);
    for (const id of CATEGORY_IDS) expect(out).toContain(`data-category="${id}"`);
  });

  it("shows the backend colour and the status label on each row", () => {
    expect(out).toMatch(/data-category="ads_tracking" data-color="red" data-status="confirmed_conflict"/);
    expect(out).toMatch(/data-category="location" data-color="orange" data-status="potential_conflict"/);
  });

  it("uses red only on rows the backend marked confirmed_conflict", () => {
    const rows = [...out.matchAll(/data-color="(\w+)" data-status="(\w+)"/g)];
    for (const [, color, status] of rows) if (color === "red") expect(status).toBe("confirmed_conflict");
  });

  it("gives every grey row the 'what we could not check' note", () => {
    const grey = report.card.categories.filter((c) => c.color === "grey");
    expect(grey.length).toBeGreaterThan(0);
    const limitBlocks = out.match(/mu-rc__limit-title/g) ?? [];
    expect(limitBlocks.length).toBe(grey.length);
    expect(out).toContain(en.card.couldNotCheck);
  });

  it("gives green rows the note too, and falls back when the note is empty", () => {
    const card: ReportCardData = {
      ...report.card,
      categories: report.card.categories.map((c, i) =>
        i === 0
          ? { ...c, color: "green", status: "no_issue_detected", note: "Policy and safety section agree. Runtime use was not checked.", finding_ids: [] }
          : i === 1
            ? { ...c, color: "green", status: "no_issue_detected", note: "", finding_ids: [] }
            : c,
      ),
    };
    const g = html(<ReportCard card={card} locale="en" />);
    expect(g).toContain("Runtime use was not checked.");
    expect(g).toContain(en.status.no_issue_detected);
    expect(g).toContain(en.card.noteMissing);
    const greenRows = (g.match(/mu-rc__row--green/g) ?? []).length;
    expect(greenRows).toBe(2);
    expect((g.match(/mu-rc__limit-title/g) ?? []).length).toBe(greenRows + report.card.categories.filter((c, i) => i > 1 && c.color === "grey").length);
  });

  it("never shows an overall score, grade or colour", () => {
    expect(out).toContain(en.card.noScore);
    expect(out).not.toMatch(/class="[^"]*(score|grade|overall)/i);
  });

  it("links answers and rows to the findings", () => {
    expect(out).toContain('href="#finding-f_dm_01"');
    expect(out).toContain('href="#indicator-i_t08"');
  });
});

describe("IndicatorList", () => {
  const out = html(<IndicatorList indicators={report.indicators} findings={report.findings} locale="en" />);
  it("is titled 'Worth a closer look' and is never counted", () => {
    expect(out).toContain("Worth a closer look");
    expect(out).not.toContain("mu-count");
    expect(out).toContain(en.indicators.intro);
  });
  it("shows indicators as needs_review (yellow), never red", () => {
    expect(out).toContain('data-status="needs_review"');
    expect(dataColors(out).every((c) => c === "yellow")).toBe(true);
  });
  it("links an indicator to the finding in its group", () => {
    expect(out).toContain('href="#finding-f_dm_01"');
  });
});

describe("RulesNotEvaluated", () => {
  const out = html(<RulesNotEvaluated ruleRuns={report.rule_runs} locale="en" />);
  const inconclusive = report.rule_runs.filter((r) => r.status === "inconclusive");
  it("lists only inconclusive rules with human reason sentences", () => {
    expect((out.match(/data-rule="/g) ?? []).length).toBe(inconclusive.length);
    expect(out).not.toContain('data-rule="P05"');
    expect(out).toContain(en.reason.runtime_evidence_unavailable);
    expect(out).toContain(en.reason.test_account_unavailable);
    expect(out).not.toContain("runtime_evidence_unavailable<");
  });
  it("uses the generic sentence for an unknown reason code", () => {
    const o = html(
      <RulesNotEvaluated locale="en" ruleRuns={[{ rule_id: "X1", name: "X", family: "P", phase: 1, status: "inconclusive", reason: "brand_new_code" }]} />,
    );
    expect(o).toContain(en.reason.generic);
  });
  it("says so when nothing is inconclusive", () => {
    expect(html(<RulesNotEvaluated ruleRuns={report.rule_runs.filter((r) => r.status !== "inconclusive")} locale="en" />)).toContain(en.rulesNotEvaluated.none);
  });
  it("StatusCounts shows all five statuses with their counts", () => {
    const sc = html(<StatusCounts counts={report.status_counts} locale="en" />);
    for (const s of STATUS_IDS) expect(sc).toContain(esc(en.status[s]));
  });
});

describe("LimitationsList", () => {
  it("renders known codes as sentences and unknown codes as the generic sentence", () => {
    const o = html(<LimitationsList limitations={["permission_only", "runtime_not_observed", "something_new"]} locale="en" />);
    expect(o).toContain(en.limitation.permission_only);
    expect(o).toContain(en.limitation.runtime_not_observed);
    expect(o).toContain(en.limitation.generic);
    expect(o).not.toContain("something_new<");
  });
  it("renders nothing for an empty list", () => {
    expect(html(<LimitationsList limitations={[]} locale="en" />)).toBe("");
  });
});

describe("FindingCard", () => {
  const byId = (id: string) => report.findings.find((f) => f.id === id)!;
  it("shows status, tier, confidence band, limitations, See why and Report a mistake", () => {
    const o = html(<FindingCard finding={byId("f_bm_01")} locale="en" onLooksWrong={() => {}} />);
    expect(o).toContain(en.status.potential_conflict);
    expect(o).toContain(en.tier.indicative);
    expect(o).toContain(en.confidenceBand.weak);
    expect(o).toContain(en.limitation.permission_only);
    expect(o).toContain(en.finding.seeWhy);
    expect(o).toContain(en.finding.reportMistake);
    expect(o).toContain(en.actions.title);
    expect(o).toContain("READ_CONTACTS");
    expect(o).not.toContain("data-color=\"red\"");
  });
  it("shows red for the confirmed conflict only", () => {
    expect(html(<FindingCard finding={byId("f_dm_01")} locale="en" />)).toContain('data-color="red"');
    expect(html(<FindingCard finding={byId("f_ic_01")} locale="en" />)).not.toContain('data-color="red"');
  });
  it("nests related findings under the primary", () => {
    const o = html(<FindingCard finding={byId("f_dm_01")} related={[byId("f_ic_01")]} locale="en" />);
    expect(o).toContain(en.finding.related);
    expect(o).toContain("finding-f_ic_01");
  });
});

describe("groupFindings", () => {
  const mk = (id: string, extra: Partial<Finding> = {}): Finding => ({ ...(report.findings[0] as Finding), id, group_id: undefined, related_finding_ids: undefined, ...extra });
  it("keeps ungrouped findings separate", () => {
    expect(groupFindings(report.findings).map((g) => g.primary.id)).toEqual(["f_dm_01", "f_ic_01", "f_bm_01"]);
  });
  it("shows a group once, parent from related_finding_ids, strongest tier first", () => {
    const a = mk("a", { tier: "indicative", group_id: "g", status: "potential_conflict" });
    const b = mk("b", { tier: "strong", group_id: "g", related_finding_ids: ["a"] });
    const c = mk("c", { group_id: "other" });
    const groups = groupFindings([a, b, c]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.primary.id).toBe("b");
    expect(groups[0]!.related.map((f) => f.id)).toEqual(["a"]);
  });
  it("groups via related_finding_ids even without a group_id", () => {
    const a = mk("a", { related_finding_ids: ["b"] });
    const b = mk("b");
    expect(groupFindings([b, a])[0]!.primary.id).toBe("a");
  });
});

describe("i18n catalog coverage", () => {
  const needed = [
    ...STATUS_IDS.map(statusI18nKey),
    ...STATUS_IDS.map((s) => `status.desc.${s}`),
    ...CATEGORY_IDS.map((c) => `card.category.${c}`),
    ...["location", "sharing", "ads", "deletion", "grievance"].map((a) => `card.answer.${a}`),
    ...["permission_only", "sdk_presence_only", "runtime_not_observed", "confidence_below_confirm_threshold", "generic"].map((c) => `limitation.${c}`),
    ...[
      "runtime_evidence_unavailable", "test_account_unavailable", "apk_unavailable", "apk_unparseable", "apk_partial_coverage",
      "policy_unavailable", "data_safety_unavailable", "not_enabled_in_this_version", "missing_source_false_pass_prevented", "generic",
    ].map((c) => `reason.${c}`),
  ];
  for (const locale of ["en", "hi"] as const) {
    it(`${locale} has every key`, () => {
      const t = createT(locale);
      for (const k of needed) expect(t.has(k), k).toBe(true);
      for (const s of STATUS_IDS) {
        expect(t.raw<string[]>(`actions.status.${s}`).length).toBeGreaterThan(0);
      }
      for (const c of CATEGORY_IDS) expect(t.raw<string[]>(`actions.category.${c}`).length).toBeGreaterThan(0);
    });
  }
  it("falls back to generic keys for unknown codes", () => {
    const t = createT("en");
    expect(limitationI18nKey(t, "nope")).toBe("limitation.generic");
    expect(reasonI18nKey(t, "nope")).toBe("reason.generic");
    expect(reasonI18nKey(t, undefined)).toBe("reason.generic");
    expect(limitationI18nKey(t, "permission_only")).toBe("limitation.permission_only");
  });
  it("maps statuses and colours one to one", () => {
    expect(new Set(Object.values(STATUS_COLOR)).size).toBe(5);
    for (const s of STATUS_IDS) expect(COLOR_STATUS[STATUS_COLOR[s as Status]]).toBe(s);
  });
});

describe("web lib", () => {
  it("knows the demo ids that may fall back to the fixture", () => {
    expect(isKnownDemoId(DEMO_REPORT_ID)).toBe(true);
    expect(isKnownDemoId("r_demo_shopkart")).toBe(true);
    expect(isKnownDemoId("r_abc123")).toBe(false);
  });
  it("normalises /v1/rules in either shape and drops junk", () => {
    const row = { id: "P06", name: "Sharing contradiction", family: "P", phase: 1, enabled: true, version: "1" };
    expect(normaliseRules([row])).toEqual([{ ...row }]);
    expect(normaliseRules({ rules: [row, null, { name: "no id" }] })).toHaveLength(1);
    expect(normaliseRules(undefined)).toEqual([]);
  });
});
