import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-engineering-'));
const fixture = readFileSync(
  fileURLToPath(new URL('../../fixtures/pages/engineering-widgets.yaml', import.meta.url)),
  'utf8',
);
const target = join(workspace, 'engineering-widgets.html');
writeFileSync(target, compile(fixture).html, 'utf8');

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function open(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`file://${target}`, { waitUntil: 'load' });
}

test.describe('engineering widgets', () => {
  for (const width of [320, 375, 768, 1440]) {
    test(`the page does not overflow at ${width}px`, async ({ page }) => {
      await open(page, width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
    });
  }

  test('the kanban strip scrolls with the keyboard on a phone', async ({ page }) => {
    await open(page, 320);
    const strip = page.locator('.ak-kanban');
    await expect(strip).toHaveAttribute('role', 'region');
    await expect(strip).toHaveAttribute('aria-label', /.+/u);
    const scrollable = await strip.evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(scrollable).toBe(true);
    await strip.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => strip.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  });

  test('the roadmap becomes an agenda on a phone and a grid on a desktop', async ({ page }) => {
    await open(page, 320);
    await expect(page.locator('.ak-roadmap')).toBeHidden();
    await expect(page.locator('.ak-roadmap-agenda')).toBeVisible();
    await open(page, 1440);
    await expect(page.locator('.ak-roadmap')).toBeVisible();
    await expect(page.locator('.ak-roadmap-agenda')).toBeHidden();
    // An item spanning two periods is twice as wide as a one-period item.
    const widths = await page
      .locator('.ak-roadmap-item')
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
    const [span, single] = widths;
    expect(span ?? 0).toBeGreaterThan((single ?? 0) * 1.8);
  });

  test('the log search narrows lines and print shows every suite', async ({ page }) => {
    await open(page, 1440);
    await page.getByLabel('Search lines').fill('connection reset');
    await expect(page.locator('.ak-log-line:visible')).toHaveCount(2);
    // A reader may fold suites; print still shows their cases.
    await page.evaluate(() => {
      for (const details of document.querySelectorAll('details.ak-tests-suite')) {
        details.removeAttribute('open');
      }
    });
    await expect(page.getByText('schema tree prints open')).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-log-search')).toBeHidden();
    await expect(page.locator('.ak-roadmap-agenda')).toBeVisible();
    await expect(page.getByText('schema tree prints open')).toBeVisible();
  });

  test('without scripts every widget still reads in full', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await open(page, 375);
    for (const text of [
      'Retry artifact uploads with backoff',
      'Multi-region artifact storage',
      'rejects a reversed roadmap range',
      'tick: 0 queued, 2 running, 0 delayed',
      'The run was queued.',
      'JSON path of the problem',
    ]) {
      await expect(page.getByText(text).filter({ visible: true }).first()).toBeVisible();
    }
    await context.close();
  });
});
