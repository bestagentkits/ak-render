import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('morph-3d');
const FIXTURE = 'morph-3d-shapes';

function html(): string {
  const file = fileURLToPath(new URL(`../../fixtures/3d/${FIXTURE}.yaml`, import.meta.url));
  return compile(readFileSync(file, 'utf8'), { source: FIXTURE }).html;
}
const pageUrl = (name = FIXTURE, source = html()) => `file://${workspace.write(name, source)}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
}

interface Stats {
  morphResources: number;
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

test.describe('morph-3d', { tag: '@gl' }, () => {
  test('renders a lit morph surface with target buttons and a pause, and no network request', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.goto(pageUrl());
    await ready(page);
    expect(await paintedColors(page)).toBeGreaterThan(50);
    await expect(page.locator('.ak-mo-poster')).toBeHidden();
    await expect(page.locator('[data-ak-morph-target]')).toHaveCount(3);
    await expect(page.locator('[data-ak-morph-target]').first()).toBeEnabled();
    await expect(page.locator('.ak-mo-pause')).toHaveText('Pause');
    expect((await stats(page)).morphResources).toBe(2);
    expect(requests).toEqual([]);
  });

  test('the loop plays on by itself, and Pause stops every frame', async ({ page }) => {
    await page.goto(pageUrl());
    await ready(page);
    const figure = page.locator('[data-ak-3d="morph"]');
    // The loop morphs on to the next target after a hold.
    await expect(figure).toHaveAttribute('data-ak-morph-current', 'cube', {
      timeout: 15_000,
    });
    await page.locator('.ak-mo-pause').click();
    await expect(page.locator('.ak-mo-pause')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.ak-mo-pause')).toHaveText('Play');
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
    await page.locator('.ak-mo-pause').click();
    await expect(page.locator('.ak-mo-pause')).toHaveText('Pause');
    await expect(figure).toHaveAttribute('data-ak-morph-current', 'star', {
      timeout: 15_000,
    });
  });

  test('a once timeline plays with a Pause that freezes the shape mid-morph', async ({ page }) => {
    const source = html().replace(
      '&quot;mode&quot;:&quot;loop&quot;',
      '&quot;mode&quot;:&quot;once&quot;',
    );
    expect(source).toContain('&quot;mode&quot;:&quot;once&quot;');
    await page.goto(pageUrl('morph-3d-once', source));
    await ready(page);
    const figure = page.locator('[data-ak-3d="morph"]');
    await expect(page.locator('.ak-mo-pause')).toHaveText('Pause');
    // On a slow software rasterizer the once timeline can finish before a
    // locator click lands, so press Pause in the page only while it exists.
    const press = () =>
      page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>('.ak-mo-pause');
        if (!button) return false;
        button.focus();
        button.click();
        return true;
      });
    const paused = await press();
    if (paused) {
      await expect(page.locator('.ak-mo-pause')).toHaveText('Play');
      const frames = async () => (await stats(page)).renderMs.length;
      const shot = await page.locator('.ak-3d-canvas').screenshot();
      const a = await frames();
      await page.waitForTimeout(1_000);
      expect((await frames()) - a).toBe(0);
      expect((await page.locator('.ak-3d-canvas').screenshot()).equals(shot)).toBe(true);
      expect(await press()).toBe(true);
    }
    // Played through, the timeline stops on the last target and drops its pause control.
    await expect(figure).toHaveAttribute('data-ak-morph-current', 'star', {
      timeout: 20_000,
    });
    await expect(page.locator('.ak-mo-pause')).toHaveCount(0, {
      timeout: 10_000,
    });
    // Pause had focus from the click; it moves to the canvas, not the page body.
    if (paused)
      expect(
        await page.evaluate(() => document.activeElement?.classList.contains('ak-3d-canvas')),
      ).toBe(true);
  });

  test('buttons, the keyboard and page state choose a target and stay in step', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl());
    await ready(page);
    const figure = page.locator('[data-ak-3d="morph"]');
    const select = page.locator('[data-ak-id="shape-pick"] select');
    // Reduced motion: no loop and so no pause control.
    await expect(page.locator('.ak-mo-pause')).toHaveCount(0);
    const before = await page.locator('.ak-3d-canvas').screenshot();
    await page.locator('[data-ak-morph-target="cube"]').click();
    await expect(select).toHaveValue('cube');
    await expect(figure).toHaveAttribute('data-ak-morph-current', 'cube');
    await expect(page.locator('[data-ak-morph-target="cube"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Reduced motion lands the morph at once, so the next frame shows the cube.
    expect((await page.locator('.ak-3d-canvas').screenshot()).equals(before)).toBe(false);
    await select.selectOption('star');
    await expect(figure).toHaveAttribute('data-ak-morph-current', 'star');
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('n');
    await expect(select).toHaveValue('sphere');
    await page.keyboard.press('p');
    await expect(select).toHaveValue('star');
    // A modified key belongs to the browser.
    await page.keyboard.press('Control+n');
    await expect(select).toHaveValue('star');
  });

  test('100 transitions from rapid choices settle on the last one without leaking', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(pageUrl());
    await ready(page);
    const order = ['cube', 'star', 'sphere'];
    await page.evaluate((ids) => {
      for (let i = 0; i < 100; i += 1)
        (
          document.querySelector(
            `[data-ak-morph-target="${ids[i % ids.length]}"]`,
          ) as HTMLButtonElement
        ).click();
    }, order);
    const last = order[99 % order.length] as string;
    await expect(page.locator('[data-ak-3d="morph"]')).toHaveAttribute(
      'data-ak-morph-current',
      last,
    );
    await expect(page.locator('[data-ak-id="shape-pick"] select')).toHaveValue(last);
    // The choices stopped the loop; once the last morph lands, rendering stops.
    await expect(page.locator('.ak-mo-pause')).toHaveText('Play');
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
    expect((await stats(page)).morphResources).toBe(2);
    expect(errors).toEqual([]);
    await page.evaluate(() =>
      (window as unknown as { akRender3d: { unmountAll(): void } }).akRender3d.unmountAll(),
    );
    expect((await stats(page)).morphResources).toBe(0);
    await expect(page.locator('[data-ak-morph-target]').first()).toBeDisabled();
    await page.evaluate(() =>
      (window as unknown as { akRender3d: { mountAll(): void } }).akRender3d.mountAll(),
    );
    await ready(page);
  });

  test('a tampered page mixing topologies keeps its drawing and reports an error', async ({
    page,
  }) => {
    const source = html().replace(
      '&quot;shape&quot;:&quot;cube&quot;',
      '&quot;shape&quot;:&quot;torus&quot;',
    );
    expect(source).toContain('&quot;shape&quot;:&quot;torus&quot;');
    await page.goto(pageUrl('morph-3d-tampered', source));
    await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'error');
    await expect(page.locator('.ak-mo-poster')).toBeVisible();
    await expect(page.locator('.ak-3d-canvas')).toHaveCount(0);
  });

  test('without JavaScript the drawing and the target list carry the content', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pageUrl());
    await expect(page.locator('.ak-mo-poster')).toBeVisible();
    await expect(page.locator('.ak-mo-targets li')).toHaveCount(3);
    await expect(page.locator('.ak-mo-glyph')).toHaveCount(3);
    await expect(page.locator('[data-ak-morph-target]').first()).toBeDisabled();
    await expect(page.locator('.ak-mo-targets')).toContainText('Burst of activity.');
    await context.close();
  });
});
