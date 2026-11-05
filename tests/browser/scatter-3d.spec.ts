import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { exportPage } from '../../src/export/page-export.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('scatter');

function html(name: string): string {
  const path = fileURLToPath(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url));
  return compile(readFileSync(path, 'utf8'), { source: name }).html;
}
function pageUrl(name: string): string {
  return `file://${workspace.write(name, html(name))}`;
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
}

/** Stage pixel of a poster circle: the poster and the live plot share the 16:9 camera. */
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

test.describe('scatter-3d', () => {
  test('draws 20,000 points as one WebGL draw with no network', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.goto(pageUrl('scatter-3d-20k'));
    await ready(page);
    await expect(page.locator('.ak-3d-poster')).toBeHidden();
    const stats = await page.evaluate(() =>
      (
        window as unknown as { akRender3d: { stats(): { mounts: number; calls: number } } }
      ).akRender3d.stats(),
    );
    expect(stats.mounts).toBe(1);
    // Points plus six axis walls (grid and border each): a fixed handful, not one per point.
    expect(stats.calls).toBeLessThanOrEqual(8);
    const painted = await page.locator('.ak-3d-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d') as CanvasRenderingContext2D;
      context.drawImage(canvas, 0, 0);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) count += 1;
      return count / (data.length / 4);
    });
    expect(painted).toBeGreaterThan(0.05);
    await expect(page.locator('.ak-sc-labels span').first()).toBeVisible();
    expect(requests).toEqual([]);
  });

  test('a pointer pick and a keyboard pick write state; state selects back', async ({ page }) => {
    await page.goto(pageUrl('scatter-3d-basic'));
    await ready(page);
    const control = page.locator('#city-input, [data-ak-id="city"] select');
    const row = (id: string) => page.locator(`tr[data-ak-sc-point="${id}"]`);
    await expect(row('city-03')).toHaveAttribute('aria-selected', 'true');
    const at = await posterPoint(page, 'circle.s');

    await control.selectOption('city-01');
    await expect(row('city-01')).toHaveAttribute('aria-selected', 'true');
    await expect(row('city-03')).not.toHaveAttribute('aria-selected', 'true');

    await page.mouse.click(at.x, at.y);
    await expect(control).toHaveValue('city-03');
    await expect(row('city-03')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.ak-sc-tip')).toContainText('city-03');
    await expect(page.locator('.ak-sc-tip')).toContainText('Median rent ($/m²)');

    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('n');
    await expect(control).toHaveValue('city-04');
  });

  test('legend and state filter by group; brushing reports a count', async ({ page }) => {
    await page.goto(pageUrl('scatter-3d-20k'));
    await ready(page);
    const control = page.locator('#cluster-input, [data-ak-id="cluster"] select');
    const legacy = page.locator('[data-ak-sc-group="legacy"]');
    const core = page.locator('[data-ak-sc-group="core"]');

    await legacy.click();
    await expect(control).toHaveValue('legacy');
    await expect(core).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.ak-sc-status')).toContainText(
      /[\d,]+ Legacy points shown of 19,9\d\d plotted\./u,
    );

    await control.selectOption('core');
    await expect(core).toHaveAttribute('aria-pressed', 'true');
    await expect(legacy).toHaveAttribute('aria-pressed', 'false');

    await control.selectOption('all');
    await expect(legacy).toHaveAttribute('aria-pressed', 'true');

    const brush = page.locator('.ak-sc-tools button', { hasText: 'Brush' });
    await brush.click();
    await expect(brush).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.ak-3d-stage').scrollIntoViewIfNeeded();
    const box = await page.locator('.ak-3d-stage').boundingBox();
    if (!box) throw new Error('no stage');
    await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.32);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.62, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.ak-sc-status')).toContainText(
      /[\d,]+ of 19,9\d\d visible points brushed/u,
    );
    await page.locator('.ak-3d-canvas').press('Escape');
    await expect(page.locator('.ak-sc-status')).toContainText('of 20,000 points plotted');
  });

  for (const width of [375, 768, 1440]) {
    test(`axis labels never overlap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(pageUrl('scatter-3d-basic'));
      await ready(page);
      await page.waitForTimeout(200);
      const clashes = await page.locator('.ak-sc-labels').evaluate((overlay) => {
        const boxes = [...overlay.querySelectorAll('span')]
          .filter((s) => getComputedStyle(s).visibility !== 'hidden')
          .map((s) => s.getBoundingClientRect());
        let count = 0;
        for (let i = 0; i < boxes.length; i += 1)
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i] as DOMRect;
            const b = boxes[j] as DOMRect;
            if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)
              count += 1;
          }
        return { count, shown: boxes.length };
      });
      expect(clashes.count).toBe(0);
      expect(clashes.shown).toBeGreaterThan(6);
    });
  }

  test('without JavaScript every value is in the table under the poster', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pageUrl('scatter-3d-20k'));
    await expect(page.locator('.ak-3d-poster')).toBeVisible();
    await expect(page.locator('.ak-sc-table tbody tr')).toHaveCount(20000);
    await expect(page.locator('.ak-sc-table tbody tr').last()).toContainText('p20000');
    await expect(page.locator('[data-ak-sc-group]').first()).toBeDisabled();
    await page.emulateMedia({ media: 'print' });
    const overflow = await page
      .locator('.ak-sc-table')
      .evaluate((el) => getComputedStyle(el).overflow);
    expect(overflow).toBe('visible');
    await context.close();
  });

  test.describe('export', () => {
    test.describe.configure({ timeout: 120_000 });
    const outDir = workspace.write('placeholder', '').replace(/[^\\/]+$/u, '');

    test('PNG and PDF carry the live scatter frame', async () => {
      const source = html('scatter-3d-basic');
      const png = join(outDir, 'scatter.png');
      const receipt = await exportPage({ html: source, format: 'png', out: png });
      expect(receipt.scenes).toBe(1);
      expect(receipt.frames).toHaveLength(1);
      expect(receipt.blockedRequests).toBe(0);
      expect(readFileSync(png).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

      const pdf = join(outDir, 'scatter.pdf');
      await exportPage({ html: source, format: 'pdf', out: pdf });
      const bytes = readFileSync(pdf);
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      const frames = [
        ...bytes.toString('latin1').matchAll(/\/Width (\d+)[\s\S]{0,200}?\/Height (\d+)/gu),
      ].filter(
        (m) => Number(m[1]) >= 2000 && Math.abs(Number(m[1]) / Number(m[2]) - 16 / 9) < 0.02,
      );
      expect(frames.length).toBeGreaterThanOrEqual(1);
    });
  });
});
