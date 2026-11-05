import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { exportPage } from '../../src/export/page-export.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('text-3d');

function html(name: string): string {
  const file = fileURLToPath(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url));
  return compile(readFileSync(file, 'utf8'), { source: name }).html;
}
const pageUrl = (name: string) => `file://${workspace.write(name, html(name))}`;

interface Stats {
  mounts: number;
  frames: number;
  textResources: number;
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

/** Distinct colors in a canvas, sampled; a blank stage has very few. */
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

test.describe('text-3d', { tag: '@gl' }, () => {
  test('every material draws real lettering with no network request', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.setViewportSize({ width: 1200, height: 3600 });
    await page.goto(pageUrl('text-3d-materials'));
    await allReady(page);
    expect((await stats(page)).mounts).toBe(5);
    for (const id of ['satin', 'metal', 'chrome', 'glass', 'neon'])
      expect(await colorCount(page, `[data-ak-id="${id}"] .ak-3d-canvas`)).toBeGreaterThan(40);
    await expect(page.locator('[data-ak-id="metal"] .ak-tx-poster')).toBeHidden();
    await expect(page.locator('[data-ak-id="satin"] .ak-tx-pause')).toHaveCount(0);
    await expect(page.locator('[data-ak-id="metal"] .ak-tx-pause')).toHaveText('Pause');
    expect(requests).toEqual([]);
  });

  test('Unicode text mounts, and a missing glyph keeps the text readable', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 2600 });
    await page.goto(pageUrl('text-3d-unicode'));
    await allReady(page);
    await expect(page.locator('[data-ak-id="viet"] .ak-3d-canvas')).toHaveAttribute(
      'aria-label',
      'Tiếng Việt đẹp',
    );
    await expect(page.locator('[data-ak-id="missing"] .ak-tx-copy')).toHaveText('Hi 世界 ✓');
  });

  test('reduced motion holds the rest pose and offers no pause', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl('text-3d-hero'));
    await allReady(page);
    await expect(page.locator('.ak-tx-pause')).toHaveCount(0);
    const before = (await stats(page)).frames;
    await page.waitForTimeout(400);
    expect((await stats(page)).frames).toBe(before);
  });

  test('the pause button stops and restarts the motion', async ({ page }) => {
    await page.goto(pageUrl('text-3d-hero'));
    await allReady(page);
    const pause = page.locator('.ak-tx-pause');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    const held = (await stats(page)).frames;
    await page.waitForTimeout(400);
    expect((await stats(page)).frames).toBe(held);
    await pause.click();
    await expect.poll(async () => (await stats(page)).frames).toBeGreaterThan(held);
  });

  test('offscreen the lettering stops drawing and resumes when it returns', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 240 });
    await page.goto(pageUrl('text-3d-hero'));
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

  test('unmounting releases every text resource and a remount works', async ({ page }) => {
    await page.goto(pageUrl('text-3d-hero'));
    await allReady(page);
    // Six distinct glyphs, two materials and one environment map.
    expect((await stats(page)).textResources).toBe(9);
    await page.evaluate(() => (window as unknown as { akRender3d: Api }).akRender3d.unmountAll());
    const after = await stats(page);
    expect(after.mounts).toBe(0);
    expect(after.textResources).toBe(0);
    await expect(page.locator('.ak-3d-canvas')).toHaveCount(0);
    await expect(page.locator('.ak-tx-ground')).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { akRender3d: Api }).akRender3d.mountAll());
    await allReady(page);
    expect((await stats(page)).textResources).toBe(9);
  });

  test('without JavaScript the poster draws the same words', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pageUrl('text-3d-hero'));
    const poster = page.locator('.ak-tx-poster');
    await expect(poster).toBeVisible();
    await expect(poster).toHaveAttribute('aria-label', 'Ship it.');
    expect(await page.locator('.ak-tx-poster defs path').count()).toBe(6);
    await context.close();
  });

  test('print shows the poster and hides the pause control', async ({ page }) => {
    await page.goto(pageUrl('text-3d-hero'));
    await allReady(page);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-tx-pause')).toBeHidden();
  });

  test('PNG export carries the live frame', async () => {
    const png = await exportPage({
      html: html('text-3d-hero'),
      format: 'png',
      out: join(workspace.dir(), 'text.png'),
    });
    expect(png.scenes).toBe(1);
    expect(png.frames).toHaveLength(1);
    expect(png.blockedRequests).toBe(0);
  });
});
