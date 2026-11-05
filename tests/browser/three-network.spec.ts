import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { exportPage } from '../../src/export/page-export.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('network');
const source = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url)), 'utf8');
const basicHtml = compile(source('network-3d-basic'), { source: 'network-3d-basic' }).html;
const basic = `file://${workspace.write('network-3d-basic', basicHtml)}`;
const stress = () =>
  `file://${workspace.write(
    'network-3d-stress',
    compile(source('network-3d-stress'), { source: 'network-3d-stress' }).html,
  )}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-ak-3d="network"]')).toHaveAttribute('data-ak-3d-state', 'ready');
}

/** Rows of the detail table that the filter-bar leaves visible. */
async function visibleServices(page: Page): Promise<string[]> {
  return page
    .locator('[data-ak-id="services-table"] tbody tr')
    .evaluateAll((rows) =>
      rows
        .filter((row) => (row as HTMLElement).offsetParent !== null)
        .map((row) => (row as HTMLTableRowElement).cells[0]?.textContent?.trim() ?? ''),
    );
}

test.describe('network-3d', { tag: '@gl' }, () => {
  test('renders a live WebGL frame with nodes and links, offline', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.goto(basic);
    await ready(page);
    const painted = await page.locator('.ak-3d-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d') as CanvasRenderingContext2D;
      context.drawImage(canvas, 0, 0);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      let lit = 0;
      for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) lit += 1;
      return lit / (data.length / 4);
    });
    expect(painted).toBeGreaterThan(0.01);
    await expect(page.locator('.ak-net-poster')).toBeHidden();
    expect(requests).toEqual([]);
  });

  test('picking a node writes state, and the state filters the HTML table', async ({ page }) => {
    await page.goto(basic);
    await ready(page);
    // The initial state selects the gateway, so the detail table shows only it.
    await expect.poll(() => visibleServices(page)).toEqual(['API gateway']);
    await page.locator('[data-ak-3d-pick="payments"]').click();
    await expect(page.locator('[data-ak-3d-pick="payments"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(() => visibleServices(page)).toEqual(['Payments']);
    // And back: a control writing the same state selects the node in the graph.
    await page.locator('[data-ak-id="services-table"]').scrollIntoViewIfNeeded();
    await page.locator('select').first().selectOption('ledger');
    await expect(page.locator('[data-ak-3d="network"]')).toHaveAttribute(
      'data-ak-net-selected',
      'ledger',
    );
  });

  test('a selection lights its neighbours and dims the rest', async ({ page }) => {
    await page.goto(basic);
    await ready(page);
    await page.locator('[data-ak-3d-pick="orders"]').click();
    const near = await page
      .locator('[data-ak-net-row][data-ak-net-near]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-ak-net-row')).sort());
    expect(near).toEqual(['cart', 'events', 'gateway', 'payments', 'pg']);
    await expect(page.locator('.ak-net-tag')).toBeVisible();
    await expect(page.locator('.ak-net-tag')).toContainText('Orders');
  });

  test('Escape and an empty state clear the selection', async ({ page }) => {
    await page.goto(basic);
    await ready(page);
    const net = page.locator('[data-ak-3d="network"]');
    await expect(net).toHaveAttribute('data-ak-net-selected', 'gateway');
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('Escape');
    await expect(net).toHaveAttribute('data-ak-net-selected', '');
    await expect(page.locator('[data-ak-net-row][data-ak-net-near]')).toHaveCount(0);
    await page.locator('[data-ak-3d-pick="cart"]').click();
    await expect(net).toHaveAttribute('data-ak-net-selected', 'cart');
    await page.locator('[data-ak-3d-pick="cart"]').click();
    await expect(net).toHaveAttribute('data-ak-net-selected', '');
  });

  test('a pointer pick on the canvas selects the node under it', async ({ page }) => {
    await page.goto(basic);
    await ready(page);
    await page.locator('[data-ak-3d="network"]').scrollIntoViewIfNeeded();
    // The static plan projects through the runtime camera, so its dot marks where the node is drawn.
    const dot = await page.evaluate(() => {
      const svg = document.querySelector('.ak-net-poster') as SVGSVGElement;
      const stage = (svg.parentElement as HTMLElement).getBoundingClientRect();
      const circles = [...svg.querySelectorAll('circle')];
      const big = circles.sort(
        (a, b) => Number(b.getAttribute('r')) - Number(a.getAttribute('r')),
      )[1] as SVGCircleElement;
      const scale = Math.min(stage.width / 640, stage.height / 360);
      const offsetX = (stage.width - 640 * scale) / 2;
      const offsetY = (stage.height - 360 * scale) / 2;
      return {
        x: stage.left + offsetX + Number(big.getAttribute('cx')) * scale,
        y: stage.top + offsetY + Number(big.getAttribute('cy')) * scale,
      };
    });
    await page.mouse.click(dot.x, dot.y);
    await expect(page.locator('[data-ak-3d="network"]')).not.toHaveAttribute(
      'data-ak-net-selected',
      'gateway',
    );
  });

  test('the group filter reads state and hides other groups', async ({ page }) => {
    await page.goto(basic);
    await ready(page);
    await page.locator('[data-ak-net-filter="data"]').click();
    await expect(page.locator('[data-ak-net-filter="data"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-ak-net-row]:not([data-ak-net-out])')).toHaveCount(4);
    await page.locator('[data-ak-net-filter=""]').click();
    await expect(page.locator('[data-ak-net-row]:not([data-ak-net-out])')).toHaveCount(18);
  });

  test('keyboard walks nodes and Escape flies home', async ({ page }) => {
    await page.goto(basic);
    await ready(page);
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('n');
    await expect(page.locator('[data-ak-3d="network"]')).toHaveAttribute(
      'data-ak-net-selected',
      'cdn',
    );
    await page.keyboard.press('Escape');
  });

  test('without JavaScript the plan and the node and link table carry the graph', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(basic);
    await expect(page.locator('.ak-net-poster')).toBeVisible();
    await expect(page.locator('.ak-net-poster circle')).toHaveCount(18);
    await expect(page.locator('.ak-net-table caption')).toHaveText('18 nodes, 29 links');
    const orders = page.locator('[data-ak-net-row="orders"]');
    await expect(orders).toContainText('Cart, Payments, Postgres, Event bus');
    await expect(orders).toContainText('API gateway');
    await context.close();
  });

  test('print shows the plan and the full table', async ({ page }) => {
    await page.goto(basic);
    await ready(page);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-net-poster')).toBeVisible();
    const overflow = await page
      .locator('.ak-net-table')
      .evaluate((el) => getComputedStyle(el).maxHeight);
    expect(overflow).toBe('none');
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`eight groups get clearly distinct colors (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(stress());
      const rgb = await page.locator('.ak-net-legend .ak-net-swatch').evaluateAll((swatches) => {
        const context = document
          .createElement('canvas')
          .getContext('2d') as CanvasRenderingContext2D;
        return swatches.map((swatch) => {
          context.fillStyle = getComputedStyle(swatch).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        });
      });
      const oklab = ([r, g, b]: number[]) => {
        const lin = (byte = 0) => {
          const v = byte / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        const [R, G, B] = [lin(r), lin(g), lin(b)];
        const l = Math.cbrt(0.4122 * R + 0.5363 * G + 0.0514 * B);
        const m = Math.cbrt(0.2119 * R + 0.6807 * G + 0.1074 * B);
        const s = Math.cbrt(0.0883 * R + 0.2817 * G + 0.63 * B);
        return [
          0.2105 * l + 0.7936 * m - 0.0041 * s,
          1.978 * l - 2.4286 * m + 0.4506 * s,
          0.0259 * l + 0.7828 * m - 0.8087 * s,
        ];
      };
      const labs = rgb.map(oklab);
      expect(labs).toHaveLength(8);
      let closest = Infinity;
      for (let i = 0; i < labs.length; i += 1)
        for (let j = i + 1; j < labs.length; j += 1)
          closest = Math.min(
            closest,
            Math.hypot(...(labs[i] as number[]).map((v, k) => v - ((labs[j] as number[])[k] ?? 0))),
          );
      // OKLab ΔE 0.07 is several just-noticeable steps apart, even in muted themes.
      expect(closest).toBeGreaterThanOrEqual(0.07);
    });
  }

  test('the 1000-node stress graph mounts in a handful of draw calls', async ({ page }) => {
    await page.goto(stress());
    await ready(page);
    const stats = await page.evaluate(() =>
      (window as unknown as { akRender3d: { stats(): { calls: number } } }).akRender3d.stats(),
    );
    expect(stats.calls).toBeLessThanOrEqual(6);
    await page.locator('[data-ak-3d-pick="n500"]').click();
    await expect(page.locator('[data-ak-3d="network"]')).toHaveAttribute(
      'data-ak-net-selected',
      'n500',
    );
  });
});

test.describe('network-3d export', { tag: '@gl' }, () => {
  test.describe.configure({ timeout: 90_000 });
  const outDir = workspace.write('placeholder', '').replace(/[^\\/]+$/u, '');

  test('PNG and PDF carry the live network frame', async () => {
    const png = await exportPage({ html: basicHtml, format: 'png', out: join(outDir, 'net.png') });
    expect(png.scenes).toBe(1);
    expect(png.frames).toHaveLength(1);
    expect(png.blockedRequests).toBe(0);
    const pngBytes = readFileSync(join(outDir, 'net.png'));
    expect(pngBytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const pdf = await exportPage({ html: basicHtml, format: 'pdf', out: join(outDir, 'net.pdf') });
    expect(pdf.frames).toHaveLength(1);
    expect(readFileSync(join(outDir, 'net.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
