import { expect, type Page, test } from '@playwright/test';
import type { DiagramAdapter } from '../../src/diagram/adapter.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('diagram-adapter');

const SPEC = `version: 1
meta: { title: Adapter diagram }
blocks:
  - type: diagram-panel
    title: Architecture
    spec:
      components:
        - { id: a, label: Alpha }
        - { id: b, label: Beta }
      connections:
        - { from: a, to: b, label: calls }
`;

/** A wide diagram styled the way a typed diagram compiler styles its output. */
const WIDE_SVG = `<svg class="ak-diagram-svg" xmlns="http://www.w3.org/2000/svg" width="2000" height="240" viewBox="0 0 2000 240" role="img" aria-label="Wide pipeline"><style>.ak-diagram-svg .n{fill:#fff;stroke:#333}</style>${Array.from(
  { length: 10 },
  (_, index) =>
    `<rect class="n" x="${index * 200 + 10}" y="80" width="180" height="80" style="--step:${index}"/><text x="${index * 200 + 30}" y="125" font-size="16">Stage ${index}</text>`,
).join('')}</svg>`;

/**
 * A drawing whose stylesheet reaches for the whole page. Scoping must keep every
 * page-wide rule inside the diagram while the diagram's own rules still apply.
 */
const GREEDY_SVG = `<svg class="ak-diagram-svg" xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><style>.ak-shell{display:none}:root{background:red}html,body{background:red;color:red}.ak-diagram-details{display:none}:scope{position:fixed;inset:0;z-index:99}.n{fill:#fff;animation:pulse 2s linear infinite}@keyframes pulse{from{stroke-width:1}to{stroke-width:3}}</style><rect class="n" x="10" y="10" width="80" height="80"/></svg>`;

/** Compile with an adapter and open the artifact from disk, collecting console errors. */
async function open(page: Page, name: string, svg = WIDE_SVG): Promise<string[]> {
  const adapter: DiagramAdapter = { name: 'browser-test', version: '1.0.0', render: () => svg };
  const target = workspace.write(name, compile(SPEC, { diagramAdapter: adapter }).html);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`file://${target}`, { waitUntil: 'load' });
  return errors;
}

test.describe('diagram adapter output in the browser', () => {
  test('adapter styles apply under the page policy, without violations', async ({ page }) => {
    const errors = await open(page, 'styled');
    const fill = await page
      .locator('.ak-diagram-rendered rect')
      .first()
      .evaluate((rect) => getComputedStyle(rect).fill);
    // The default SVG fill is black; the adapter's stylesheet makes it white.
    expect(fill).toBe('rgb(255, 255, 255)');
    expect(errors).toEqual([]);
  });

  for (const width of [1440, 768, 375]) {
    test(`a wide diagram keeps its size and scrolls inside the panel at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 812 });
      await open(page, `wide-${width}`);
      const svgWidth = await page
        .locator('.ak-diagram-rendered svg')
        .evaluate((svg) => svg.getBoundingClientRect().width);
      expect(svgWidth).toBe(2000);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBe(0);
    });
  }

  test('the scroller is a named region that scrolls from the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, 'keyboard');
    const region = page.getByRole('region', { name: 'Architecture' });
    await expect(region).toHaveAttribute('tabindex', '0');
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  });

  test('edge shades follow the scroll position', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, 'edges');
    const region = page.locator('.ak-diagram-rendered');
    const sizes = () =>
      region.evaluate((element) => getComputedStyle(element).backgroundSize.split(','));
    // At the start only the trailing edge is shaded.
    expect((await sizes()).slice(0, 2).map((size) => size.trim())).toEqual([
      '0px 100%',
      '14px 100%',
    ]);
    await region.evaluate((element) => {
      element.scrollLeft = element.scrollWidth / 2;
    });
    await expect
      .poll(async () => (await sizes()).slice(0, 2).map((size) => size.trim()))
      .toEqual(['14px 100%', '14px 100%']);
  });

  test('adapter styles cannot reach outside their own diagram', async ({ page }) => {
    const errors = await open(page, 'greedy', GREEDY_SVG);
    await expect(page.locator('.ak-shell')).toBeVisible();
    await expect(page.locator('details[data-ak-diagram-fallback]')).toBeVisible();
    const colors = await page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).color,
    }));
    expect(colors.root).not.toBe('rgb(255, 0, 0)');
    expect(colors.body).not.toBe('rgb(255, 0, 0)');
    // The diagram's own rules, keyframes included, still apply.
    const rect = page.locator('.ak-diagram-canvas rect');
    expect(await rect.evaluate((node) => getComputedStyle(node).fill)).toBe('rgb(255, 255, 255)');
    expect(await rect.evaluate((node) => getComputedStyle(node).animationName)).toBe('pulse');
    // A fixed-position canvas stays inside its panel instead of covering the page.
    const boxes = await page.evaluate(() => {
      const panel = document.querySelector('.ak-diagram-rendered')?.getBoundingClientRect();
      const canvas = document.querySelector('.ak-diagram-canvas')?.getBoundingClientRect();
      return { panel, canvas, viewport: window.innerWidth };
    });
    expect(boxes.canvas?.width).toBeLessThanOrEqual(boxes.panel?.width ?? 0);
    expect(boxes.canvas?.top).toBeGreaterThanOrEqual(boxes.panel?.top ?? 0);
    expect(errors).toEqual([]);
  });

  test('adapter motion stops under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'greedy-reduced', GREEDY_SVG);
    const rect = page.locator('.ak-diagram-canvas rect');
    expect(await rect.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  });

  test('the text description prints even though it is folded on screen', async ({ page }) => {
    await open(page, 'print');
    await expect(page.locator('.ak-diagram-fallback')).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-diagram-fallback')).toBeVisible();
    await expect(page.locator('.ak-diagram-fallback')).toContainText('Alpha');
  });

  test('the text description prints without script', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await open(page, 'print-no-script');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-diagram-fallback')).toBeVisible();
    await context.close();
  });

  test('the runtime opens the description for a print and folds it again after', async ({
    page,
  }) => {
    await open(page, 'print-runtime');
    const details = page.locator('details[data-ak-diagram-fallback]');
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect(details).toHaveAttribute('open', '');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(details).not.toHaveAttribute('open', '');
  });

  test('the text description folds away behind a disclosure', async ({ page }) => {
    await open(page, 'fallback');
    const details = page.locator('details[data-ak-diagram-fallback]');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(page.locator('.ak-diagram-fallback')).toBeHidden();
    await details.locator('summary').click();
    await expect(page.locator('.ak-diagram-fallback')).toBeVisible();
    await expect(page.locator('.ak-diagram-fallback')).toContainText('Alpha');
  });
});
