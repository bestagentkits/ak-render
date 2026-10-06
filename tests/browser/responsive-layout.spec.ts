import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'ak-render-layout-'));
const target = join(workspace, 'responsive-layouts.html');
writeFileSync(
  target,
  compile(readFileSync(`${pagesDir}/responsive-layouts.yaml`, 'utf8'), {
    source: 'responsive-layouts',
  }).html,
  'utf8',
);
const url = `file://${target}`;

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Border-box rectangles of the dashboard grid's items, in DOM order (the fixture has five). */
async function itemBoxes(page: Page): Promise<[Box, Box, Box, ...Box[]]> {
  const boxes = await page
    .locator('.ak-grid[data-ak-tracks] > .ak-grid-item')
    .evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
  const [first, second, third, ...rest] = boxes;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error(`expected at least three grid items, found ${boxes.length}`);
  }
  return [first, second, third, ...rest];
}

for (const width of [320, 375, 768, 1440]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`no horizontal overflow at ${width}px (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      expect(await overflow(page)).toBe(0);
    });
  }
}

test('an 8/4 split keeps its track ratio on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  const [wide, narrow] = await itemBoxes(page);
  const gap = await page
    .locator('.ak-grid[data-ak-tracks]')
    .evaluate((grid) => Number.parseFloat(getComputedStyle(grid).columnGap));
  // Eight tracks plus their gaps are exactly two four-track items plus gaps.
  expect(Math.abs(wide.width + gap - 2 * (narrow.width + gap))).toBeLessThanOrEqual(2);
  expect(Math.abs(wide.y - narrow.y)).toBeLessThanOrEqual(1);
});

test('the rowSpan item spans the rows of the items beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  const [tall, first, second] = await itemBoxes(page);
  expect(second.y).toBeGreaterThan(first.y);
  expect(second.x).toBeCloseTo(first.x, 0);
  expect(tall.y + tall.height).toBeGreaterThanOrEqual(second.y + second.height - 1);
});

test('every grid item is full width on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);
  const grid = await page.locator('.ak-grid[data-ak-tracks]').boundingBox();
  for (const box of await itemBoxes(page)) {
    expect(Math.abs(box.width - (grid?.width ?? 0))).toBeLessThanOrEqual(1);
  }
});

test('semantic layouts sit side by side on a wide screen and stack in reading order on a phone', async ({
  page,
}) => {
  const order = () =>
    page.locator('.ak-sidebar-layout, .ak-main-aside, .ak-rail-layout').evaluateAll((layouts) =>
      layouts.map((layout) => {
        const [first, second] = [...layout.children].map(
          (child) => child.getBoundingClientRect().y,
        );
        if (first === undefined || second === undefined)
          return { sideBySide: false, firstAbove: false };
        return { sideBySide: Math.abs(first - second) < 1, firstAbove: first < second };
      }),
    );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  expect((await order()).every((layout) => layout.sideBySide)).toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  expect((await order()).every((layout) => layout.firstAbove)).toBe(true);
});

test('the aside stays in view while the main column scrolls on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(url);
  const aside = page.locator('.ak-main-aside > aside');
  await expect(aside).toHaveCSS('position', 'sticky');
  await page.emulateMedia({ media: 'print' });
  await expect(aside).toHaveCSS('position', 'static');
});

test('a rail of links is a labelled navigation landmark', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole('navigation', { name: 'Report sections' })).toHaveCount(1);
  await expect(page.getByRole('complementary')).not.toHaveCount(0);
});

test('reads completely without scripts', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 375, height: 812 },
  });
  const page = await context.newPage();
  await page.goto(url);
  expect(await overflow(page)).toBe(0);
  await expect(
    page.getByText('Three compiles of every fixture produce the same hash.'),
  ).toBeVisible();
  await expect(page.getByText('A stack can center its children.')).toBeVisible();
  await context.close();
});
