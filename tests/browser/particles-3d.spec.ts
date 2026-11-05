import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { exportPage } from '../../src/export/page-export.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('particles-3d');

function html(name: string): string {
  const file = fileURLToPath(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url));
  return compile(readFileSync(file, 'utf8'), { source: name }).html;
}
const pageUrl = (name: string) => `file://${workspace.write(name, html(name))}`;

interface Stats {
  mounts: number;
  frames: number;
  particleResources: number;
}
type Api = { stats(): Stats; unmountAll(): void; mountAll(): void };

const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as { akRender3d: Api }).akRender3d.stats());

async function allReady(page: Page): Promise<void> {
  const scenes = page.locator('[data-ak-3d]');
  const count = await scenes.count();
  for (let i = 0; i < count; i += 1)
    await expect(scenes.nth(i)).toHaveAttribute('data-ak-3d-state', 'ready');
}

/** Distinct colors in a canvas, sampled; a blank or poster-only stage has very few. */
function colorCount(page: Page, selector: string) {
  return page.locator(selector).evaluate((canvas: HTMLCanvasElement) => {
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

test.describe('particles-3d', { tag: '@gl' }, () => {
  test('every preset draws a real WebGL frame with no network request', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.goto(pageUrl('particles-3d-presets'));
    await allReady(page);
    expect((await stats(page)).mounts).toBe(6);
    await expect(page.locator('[data-ak-3d-path="gpu"]')).toHaveCount(6);
    expect(await colorCount(page, '[data-ak-id="nebula"] .ak-3d-canvas')).toBeGreaterThan(50);
    await expect(page.locator('[data-ak-id="nebula"] .ak-pt-poster')).toBeHidden();
    await expect(page.locator('[data-ak-id="nebula"] .ak-pt-pause')).toHaveText('Pause');
    expect(requests).toEqual([]);
  });

  test('one seed draws the same frame twice; another seed draws a different one', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 2400 });
    await page.goto(pageUrl('particles-3d-seeds'));
    await allReady(page);
    const frame = (id: string) =>
      page
        .locator(`[data-ak-id="${id}"] .ak-3d-canvas`)
        .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL('image/png'));
    const a = await frame('twin-a');
    expect(await frame('twin-b')).toBe(a);
    expect(await frame('other')).not.toBe(a);
  });

  test('reduced motion holds the poster frame still and offers no pause', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl('particles-3d-galaxy'));
    await allReady(page);
    await expect(page.locator('.ak-pt-pause')).toHaveCount(0);
    const before = (await stats(page)).frames;
    await page.waitForTimeout(400);
    expect((await stats(page)).frames).toBe(before);
  });

  test('the pause button stops and restarts the motion', async ({ page }) => {
    await page.goto(pageUrl('particles-3d-galaxy'));
    await allReady(page);
    const pause = page.locator('.ak-pt-pause');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect(pause).toHaveText('Play');
    const held = (await stats(page)).frames;
    await page.waitForTimeout(400);
    expect((await stats(page)).frames).toBe(held);
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await stats(page)).frames).toBeGreaterThan(held);
  });

  test('offscreen the scene stops drawing and resumes when it returns', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 240 });
    await page.goto(pageUrl('particles-3d-galaxy'));
    await page.locator('.ak-3d-stage').scrollIntoViewIfNeeded();
    await allReady(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('.ak-3d-stage')).not.toBeInViewport();
    await page.waitForTimeout(200);
    const parked = (await stats(page)).frames;
    await page.waitForTimeout(500);
    expect((await stats(page)).frames).toBe(parked);
    await page.locator('.ak-3d-stage').scrollIntoViewIfNeeded();
    await expect.poll(async () => (await stats(page)).frames).toBeGreaterThan(parked);
  });

  test('slow frames step the particle count down', async ({ page }) => {
    // Every clock read moves 40 ms on, so each frame looks slower than the budget.
    await page.addInitScript(() => {
      let now = 0;
      performance.now = () => {
        now += 40;
        return now;
      };
    });
    await page.goto(pageUrl('particles-3d-galaxy'));
    await allReady(page);
    const scene = page.locator('[data-ak-3d="particles"]');
    await expect
      .poll(async () => Number(await scene.getAttribute('data-ak-3d-level')), { timeout: 20_000 })
      .toBeGreaterThan(0);
  });

  test('the low profile starts one step down on the GPU path', async ({ page }) => {
    await page.goto(pageUrl('particles-3d-galaxy'));
    await allReady(page);
    await page.evaluate(() => {
      const api = (window as unknown as { akRender3d: Api }).akRender3d;
      api.unmountAll();
      document.documentElement.setAttribute('data-ak-3d-quality', 'low');
      api.mountAll();
    });
    await allReady(page);
    const scene = page.locator('[data-ak-3d="particles"]');
    await expect(scene).toHaveAttribute('data-ak-3d-path', 'gpu');
    await expect(scene).toHaveAttribute('data-ak-3d-level', '1');
  });

  test('the bounded CPU path draws the same effect', async ({ page }) => {
    await page.goto(pageUrl('particles-3d-galaxy'));
    await allReady(page);
    await page.evaluate(() => {
      const api = (window as unknown as { akRender3d: Api }).akRender3d;
      api.unmountAll();
      document.documentElement.setAttribute('data-ak-3d-path', 'cpu');
      api.mountAll();
    });
    await allReady(page);
    await expect(page.locator('[data-ak-3d="particles"]')).toHaveAttribute(
      'data-ak-3d-path',
      'cpu',
    );
    expect(await colorCount(page, '.ak-3d-canvas')).toBeGreaterThan(50);
  });

  test('unmounting releases every particle resource and a remount works', async ({ page }) => {
    await page.goto(pageUrl('particles-3d-presets'));
    await allReady(page);
    expect((await stats(page)).particleResources).toBe(12);
    await page.evaluate(() => (window as unknown as { akRender3d: Api }).akRender3d.unmountAll());
    const after = await stats(page);
    expect(after.mounts).toBe(0);
    expect(after.particleResources).toBe(0);
    await expect(page.locator('.ak-3d-canvas')).toHaveCount(0);
    await expect(page.locator('.ak-pt-pause')).toHaveCount(0);
    await expect(page.locator('[data-ak-3d-state="static"]')).toHaveCount(6);
    await page.evaluate(() => (window as unknown as { akRender3d: Api }).akRender3d.mountAll());
    await allReady(page);
    expect((await stats(page)).particleResources).toBe(12);
  });

  test('without JavaScript the poster and the summary carry the page', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pageUrl('particles-3d-galaxy'));
    await expect(page.locator('.ak-pt-poster')).toBeVisible();
    expect(await page.locator('.ak-pt-poster circle').count()).toBeGreaterThan(1000);
    await expect(page.locator('.ak-3d-caption')).toContainText('three spiral arms');
    await context.close();
  });

  test('print shows the poster and hides the live controls', async ({ page }) => {
    await page.goto(pageUrl('particles-3d-galaxy'));
    await allReady(page);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-pt-poster')).toBeVisible();
    await expect(page.locator('.ak-pt-pause')).toBeHidden();
  });

  test('PNG export carries the live frame', async () => {
    const outDir = workspace.dir();
    const png = await exportPage({
      html: html('particles-3d-galaxy'),
      format: 'png',
      out: join(outDir, 'particles.png'),
    });
    expect(png.scenes).toBe(1);
    expect(png.frames).toHaveLength(1);
    expect(png.blockedRequests).toBe(0);
  });
});
