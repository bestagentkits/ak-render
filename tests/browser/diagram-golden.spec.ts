import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { builtinThemeCatalog } from '../../src/theme/theme-catalog.js';
import { GOLDEN_CASES, type GoldenCase, goldenPage } from '../unit/support/diagram-golden.js';
import { gridDiagramAdapter } from '../unit/support/grid-diagram-adapter.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('diagram-golden');
const adapter = gridDiagramAdapter();
const GEOMETRY = new URL('./diagram-golden.geometry.json', import.meta.url);
const BASELINE = new URL('../../docs/artifacts/diagram-baseline.json', import.meta.url);
const RECORD = process.env.AK_RECORD_DIAGRAM_BASELINE === '1';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
] as const;

function write(golden: GoldenCase, options: Parameters<typeof goldenPage>[1] = {}, suffix = '') {
  const html = compile(goldenPage(golden, options), { diagramAdapter: adapter }).html;
  return workspace.write(`${golden.name}${suffix}`, html);
}

/** Opens a page and records console errors and every request that leaves the file. */
async function open(page: Page, target: string) {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('file:') && !request.url().startsWith('data:')) {
      requests.push(request.url());
    }
  });
  await page.goto(`file://${target}`, { waitUntil: 'load' });
  return { errors, requests };
}

/** Node boxes relative to the drawing, as fractions of its size: independent of fonts and zoom. */
async function nodeBoxes(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-ak-diagram-contract="2"] svg');
    if (!svg) return { overflow: true, boxes: {} as Record<string, number[]> };
    const frame = svg.getBoundingClientRect();
    const boxes: Record<string, number[]> = {};
    let overflow = false;
    for (const node of Array.from(document.querySelectorAll('[data-ak-node]'))) {
      const rect = (node.querySelector('rect') ?? node).getBoundingClientRect();
      const round = (value: number) => Math.round(value * 1000) / 1000;
      boxes[node.getAttribute('data-ak-node') ?? ''] = [
        round((rect.left - frame.left) / frame.width),
        round((rect.top - frame.top) / frame.height),
        round(rect.width / frame.width),
        round(rect.height / frame.height),
      ];
      if (
        rect.left < frame.left - 1 ||
        rect.top < frame.top - 1 ||
        rect.right > frame.right + 1 ||
        rect.bottom > frame.bottom + 1
      ) {
        overflow = true;
      }
    }
    return { overflow, boxes };
  });
}

function overlaps(boxes: Record<string, number[]>): string[] {
  const entries = Object.entries(boxes);
  const hits: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [a, [ax, ay, aw, ah] = []] = entries[i] as [string, number[]];
      const [b, [bx, by, bw, bh] = []] = entries[j] as [string, number[]];
      if (
        (ax as number) < (bx as number) + (bw as number) - 0.001 &&
        (bx as number) < (ax as number) + (aw as number) - 0.001 &&
        (ay as number) < (by as number) + (bh as number) - 0.001 &&
        (by as number) < (ay as number) + (ah as number) - 0.001
      ) {
        hits.push(`${a}/${b}`);
      }
    }
  }
  return hits;
}

const geometry: Record<string, Record<string, number[]>> = existsSync(GEOMETRY)
  ? JSON.parse(readFileSync(GEOMETRY, 'utf8'))
  : {};

