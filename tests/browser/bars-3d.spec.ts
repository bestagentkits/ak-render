import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { exportPage } from '../../src/export/page-export.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('bars-3d');

function html(name: string): string {
  const file = fileURLToPath(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url));
  return compile(readFileSync(file, 'utf8'), { source: name }).html;
}
const pageUrl = (name: string) => `file://${workspace.write(name, html(name))}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
}

/** How many live scenes the runtime has mounted. */
async function mountCount(page: Page) {
  return page.evaluate(() => {
    const api = (window as unknown as { akRender3d: { stats(): { mounts: number } } }).akRender3d;
    return api.stats().mounts;
  });
}

test.describe('bars-3d', () => {
  test('renders 500 bars as a real WebGL frame with no network request', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.goto(pageUrl('bars-3d-dense'));
    await ready(page);
    expect(await mountCount(page)).toBe(1);
    const painted = await page.locator('.ak-3d-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d') as CanvasRenderingContext2D;
      context.drawImage(canvas, 0, 0);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      const colors = new Set<number>();
      for (let i = 0; i < data.length; i += 16)
        colors.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
      return colors.size;
    });
    expect(painted).toBeGreaterThan(50);
    await expect(page.locator('.ak-bars-poster')).toBeHidden();
    await expect(page.locator('[data-ak-3d-pick]')).toHaveCount(500);
    expect(requests).toEqual([]);
  });

  test('picking a bar writes state and state selects the bar', async ({ page }) => {
    await page.goto(pageUrl('bars-3d-stacked'));
    await ready(page);
    const pick = page.locator('[data-ak-id="pick"] select');
    await expect(page.locator('[data-ak-3d-pick="q3/ops"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.locator('[data-ak-3d-pick="q2/invest"]').click();
    await expect(pick).toHaveValue('q2/invest');
    await pick.selectOption('q4/finance');
    await expect(page.locator('[data-ak-3d-pick="q4/finance"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-ak-3d-pick="q2/invest"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // Keyboard on the canvas cycles bars through the same path.
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('n');
    await expect(pick).not.toHaveValue('q4/finance');
  });

  test('the series filter writes its state path and restacks the bars', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl('bars-3d-stacked'));
    await ready(page);
    const before = await page.locator('.ak-3d-canvas').screenshot();
    await page.locator('[data-ak-bars-filter="invest"]').click();
    await expect(page.locator('[data-ak-bars-filter="invest"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-ak-bars-filter=""]')).toHaveAttribute('aria-pressed', 'false');
    const show = page.locator('[data-ak-id="flow-pick"] select');
    await expect(show).toHaveValue('invest');
    // Reduced motion applies the filtered layout at once, so the very next frame differs.
    const after = await page.locator('.ak-3d-canvas').screenshot();
    expect(after.equals(before)).toBe(false);
    // State drives the filter too: a control bound to the same path restacks the bars.
    await show.selectOption('ops');
    await expect(page.locator('[data-ak-bars-filter="ops"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await show.selectOption('all');
    await expect(page.locator('[data-ak-bars-filter=""]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('without JavaScript the flat chart and the full data table carry every value', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pageUrl('bars-3d-dense'));
    await expect(page.locator('.ak-bars-poster')).toBeVisible();
    await expect(page.locator('.ak-bars-data tbody tr')).toHaveCount(50);
    await expect(page.locator('.ak-bars-data tbody td')).toHaveCount(500);
    await expect(page.locator('.ak-bars-data')).toContainText('-1.7%');
    await expect(page.locator('[data-ak-3d-pick]').first()).toBeDisabled();
    await context.close();
  });

  test('print shows the whole table, not a scrolled window of it', async ({ page }) => {
    await page.goto(pageUrl('bars-3d-dense'));
    await ready(page);
    await page.emulateMedia({ media: 'print' });
    const overflow = await page
      .locator('.ak-bars-data')
      .evaluate((el) => getComputedStyle(el).maxHeight);
    expect(overflow).toBe('none');
  });

  test('PNG and PDF export carry the live frame', async () => {
    const page = html('bars-3d-stacked');
    const outDir = workspace.dir();
    const png = await exportPage({ html: page, format: 'png', out: join(outDir, 'bars.png') });
    expect(png.scenes).toBe(1);
    expect(png.frames).toHaveLength(1);
    expect(png.blockedRequests).toBe(0);
    expect(readFileSync(join(outDir, 'bars.png')).subarray(0, 4).toString('hex')).toBe('89504e47');
    const pdf = await exportPage({ html: page, format: 'pdf', out: join(outDir, 'bars.pdf') });
    expect(pdf.scenes).toBe(1);
    const bytes = readFileSync(join(outDir, 'bars.pdf'));
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const frames = [
      ...bytes.toString('latin1').matchAll(/\/Width (\d+)[\s\S]{0,200}?\/Height (\d+)/gu),
    ].filter((m) => Number(m[1]) >= 2000);
    expect(frames.length).toBeGreaterThanOrEqual(1);
  });
});
