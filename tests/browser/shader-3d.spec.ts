import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { exportPage } from '../../src/export/page-export.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('shader-3d');
const PRESETS = ['noise', 'fresnel', 'hologram', 'distortion', 'dissolve'];

function html(name: string): string {
  const file = fileURLToPath(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url));
  return compile(readFileSync(file, 'utf8'), { source: name }).html;
}
const pageUrl = (name: string) => `file://${workspace.write(name, html(name))}`;

interface Stats {
  mounts: number;
  frames: number;
  shaderResources: number;
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
const frame = (page: Page, id: string) =>
  page
    .locator(`[data-ak-id="${id}"] .ak-3d-canvas`)
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL('image/png'));

test.describe('shader-3d', { tag: '@gl' }, () => {
  test('every preset draws its own real WebGL frame with no network request', async ({
    page,
  }, testInfo) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1100, height: 4200 });
    await page.goto(pageUrl('shader-3d-presets'));
    await allReady(page);
    expect((await stats(page)).mounts).toBe(5);
    const frames = new Set<string>();
    for (const preset of PRESETS) {
      const canvas = `[data-ak-id="${preset}"] .ak-3d-canvas`;
      await expect(page.locator(`[data-ak-id="${preset}"]`)).toHaveAttribute(
        'data-ak-sh-preset',
        preset,
      );
      expect(await colorCount(page, canvas)).toBeGreaterThan(50);
      await expect(page.locator(`[data-ak-id="${preset}"] .ak-sh-poster`)).toBeHidden();
      // Preset by preset: each screenshot is kept with the run and must differ from the rest.
      const shot = await page.locator(`[data-ak-id="${preset}"] .ak-3d-stage`).screenshot();
      await testInfo.attach(`shader-${preset}.png`, { body: shot, contentType: 'image/png' });
      frames.add(await frame(page, preset));
    }
    expect(frames.size).toBe(PRESETS.length);
    await expect(page.locator('[data-ak-id="hologram"]')).toHaveAttribute(
      'data-ak-sh-post',
      'bloom chromatic scanlines vignette',
    );
    expect(requests).toEqual([]);
  });

  test('one seed draws the same frame twice; another seed draws a different one', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 2400 });
    await page.goto(pageUrl('shader-3d-seeds'));
    await allReady(page);
    const a = await frame(page, 'twin-a');
    expect(await frame(page, 'twin-b')).toBe(a);
    expect(await frame(page, 'other')).not.toBe(a);
  });

  test('controls and bound state drive the parameters and the preset', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl('shader-3d-controls'));
    await allReady(page);
    const block = page.locator('[data-ak-id="reveal"]');
    const progress = block.locator('[data-ak-sh-param="progress"]');
    await expect(progress).toBeEnabled();
    const before = await frame(page, 'reveal');
    // A slider changes the uniform, the readout and the bound state.
    await progress.fill('0.7');
    await expect(block.locator('.ak-sh-control output').nth(1)).toHaveText('0.7');
    const after = await frame(page, 'reveal');
    expect(after).not.toBe(before);
    // A select bound to the same state switches the preset and the buttons follow.
    await page.locator('[data-ak-id="look-pick"] select').selectOption('hologram');
    await expect(block).toHaveAttribute('data-ak-sh-preset', 'hologram');
    await expect(block.locator('[data-ak-sh-preset="hologram"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await frame(page, 'reveal')).not.toBe(after);
    // A preset button writes the state back to the select.
    await block.locator('[data-ak-sh-preset="noise"]').click();
    await expect(page.locator('[data-ak-id="look-pick"] select')).toHaveValue('noise');
    await expect(block).toHaveAttribute('data-ak-sh-preset', 'noise');
  });

  test('reduced motion holds the poster frame still and offers no pause', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl('shader-3d-seeds'));
    await allReady(page);
    await expect(page.locator('.ak-sh-pause')).toHaveCount(0);
    const before = (await stats(page)).frames;
    await page.waitForTimeout(400);
    expect((await stats(page)).frames).toBe(before);
  });

  test('the pause button stops and restarts the motion', async ({ page }) => {
    await page.goto(pageUrl('shader-3d-controls'));
    await allReady(page);
    const pause = page.locator('.ak-sh-pause');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    const held = (await stats(page)).frames;
    await page.waitForTimeout(400);
    expect((await stats(page)).frames).toBe(held);
    await pause.click();
    await expect.poll(async () => (await stats(page)).frames).toBeGreaterThan(held);
  });

  test('unmounting releases every shader resource and a remount works', async ({ page }) => {
    await page.goto(pageUrl('shader-3d-seeds'));
    await allReady(page);
    expect((await stats(page)).shaderResources).toBe(6);
    await page.evaluate(() => (window as unknown as { akRender3d: Api }).akRender3d.unmountAll());
    expect((await stats(page)).shaderResources).toBe(0);
    await expect(page.locator('.ak-3d-canvas')).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { akRender3d: Api }).akRender3d.mountAll());
    await allReady(page);
    expect((await stats(page)).shaderResources).toBe(6);
  });

  test('without JavaScript the poster, summary and disabled controls carry the page', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pageUrl('shader-3d-controls'));
    await expect(page.locator('.ak-sh-poster')).toBeVisible();
    expect(await page.locator('.ak-sh-poster path').count()).toBeGreaterThan(20);
    await expect(page.locator('[data-ak-sh-param="progress"]')).toBeDisabled();
    await expect(page.locator('.ak-3d-caption')).toContainText('burns away');
    await context.close();
  });

  test('print shows the poster and hides the pause control', async ({ page }) => {
    await page.goto(pageUrl('shader-3d-controls'));
    await allReady(page);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-sh-poster')).toBeVisible();
    await expect(page.locator('.ak-sh-pause')).toBeHidden();
  });

  test('PNG export carries the live frames', async () => {
    const png = await exportPage({
      html: html('shader-3d-presets'),
      format: 'png',
      out: join(workspace.dir(), 'shader.png'),
    });
    expect(png.scenes).toBe(5);
    expect(png.frames).toHaveLength(5);
    expect(png.blockedRequests).toBe(0);
  });
});
