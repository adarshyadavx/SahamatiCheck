import { expect, test } from "@playwright/test";

// Integration: a real browser -> the Next.js app -> the real API -> the database. Nothing is mocked.

test("checking an app from the form ends on its report", async ({ page }) => {
  await page.goto("/en/check");
  await page.getByLabel("Play Store link or package name").fill("in.example.shopkart");
  await page.getByRole("button", { name: "Run check" }).click();
  await page.waitForURL(/\/en\/r\/r_demo_shopkart/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /ShopKart/ }).first()).toBeVisible();
  await expect(page.getByText("Difference found").first()).toBeVisible();
});

test("a bad input is refused in the browser with an explanation, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => r.url().includes("/v1/checks") && sent.push(r.url()));
  await page.goto("/en/check");
  await page.getByLabel("Play Store link or package name").fill("definitely not a package");
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByText(/Enter a Play Store link or a package name/)).toBeVisible();
  expect(sent).toEqual([]);
});

test("the Hindi site runs the same flow and lands on the Hindi report", async ({ page }) => {
  await page.goto("/hi/check");
  await page.locator("input[name=q]").fill("in.example.shopkart");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/hi\/r\/r_demo_shopkart/, { timeout: 30_000 });
  await expect(page.getByText("अंतर मिला").first()).toBeVisible();
});

test("a developer self-check shows a private report and does not publish it", async ({ page, request }) => {
  await page.goto("/en/self-check");
  await page.locator("input[name=apk]").setInputFiles({ name: "app.apk", mimeType: "application/vnd.android.package-archive", buffer: Buffer.from("PK\x03\x04 not a real apk") });
  await page.locator("input[name=package_name]").fill("in.example.flowtest");
  await page.locator("textarea[name=policy_text]").fill("We never collect your precise location. We do not share your personal information with third parties.");
  await page.locator("input[name=owner_confirmed]").check();
  await page.locator("form button[type=submit]").click();
  await expect(page.getByText("Your private report")).toBeVisible({ timeout: 60_000 });
  // an APK we cannot read means the APK-dependent checks say so instead of passing
  await expect(page.getByText("Rules not evaluated").first()).toBeVisible();
  const api = process.env.SAHAMATI_API_URL ?? "http://localhost:8020";
  const pub = await request.get(`${api}/v1/apps/in.example.flowtest/report`);
  expect(pub.status()).toBe(404);
});

test("a developer dispute is accepted and acknowledged", async ({ page }) => {
  await page.goto("/en/about?report=r_demo_shopkart&finding=f_dm_01");
  await page.locator("input[name=contact_email]").fill("dev@example.com");
  await page.locator("textarea[name=message]").fill("The policy has since been corrected.");
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("status")).toBeVisible({ timeout: 15_000 });
});

test("an unknown report id is a proper 404 page, not a demo", async ({ page }) => {
  const res = await page.goto("/en/r/r_does_not_exist");
  expect(res?.status()).toBe(404);
});
