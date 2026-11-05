import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const fixture = fileURLToPath(new URL('../../fixtures/3d/scene-3d-basic.yaml', import.meta.url));
const workspace = browserWorkspace('three');

function scenePage(): string {
  const html = compile(readFileSync(fixture, 'utf8'), { source: 'scene-3d-basic' }).html;
  return `file://${workspace.write('scene-3d-basic', html)}`;
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
}

/** Distinct colors and non-background pixels read back from the live WebGL canvas. */
async function canvasPixels(page: Page) {
  return page.locator('.ak-3d-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d') as CanvasRenderingContext2D;
    context.drawImage(canvas, 0, 0);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    const colors = new Set<number>();
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
      if (a > 0) painted += 1;
      colors.add((r << 16) | (g << 8) | b);
    }
    const gl = canvas.getContext('webgl2');
    return {
      painted: painted / (data.length / 4),
      colors: colors.size,
      webgl2: gl !== null,
      renderer: gl ? String(gl.getParameter(gl.RENDERER)) : '',
    };
  });
}

test.describe('scene-3d', () => {
  test('renders a real WebGL 2 frame, not the poster', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.goto(scenePage());
    await ready(page);
    const pixels = await canvasPixels(page);
    expect(pixels.webgl2).toBe(true);
    expect(pixels.painted).toBeGreaterThan(0.02);
    expect(pixels.colors).toBeGreaterThan(20);
    await expect(page.locator('.ak-3d-poster')).toBeHidden();
    expect(requests).toEqual([]);
    test.info().annotations.push({ type: 'gpu', description: pixels.renderer });
  });

  test('selection flows scene -> state -> control and back', async ({ page }) => {
    await page.goto(scenePage());
    await ready(page);
    const pick = page.locator('#pick-input, [data-ak-id="pick"] select');
    await expect(page.locator('[data-ak-3d-pick="core"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-ak-3d-pick="edge-b"]').click();
    await expect(pick).toHaveValue('edge-b');

    await pick.selectOption('edge-c');
    await expect(page.locator('[data-ak-3d-pick="edge-c"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-ak-3d-pick="edge-b"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Keyboard on the canvas cycles selection through the same path.
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('n');
    await expect(pick).not.toHaveValue('edge-c');
  });

  test('pointer pick on the canvas selects the object under it', async ({ page }) => {
    await page.goto(scenePage());
    await ready(page);
    // The static plan projects through the same camera, so its mark sits where the live mesh is.
    await page.locator('[data-ak-3d-pick="edge-a"]').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const mark = await page
      .locator('.ak-3d-mark', { hasText: 'Core router' })
      .locator(':first-child')
      .boundingBox();
    const box = await page.locator('.ak-3d-canvas').boundingBox();
    if (mark === null || box === null) throw new Error('no mark');
    await page.locator('.ak-3d-canvas').click({
      position: { x: mark.x + mark.width / 2 - box.x, y: mark.y + mark.height / 2 - box.y },
    });
    await expect(page.locator('[data-ak-3d-pick="core"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('ten mount/unmount cycles leave no geometry or mount behind', async ({ page }) => {
    await page.goto(scenePage());
    await ready(page);
    const result = await page.evaluate(() => {
      const api = (
        window as unknown as {
          akRender3d: Record<'stats' | 'unmountAll' | 'mountAll', () => unknown>;
        }
      ).akRender3d;
      const count = () => {
        const { mounts, geometries } = api.stats() as { mounts: number; geometries: number };
        return { mounts, geometries };
      };
      const warm = count();
      for (let i = 0; i < 10; i += 1) {
        api.unmountAll();
        api.mountAll();
      }
      const after = count();
      api.unmountAll();
      return { warm, after, empty: count(), canvases: document.querySelectorAll('canvas').length };
    });
    expect(result.after).toEqual(result.warm);
    expect(result.empty).toEqual({ mounts: 0, geometries: 0 });
    expect(result.canvases).toBe(0);
  });

  test('without JavaScript the plan and object list carry the content', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(scenePage());
    await expect(page.locator('.ak-3d-poster')).toBeVisible();
    await expect(page.locator('.ak-3d-poster text')).toHaveCount(5);
    await expect(page.locator('.ak-3d-objects')).toContainText('Core router');
    await expect(page.locator('.ak-3d-caption')).toContainText('core router linked');
    await context.close();
  });

  test('reduced motion renders a still frame with no running loop', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(scenePage());
    await ready(page);
    const first = await page.locator('.ak-3d-canvas').screenshot();
    await page.waitForTimeout(400);
    const second = await page.locator('.ak-3d-canvas').screenshot();
    expect(first.equals(second)).toBe(true);
    await context.close();
  });

  test('print shows the static plan', async ({ page }) => {
    await page.goto(scenePage());
    await ready(page);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-3d-poster')).toBeVisible();
    await expect(page.locator('.ak-3d-canvas')).toBeHidden();
  });

  test('works at phone width with touch', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto(scenePage());
    await ready(page);
    await page.locator('[data-ak-3d-pick="edge-a"]').tap();
    await expect(page.locator('[data-ak-3d-pick="edge-a"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await context.close();
  });
});
