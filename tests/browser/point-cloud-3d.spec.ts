import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { createPointCloudResolver } from '../../src/assets/point-cloud-assets.js';
import { exportPage } from '../../src/export/page-export.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('point-cloud');
const fixtureDir = fileURLToPath(new URL('../../fixtures/3d/', import.meta.url));

function html(name: string): string {
  return compile(readFileSync(join(fixtureDir, `${name}.yaml`), 'utf8'), {
    source: name,
    pointCloudResolver: createPointCloudResolver(fixtureDir),
  }).html;
}
function pageUrl(name: string): string {
  return `file://${workspace.write(name, html(name))}`;
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
}

/** Stage pixel of a poster circle: the poster and the live view share the 16:9 camera. */
async function posterPoint(page: Page, selector: string) {
  return page.locator('.ak-3d-stage').evaluate((stage, css) => {
    const circle = stage.querySelector(css) as SVGCircleElement;
    const rect = stage.getBoundingClientRect();
    const scale = rect.width / 640;
    const top = (rect.height - 360 * scale) / 2;
    return {
      x: rect.left + Number(circle.getAttribute('cx')) * scale,
      y: rect.top + top + Number(circle.getAttribute('cy')) * scale,
    };
  }, selector);
}

const selectedId = (page: Page) => page.locator('.ak-pc-pick dd').first();

test.describe('point-cloud-3d', { tag: '@gl' }, () => {
  test('draws a bounded share of 100,000 points in one call and says how many', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.goto(pageUrl('point-cloud-3d-100k'));
    await ready(page);
    await expect(page.locator('.ak-3d-poster')).toBeHidden();
    const stats = await page.evaluate(() =>
      (
        window as unknown as { akRender3d: { stats(): { mounts: number; calls: number } } }
      ).akRender3d.stats(),
    );
    expect(stats.mounts).toBe(1);
    // The cloud, the floor grid, the box, the eye-dome pass and the selection marker: never one per point.
    expect(stats.calls).toBeLessThanOrEqual(5);
    // 60,000 is the spec's budget; a low quality profile draws at most 50,000.
    await expect(page.locator('.ak-pc-status')).toHaveText(
      /^Drawing an even (60,000|50,000) of the 99,071 points in the clip box \(level of detail( for this device)?\); 929 outside the box are hidden\.$/u,
    );
    // The selection from state is kept, with the exact coordinates and units.
    await expect(selectedId(page)).toHaveText('p99999');
    await expect(page.locator('.ak-pc-pick')).toContainText('Elevation (m)');
    expect(requests).toEqual([]);
  });

  test('a pick writes the point and its values; keys step and the cut hides', async ({ page }) => {
    await page.goto(pageUrl('point-cloud-3d-basic'));
    await ready(page);
    await expect(selectedId(page)).toHaveText('p420');
    await page.locator('.ak-3d-stage').scrollIntoViewIfNeeded();
    const at = await posterPoint(page, '.ak-pc-dots circle:last-child');
    await page.mouse.click(at.x, at.y);
    await expect(selectedId(page)).not.toHaveText('p420');
    const picked = (await selectedId(page).textContent()) ?? '';
    expect(picked).toMatch(/^p\d+$/u);
    await expect(page.locator('.ak-pc-pick')).toContainText('Height (m)');

    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('n');
    await expect(selectedId(page)).not.toHaveText(picked);
    const stepped = (await selectedId(page).textContent()) ?? '';
    await page.keyboard.press('Shift+N');
    await expect(selectedId(page)).not.toHaveText(stepped);

    const cut = page.locator('.ak-pc-tools input[type="range"]');
    await cut.evaluate((input: HTMLInputElement) => {
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('.ak-pc-status')).toContainText(/the section hides \d+ above/u);
    await page.locator('.ak-pc-tools button', { hasText: 'Reset view' }).click();
    await expect(page.locator('.ak-pc-status')).not.toContainText('section');
  });

  test('a click picks the front surface, never a point hidden behind it', async ({ page }) => {
    // Two 20 x 20 layers, 5 m apart: seen from above, the top layer hides the lower one.
    const x: number[] = [];
    const y: number[] = [];
    const z: number[] = [];
    const id: string[] = [];
    for (const [layer, height] of [
      ['low', 0],
      ['top', 5],
    ] as const)
      for (let i = 0; i <= 20; i += 1)
        for (let j = 0; j <= 20; j += 1) {
          x.push(i);
          y.push(j);
          z.push(height);
          id.push(`${layer}-${i}-${j}`);
        }
    const spec = {
      version: 1,
      meta: { title: 'Layers' },
      blocks: [
        { type: 'point-cloud-3d', id: 'layers', summary: 'Two layers.', data: { x, y, z, id } },
      ],
    };
    await page.goto(
      `file://${workspace.write('point-cloud-layers', compile(spec, { source: 'layers' }).html)}`,
    );
    await ready(page);
    const stage = page.locator('.ak-3d-stage');
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    if (!box) throw new Error('the stage has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(selectedId(page)).toHaveText(/^top-/u);
  });

  test('unmounting frees the scene and restores the static status', async ({ page }) => {
    await page.goto(pageUrl('point-cloud-3d-basic'));
    await ready(page);
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('n');
    await expect(selectedId(page)).not.toHaveText('p420');
    const after = await page.evaluate(() => {
      const api = (
        window as unknown as { akRender3d: { unmountAll(): void; stats(): { mounts: number } } }
      ).akRender3d;
      api.unmountAll();
      return api.stats().mounts;
    });
    expect(after).toBe(0);
    await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'static');
    await expect(page.locator('.ak-pc-status')).toHaveText(
      '900 points; 114 outside the clip box are hidden.',
    );
    await expect(page.locator('.ak-pc-tools')).toHaveCount(0);
    // The compiled selection comes back with the static page.
    await expect(selectedId(page)).toHaveText('p420');
    await expect(page.locator('.ak-pc-table tr[aria-selected="true"]')).toHaveCount(1);
  });

  test('without JavaScript the sample, statistics and table read in print', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pageUrl('point-cloud-3d-100k'));
    await expect(page.locator('.ak-3d-poster')).toBeVisible();
    await expect(page.locator('.ak-pc-status')).toContainText('an even sample of 5,000');
    await expect(page.locator('.ak-pc-stats tbody tr')).toHaveCount(4);
    await expect(page.locator('.ak-pc-table tbody tr')).toHaveCount(101);
    await expect(page.locator('.ak-pc-table tbody tr').last()).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.emulateMedia({ media: 'print' });
    const overflow = await page
      .locator('.ak-pc-table')
      .evaluate((el) => getComputedStyle(el).overflow);
    expect(overflow).toBe('visible');
    await context.close();
  });

  test('PNG export carries the live frame', async () => {
    const outDir = workspace.dir();
    const png = join(outDir, 'point-cloud.png');
    const receipt = await exportPage({
      html: html('point-cloud-3d-basic'),
      format: 'png',
      out: png,
    });
    expect(receipt.scenes).toBe(1);
    expect(receipt.frames).toHaveLength(1);
    expect(receipt.blockedRequests).toBe(0);
    expect(readFileSync(png).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
