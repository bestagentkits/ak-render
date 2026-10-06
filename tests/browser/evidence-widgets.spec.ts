import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';

const fixturesDir = fileURLToPath(new URL('../../fixtures', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'ak-render-evidence-'));
let target = '';

test.beforeAll(() => {
  mkdirSync(join(workspace, 'assets'), { recursive: true });
  copyFileSync(
    join(fixturesDir, 'assets/shot-dashboard.webp'),
    join(workspace, 'assets/shot-dashboard.webp'),
  );
  const source = readFileSync(join(fixturesDir, 'pages/evidence-widgets.yaml'), 'utf8');
  target = join(workspace, 'evidence-widgets.html');
  writeFileSync(target, compile(source, { source: 'evidence-widgets.yaml' }).html, 'utf8');
});

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  await page.goto(`file://${target}`, { waitUntil: 'load' });
  await page.locator('.ak-annotated img').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page
        .locator('.ak-annotated img')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
}

/** Largest distance between a pin's centre and the point its data-x/data-y names on the image. */
async function worstPinOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const image = document.querySelector('.ak-annotated img');
    if (image === null) throw new Error('no annotated image');
    const box = image.getBoundingClientRect();
    let worst = 0;
    for (const pin of document.querySelectorAll<HTMLElement>('.ak-pin')) {
      const rect = pin.getBoundingClientRect();
      const expectedX = box.left + (Number(pin.dataset.x) / 100) * box.width;
      const expectedY = box.top + (Number(pin.dataset.y) / 100) * box.height;
      const dx = rect.left + rect.width / 2 - expectedX;
      const dy = rect.top + rect.height / 2 - expectedY;
      worst = Math.max(worst, Math.abs(dx), Math.abs(dy));
    }
    return worst;
  });
}

for (const width of [375, 1440]) {
  test(`pins align with the image and nothing overflows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    expect(await page.locator('.ak-pin').count()).toBe(4);
    expect(await worstPinOffset(page)).toBeLessThanOrEqual(4);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}

test('a narrow benchmark keeps every verdict on screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  const badges = page.locator('.ak-bench .ak-badge');
  expect(await badges.count()).toBe(5);
  const rights = await badges.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().right),
  );
  for (const right of rights) expect(right).toBeLessThanOrEqual(375);
});

test('the breakdown bar segments add up to the share list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const result = await page.locator('[data-ak-id="compile-time-breakdown"]').evaluate((block) => {
    const bar = block.querySelector('.ak-breakdown-bar')?.getBoundingClientRect().width ?? 0;
    const segments = [...block.querySelectorAll<HTMLElement>('.ak-breakdown-seg')].map(
      (segment) => ({
        pct: Number(segment.dataset.akPct),
        width: segment.getBoundingClientRect().width,
      }),
    );
    return { bar, segments };
  });
  expect(result.segments.reduce((sum, segment) => sum + segment.pct, 0)).toBe(100);
  for (const segment of result.segments) {
    expect(Math.abs(segment.width - (segment.pct / 100) * result.bar)).toBeLessThanOrEqual(1);
  }
});

test.describe('without scripts and in print', () => {
  test.use({ javaScriptEnabled: false });

  test('notes, verdicts and references stay readable', async ({ page }) => {
    await page.goto(`file://${target}`, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-annotated-notes li')).toHaveCount(4);
    await expect(page.locator('.ak-annotated-notes')).toBeVisible();
    await expect(page.locator('.ak-bench .ak-badge').first()).toBeVisible();
    await expect(page.locator('#ref-web-vitals')).toBeVisible();
    const printedUrl = await page
      .locator('#ref-web-vitals .ak-ref-title a')
      .evaluate((link) => getComputedStyle(link, '::after').content);
    expect(printedUrl).toContain('https://web.dev/articles/vitals');
  });
});
