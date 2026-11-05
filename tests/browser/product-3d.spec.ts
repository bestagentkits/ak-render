import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { exportPage } from '../../src/export/page-export.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('product-3d');
const FIXTURE = 'product-3d-speaker';

function html(): string {
  const file = fileURLToPath(new URL(`../../fixtures/3d/${FIXTURE}.yaml`, import.meta.url));
  return compile(readFileSync(file, 'utf8'), { source: FIXTURE }).html;
}
const pageUrl = () => `file://${workspace.write(FIXTURE, html())}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
}

/** Distinct colours on the live canvas: a real WebGL frame, not the poster. */
function paintedColors(page: Page): Promise<number> {
  return page.locator('.ak-3d-canvas').evaluate((canvas: HTMLCanvasElement) => {
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
}

test.describe('product-3d', { tag: '@gl' }, () => {
  test('renders a lit WebGL frame with pins and controls, and no network request', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.goto(pageUrl());
    await ready(page);
    expect(await paintedColors(page)).toBeGreaterThan(50);
    await expect(page.locator('.ak-product-poster')).toBeHidden();
    await expect(page.locator('.ak-3d-pin')).toHaveCount(6);
    await expect(page.locator('select[data-ak-product-variant] option')).toHaveCount(4);
    await expect(page.locator('select[data-ak-product-variant]')).toBeEnabled();
    await expect(page.locator('[data-ak-product-hotspot]').first()).toBeEnabled();
    expect(requests).toEqual([]);
  });

  test('the finish dropdown, page state and the live parts stay in step', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl());
    await ready(page);
    const own = page.locator('select[data-ak-product-variant]');
    const pageSelect = page.locator('[data-ak-id="finish-pick"] select');
    const figure = page.locator('[data-ak-3d="product"]');
    await expect(own).toHaveValue('graphite');
    const before = await page.locator('.ak-3d-canvas').screenshot();
    await own.selectOption('silver');
    await expect(pageSelect).toHaveValue('silver');
    await expect(figure).toHaveAttribute('data-ak-product-finish', 'silver');
    const after = await page.locator('.ak-3d-canvas').screenshot();
    expect(after.equals(before)).toBe(false);
    await pageSelect.selectOption('chalk');
    await expect(own).toHaveValue('chalk');
    await expect(figure).toHaveAttribute('data-ak-product-finish', 'chalk');
  });

  test('hotspots select by list, pin, keyboard and state, and fly the camera', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl());
    await ready(page);
    const feature = page.locator('[data-ak-id="feature-pick"] select');
    const card = page.locator('.ak-product-detail');
    // The bound hotspot is chosen on load.
    await expect(page.locator('[data-ak-product-hotspot="woofer"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(card).toContainText('5-inch woofer');
    const before = await page.locator('.ak-3d-canvas').screenshot();
    await page.locator('[data-ak-product-hotspot="dial"]').click();
    await expect(feature).toHaveValue('dial');
    await expect(page.locator('[data-ak-3d-pin="dial"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(card).toContainText('64 detents');
    // Reduced motion lands the camera at once, so the next frame shows the close-up.
    expect((await page.locator('.ak-3d-canvas').screenshot()).equals(before)).toBe(false);
    // State drives the choice too.
    await feature.selectOption('port');
    await expect(page.locator('[data-ak-product-hotspot="port"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Keyboard: the list is reachable by Tab, and the canvas cycles hotspots with n.
    await page.locator('[data-ak-product-hotspot="tweeter"]').focus();
    await page.keyboard.press('Enter');
    await expect(feature).toHaveValue('tweeter');
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('n');
    await expect(feature).toHaveValue('dial');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-ak-product-hotspot][aria-pressed="true"]')).toHaveCount(0);
    await expect(card).toBeHidden();
  });

  test('the exploded view toggles from the button, the keyboard and state', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl());
    await ready(page);
    const view = page.locator('[data-ak-id="view-pick"] select');
    const button = page.locator('[data-ak-product-explode]');
    const before = await page.locator('.ak-3d-canvas').screenshot();
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(view).toHaveValue('exploded');
    expect((await page.locator('.ak-3d-canvas').screenshot()).equals(before)).toBe(false);
    await view.selectOption('assembled');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('e');
    await expect(view).toHaveValue('exploded');
    // A modified key belongs to the browser, not the widget.
    await page.keyboard.press('Control+e');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  test('a resize keeps the chosen hotspot and its close-up', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(pageUrl());
    await ready(page);
    const feature = page.locator('[data-ak-id="feature-pick"] select');
    await page.locator('[data-ak-product-hotspot="battery"]').click();
    await page.locator('[data-ak-product-explode]').click();
    await page.setViewportSize({ width: 760, height: 900 });
    await expect(feature).toHaveValue('battery');
    await expect(page.locator('[data-ak-product-hotspot="battery"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-ak-product-explode]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.ak-product-detail')).toContainText('20-hour battery');
    // Still the close-up: the dial on top is out of frame, as it is not in the whole product.
    await expect(page.locator('[data-ak-3d-pin="battery"]')).toBeVisible();
    await expect(page.locator('[data-ak-3d-pin="dial"]')).toBeHidden();
  });

  test('a pick on a part with no hotspot chooses the nearest one', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl());
    await ready(page);
    const feature = page.locator('[data-ak-id="feature-pick"] select');
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-ak-product-hotspot][aria-pressed="true"]')).toHaveCount(0);
    // The dust cap sits at the woofer's centre: level with the woofer pin, under the tweeter pin.
    const woofer = await page.locator('[data-ak-3d-pin="woofer"]').boundingBox();
    const tweeter = await page.locator('[data-ak-3d-pin="tweeter"]').boundingBox();
    if (woofer === null || tweeter === null) throw new Error('pins not placed');
    await page.mouse.click(tweeter.x + tweeter.width / 2, woofer.y + woofer.height / 2);
    await expect(feature).toHaveValue('woofer');
  });

  test('with motion allowed, transitions settle and the scene stops rendering', async ({
    page,
  }) => {
    await page.goto(pageUrl());
    await ready(page);
    await page.locator('select[data-ak-product-variant]').selectOption('signal');
    await page.locator('[data-ak-product-explode]').click();
    await page.locator('[data-ak-product-hotspot="battery"]').click();
    const frames = () =>
      page.evaluate(
        () =>
          (
            window as unknown as { akRender3d: { stats(): { renderMs: number[] } } }
          ).akRender3d.stats().renderMs.length,
      );
    await expect
      .poll(
        async () => {
          const a = await frames();
          await page.waitForTimeout(400);
          return (await frames()) - a;
        },
        { timeout: 30_000 },
      )
      .toBe(0);
    await expect(page.locator('[data-ak-3d="product"]')).toHaveAttribute(
      'data-ak-product-finish',
      'signal',
    );
  });

  test('without JavaScript the plan, numbered pins, finishes and hotspots carry the content', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pageUrl());
    await expect(page.locator('.ak-product-poster')).toBeVisible();
    await expect(page.locator('.ak-product-poster .ak-product-pin')).toHaveCount(6);
    await expect(page.locator('.ak-product-finishes')).toBeVisible();
    await expect(page.locator('.ak-product-finishes li')).toHaveCount(4);
    await expect(page.locator('.ak-3d-hotspots li')).toHaveCount(6);
    await expect(page.locator('[data-ak-product-hotspot]').first()).toBeDisabled();
    await expect(page.locator('.ak-3d-hotspots')).toContainText('Rear bass port');
    await context.close();
  });

  test('unmount frees the widget and a remount comes back ready', async ({ page }) => {
    await page.goto(pageUrl());
    await ready(page);
    await page.evaluate(() =>
      (window as unknown as { akRender3d: { unmountAll(): void } }).akRender3d.unmountAll(),
    );
    await expect(page.locator('.ak-3d-pin')).toHaveCount(0);
    await expect(page.locator('select[data-ak-product-variant]')).toBeDisabled();
    await page.evaluate(() =>
      (window as unknown as { akRender3d: { mountAll(): void } }).akRender3d.mountAll(),
    );
    await ready(page);
    await expect(page.locator('.ak-3d-pin')).toHaveCount(6);
  });

  test('PNG and PDF export carry the live frame', async () => {
    const page = html();
    const outDir = workspace.dir();
    const png = await exportPage({ html: page, format: 'png', out: join(outDir, 'product.png') });
    expect(png.scenes).toBe(1);
    expect(png.frames).toHaveLength(1);
    expect(png.blockedRequests).toBe(0);
    expect(readFileSync(join(outDir, 'product.png')).subarray(0, 4).toString('hex')).toBe(
      '89504e47',
    );
    const pdf = await exportPage({ html: page, format: 'pdf', out: join(outDir, 'product.pdf') });
    expect(pdf.scenes).toBe(1);
    expect(readFileSync(join(outDir, 'product.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
