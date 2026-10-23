import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { findLowContrast } from './contrast';

const API = process.env.SAHAMATI_API_URL ?? 'http://localhost:8000';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3');

async function launch(scheme: 'light' | 'dark'): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium', // new headless: supports extensions
    colorScheme: scheme,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.evaluate((apiBase) => chrome.storage.local.set({ settings: { apiBase, lang: 'en' } }), API);
  await page.reload();
  return { ctx, page, errors };
}

async function checkShopKart(page: Page): Promise<void> {
  await page.getByLabel('Package name').fill('in.example.shopkart');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('Five quick answers')).toBeVisible({ timeout: 30_000 });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`side panel, ${scheme} theme`, () => {
    test('opens without errors and shows the report card for ShopKart', async () => {
      const { ctx, page, errors } = await launch(scheme);
      try {
        await expect(page.getByText('Open an app')).toBeVisible();
        await checkShopKart(page);
        const rows = page.locator('li', { hasText: /Possible difference|Couldn't check|Difference found|Unclear/ });
        await expect(page.getByText('Difference found').first()).toBeVisible();
        await expect(page.getByText('Possible difference').first()).toBeVisible();
        await expect(page.getByText('Unclear, needs a closer look').first()).toBeVisible();
        expect(await page.getByText('Not checked in this version.').count()).toBeGreaterThanOrEqual(5);
        await expect(page.getByText('Rules not evaluated')).toBeVisible();
        const body = await page.locator('body').innerText();
        expect(body).not.toMatch(/\bsafe\b|compliant|score of|grade:/i);
        expect(await rows.count()).toBeGreaterThanOrEqual(1);
        expect(errors).toEqual([]);
        await expect(page.locator('main')).toHaveScreenshot(`panel-${scheme}.png`, { maxDiffPixelRatio: 0.03 });
      } finally {
        await ctx.close();
      }
    });

    test('every text element meets WCAG AA contrast', async () => {
      const { ctx, page } = await launch(scheme);
      try {
        await checkShopKart(page);
        const bad = await findLowContrast(page, 'body');
        expect(bad.map((f) => `${f.selector} "${f.text}" ${f.ratio}:1 < ${f.required}:1 (${f.fg} on ${f.bg})`)).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  });
}

test('"See why" opens the evidence and "Report a mistake" is offered', async () => {
  const { ctx, page } = await launch('light');
  try {
    await checkShopKart(page);
    const ads = page.locator('li', { hasText: 'Ads and tracking' }).first();
    await ads.getByRole('button', { name: 'See why' }).click();
    await expect(page.getByText('Report a mistake').first()).toBeVisible();
    await expect(page.getByText(/policy/i).first()).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('stays usable at 200% zoom (a 210px-wide panel does not scroll sideways)', async () => {
  const { ctx, page } = await launch('light');
  try {
    await checkShopKart(page);
    await page.setViewportSize({ width: 210, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await ctx.close();
  }
});

/** A backend that predates /version: it answers everything with 404 (and CORS, so the extension may read it). */
function oldBackend(): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end('{"detail":"Not Found"}');
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server }));
  });
}

test('warns when the backend is older than the extension', async () => {
  const old = await oldBackend();
  const { ctx, page } = await launch('light');
  try {
    await page.evaluate((apiBase) => chrome.storage.local.set({ settings: { apiBase, lang: 'en' } }), old.url);
    await page.reload();
    await expect(page.getByTestId('stale-backend')).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctx.close();
    old.server.close();
  }
});

test('a current backend shows no warning', async () => {
  const { ctx, page } = await launch('light');
  try {
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('stale-backend')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('Hindi panel shows Hindi server text too (the extension asks for ?hl=hi)', async () => {
  const { ctx, page } = await launch('light');
  try {
    await page.evaluate((apiBase) => chrome.storage.local.set({ settings: { apiBase, lang: 'hi' } }), API);
    await page.reload();
    await page.locator('input').first().fill('in.example.shopkart');
    await page.locator('form button, button[type=submit]').first().click();
    await expect(page.locator('body')).toContainText('इस संस्करण में जाँच नहीं की गई', { timeout: 30_000 });
    const text = await page.locator('body').innerText();
    // server-written sentences (card notes, answers) arrive in Hindi, not just the labels the extension translates itself
    expect(text).not.toContain('Not checked in this version');
    expect(text).not.toContain('The app can access your precise location');
  } finally {
    await ctx.close();
  }
});
