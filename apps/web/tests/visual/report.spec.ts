import { expect, test } from "@playwright/test";
import { findLowContrast } from "./contrast";

const REPORT = "/en/r/r_demo_shopkart";
// Baselines cover the report-card section only; the whole page is ~10,000px tall.
const cardSection = (page: import("@playwright/test").Page) =>
  page.locator("section", { hasText: /What we found, by area|क्षेत्र के अनुसार/ }).first();

for (const scheme of ["light", "dark"] as const) {
  test.describe(`report page, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });

    test("renders the report card with a label for every status", async ({ page }) => {
      await page.goto(REPORT);
      const card = page.getByText("Difference found").first();
      await expect(card).toBeVisible();
      // red only for a confirmed conflict; the other states carry their own words (never colour alone)
      for (const label of ["Possible difference", "Unclear, needs a closer look", "Couldn't check"]) {
        await expect(page.getByText(label).first()).toBeVisible();
      }
      await expect(page.getByText("Worth a closer look").first()).toBeVisible();
      await expect(page.getByText("Rules not evaluated").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(cardSection(page)).toHaveScreenshot(`report-${scheme}.png`);
    });

    test("every text element meets WCAG AA contrast (4.5:1, 3:1 for large text)", async ({ page }) => {
      await page.goto(REPORT);
      await page.waitForLoadState("networkidle");
      const bad = await findLowContrast(page, "main");
      expect(bad.map((f) => `${f.selector} "${f.text}" ${f.ratio}:1 < ${f.required}:1 (${f.fg} on ${f.bg})`)).toEqual([]);
    });

    test("negative control: the checker does flag low-contrast text", async ({ page }) => {
      await page.goto(REPORT);
      await page.waitForLoadState("networkidle");
      await page.addStyleTag({ content: "main h1{color:#bbbbbb !important;background:#ffffff !important}" });
      const bad = await findLowContrast(page, "main");
      expect(bad.some((f) => f.selector.startsWith("h1"))).toBe(true);
    });
  });
}

test.describe("narrow screen", () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test("report fits a phone without horizontal scrolling", async ({ page }) => {
    await page.goto(REPORT);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(cardSection(page)).toHaveScreenshot("report-mobile.png");
  });
});

test("Hindi report keeps the card and shows no raw i18n keys", async ({ page }) => {
  await page.goto("/hi/r/r_demo_shopkart");
  await page.waitForLoadState("networkidle");
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\b(report|card|status|finding)\.[a-zA-Z]+\b/);
  await expect(cardSection(page)).toHaveScreenshot("report-hi.png");
});
