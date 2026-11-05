import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('terrain-3d');
const FIXTURE = 'terrain-3d-alpine';

function html(): string {
  const file = fileURLToPath(new URL(`../../fixtures/3d/${FIXTURE}.yaml`, import.meta.url));
  return compile(readFileSync(file, 'utf8'), { source: FIXTURE }).html;
}
const pageUrl = (name = FIXTURE, source = html()) => `file://${workspace.write(name, source)}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
}

interface Stats {
  terrainResources: number;
  renderMs: number[];
}
const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as { akRender3d: { stats(): Stats } }).akRender3d.stats());

/** Distinct colours on the live canvas: a real lit WebGL frame, not the poster. */
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

test.describe('terrain-3d', { tag: '@gl' }, () => {
  test('renders the lit block with pins and a flyover Pause that stops every frame, offline', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.goto(pageUrl());
    await ready(page);
    expect(await paintedColors(page)).toBeGreaterThan(50);
    await expect(page.locator('.ak-tr-poster')).toBeHidden();
    await expect(page.locator('[data-ak-terrain-pin]')).toHaveCount(4);
    await expect(page.locator('[data-ak-terrain-mark]').first()).toBeEnabled();
    const pause = page.locator('.ak-tr-pause');
    await expect(pause).toHaveText('Pause');
    // Ground, walls, two contour sets and the pin stems: a geometry and a material each.
    expect((await stats(page)).terrainResources).toBe(10);
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    const frames = async () => (await stats(page)).renderMs.length;
    await expect
      .poll(
        async () => {
          const a = await frames();
          await page.waitForTimeout(400);
          return (await frames()) - a;
        },
        { timeout: 15_000 },
      )
      .toBe(0);
    expect(requests).toEqual([]);
    await page.evaluate(() =>
      (window as unknown as { akRender3d: { unmountAll(): void } }).akRender3d.unmountAll(),
    );
    expect((await stats(page)).terrainResources).toBe(0);
    await expect(page.locator('[data-ak-terrain-mark]').first()).toBeDisabled();
  });

  test('places, the keyboard and page state choose a place and stay in step', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl());
    await ready(page);
    const select = page.locator('[data-ak-id="place-pick"] select');
    // Reduced motion: no flyover and so no pause control.
    await expect(page.locator('.ak-tr-pause')).toHaveCount(0);
    const before = await page.locator('.ak-3d-canvas').screenshot();
    await page.locator('[data-ak-terrain-mark="lake"]').click();
    await expect(select).toHaveValue('lake');
    await expect(page.locator('[data-ak-terrain-mark="lake"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-ak-terrain-pin="lake"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.ak-tr-tag')).toContainText('Lac Noir');
    // Reduced motion lands the flight at once, so the next frame is the close-up.
    expect((await page.locator('.ak-3d-canvas').screenshot()).equals(before)).toBe(false);
    await select.selectOption('summit');
    await expect(page.locator('[data-ak-terrain-mark="summit"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.ak-tr-tag')).toContainText('Grand Pic');
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('n');
    await expect(select).toHaveValue('col');
    await page.keyboard.press('p');
    await expect(select).toHaveValue('summit');
    // Escape flies home and clears the place.
    await page.keyboard.press('Escape');
    await expect(select).toHaveValue('');
    await expect(page.locator('.ak-tr-tag')).toBeHidden();
    await expect(page.locator('[data-ak-terrain-mark][aria-pressed="true"]')).toHaveCount(0);
  });

  test('a tampered heightmap keeps its drawing and reports an error', async ({ page }) => {
    const source = html().replace(
      /&quot;heights&quot;:&quot;[A-Za-z0-9+/]{8}/u,
      '&quot;heights&quot;:&quot;',
    );
    expect(source).not.toBe(html());
    await page.goto(pageUrl('terrain-3d-tampered', source));
    await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'error');
    await expect(page.locator('.ak-tr-poster')).toBeVisible();
    await expect(page.locator('.ak-3d-canvas')).toHaveCount(0);
  });

  test('without JavaScript, and in print, the drawing, legend and places carry the content', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pageUrl());
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-tr-poster')).toBeVisible();
    await expect(page.locator('.ak-tr-poster .ak-tr-pin')).toHaveCount(4);
    await expect(page.locator('.ak-tr-ramp')).toBeVisible();
    await expect(page.locator('.ak-tr-facts')).toContainText('Elevation 820 m to 3,120 m');
    await expect(page.locator('.ak-tr-marks li')).toHaveCount(4);
    await expect(page.locator('.ak-tr-marks')).toContainText('Grand Pic');
    await expect(page.locator('[data-ak-terrain-mark]').first()).toBeDisabled();
    await context.close();
  });
});