test.describe('diagram golden cases', () => {
  for (const golden of GOLDEN_CASES) {
    for (const viewport of VIEWPORTS) {
      test(`${golden.name} at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const { errors, requests } = await open(page, write(golden));
        expect(errors).toEqual([]);
        expect(requests).toEqual([]);
        const pageOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(pageOverflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
        const { overflow, boxes } = await nodeBoxes(page);
        expect(overflow, 'a node falls outside its drawing').toBe(false);
        expect(Object.keys(boxes).sort()).toEqual([...golden.nodes].sort());
        expect(overlaps(boxes)).toEqual([]);
        for (const id of golden.nodes) {
          const name = await page.locator(`[data-ak-node="${id}"]`).getAttribute('aria-label');
          expect(name?.length ?? 0, `node ${id} has no accessible name`).toBeGreaterThan(0);
        }
        // Visual regression on geometry: relative node boxes against the committed baseline.
        if (viewport.name === 'desktop') {
          if (RECORD) geometry[golden.name] = boxes;
          else {
            const expected = geometry[golden.name] ?? {};
            expect(Object.keys(boxes).sort()).toEqual(Object.keys(expected).sort());
            // A small tolerance absorbs sub-pixel rounding between platforms.
            for (const [id, box] of Object.entries(boxes)) {
              for (const [index, value] of box.entries()) {
                const want = expected[id]?.[index] ?? Number.NaN;
                expect(Math.abs(value - want), id).toBeLessThan(0.003);
              }
            }
          }
        }
      });
    }
  }

  test.afterAll(() => {
    if (RECORD) writeFileSync(GEOMETRY, `${JSON.stringify(geometry, null, 2)}\n`);
  });
});

test.describe('diagram golden: print, no script, themes and motion', () => {
  const sample = GOLDEN_CASES.find((golden) => golden.name === 'nested-boundaries') as GoldenCase;

  test('print shows the whole drawing without controls', async ({ page }) => {
    await open(page, write(sample));
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-dv-bar')).toBeHidden();
    const { overflow, boxes } = await nodeBoxes(page);
    expect(overflow).toBe(false);
    expect(Object.keys(boxes)).toHaveLength(sample.nodes.length);
  });

  test('without script every node and the text description read', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`file://${write(sample, {}, '-nojs')}`);
    for (const id of sample.nodes)
      await expect(page.locator(`[data-ak-node="${id}"]`)).toBeVisible();
    await expect(page.locator('.ak-dv-bar')).toBeHidden();
    await expect(page.getByText('Text description')).toBeVisible();
    await context.close();
  });

  for (const preset of Object.keys(builtinThemeCatalog().entries)) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${preset} ${scheme}: nodes stay legible`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        const { errors } = await open(page, write(sample, { preset }, `-${preset}`));
        if (scheme === 'dark') {
          await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        }
        expect(errors).toEqual([]);
        const colours = await page.locator('[data-ak-node="api"]').evaluate((node) => ({
          text: getComputedStyle(node.querySelector('text') as Element).fill,
          box: getComputedStyle(node.querySelector('rect') as Element).fill,
        }));
        expect(colours.text).not.toBe(colours.box);
      });
    }
  }

  for (const [motion, media, policy, plays] of [
    ['edge-trace', 'no-preference', undefined, true],
    ['edge-trace', 'reduce', undefined, false],
    ['edge-trace', 'no-preference', 'none', false],
  ] as const) {
    test(`motion ${policy ?? media}: ${plays ? 'plays once and settles' : 'never plays'}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: media });
      await open(
        page,
        write(sample, { motion, ...(policy ? { policy } : {}) }, `-${media}-${policy}`),
      );
      const figure = page.locator('[data-ak-id="golden"]');
      if (plays) await expect(figure).toHaveAttribute('data-ak-dm-play', 'ambient');
      else await page.waitForTimeout(300);
      await expect(figure).not.toHaveAttribute('data-ak-dm-play', /.*/u, { timeout: 8000 });
      await expect(
        page.locator('[data-ak-dm-on], [data-ak-dm-pulse], [data-ak-dm-len]'),
      ).toHaveCount(0);
      const { overflow } = await nodeBoxes(page);
      expect(overflow).toBe(false);
    });
  }
});

test.describe('diagram baseline', () => {
  test.skip(!RECORD, 'records compile time, DOM size and memory only on request');

  test('records compile time, DOM size and memory', async ({ page }) => {
    const rows = [];
    for (const name of ['chain', 'dense', 'nested-boundaries', 'large']) {
      const golden = GOLDEN_CASES.find((item) => item.name === name) as GoldenCase;
      const spec = goldenPage(golden);
      compile(spec, { diagramAdapter: adapter });
      const times: number[] = [];
      for (let run = 0; run < 7; run += 1) {
        const start = performance.now();
        compile(spec, { diagramAdapter: adapter });
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const html = compile(spec, { diagramAdapter: adapter }).html;
      const target = workspace.write(`baseline-${name}`, html);
      await page.goto(`file://${target}`, { waitUntil: 'load' });
      const client = await page.context().newCDPSession(page);
      await client.send('HeapProfiler.collectGarbage');
      await client.send('Performance.enable');
      const { metrics } = await client.send('Performance.getMetrics');
      const metric = (key: string) => metrics.find((item) => item.name === key)?.value ?? 0;
      rows.push({
        case: name,
        nodes: golden.nodes.length,
        edges: golden.edges.length,
        compileMsMedian: Math.round((times[3] as number) * 100) / 100,
        htmlBytes: Buffer.byteLength(html),
        domElements: await page.evaluate(() => document.getElementsByTagName('*').length),
        diagramElements: await page.evaluate(
          () => document.querySelectorAll('[data-ak-diagram-contract] *').length,
        ),
        jsHeapUsedKb: Math.round(metric('JSHeapUsedSize') / 1024),
      });
    }
    writeFileSync(
      BASELINE,
      `${JSON.stringify(
        {
          note: 'Recorded with AK_RECORD_DIAGRAM_BASELINE=1 on the reference grid adapter. A baseline, not a threshold.',
          rows,
        },
        null,
        2,
      )}\n`,
    );
  });
});
