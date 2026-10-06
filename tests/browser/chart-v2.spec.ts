import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { CHART_KINDS } from '../../src/blocks/chart/chart-kinds.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('chart-v2');
const fixture = readFileSync(
  fileURLToPath(new URL('../../fixtures/pages/charts-v2.yaml', import.meta.url)),
  'utf8',
);

/** A legend with many long series names, which must wrap rather than widen the page. */
const LONG_LEGEND = `version: 1
meta: { title: Legend wrap }
blocks:
  - type: chart
    kind: stacked-bar
    title: Many series
    labels: [Q1, Q2]
    series:
${Array.from(
  { length: 6 },
  (_, index) =>
    `      - { label: "Series with a deliberately long descriptive name ${index}", values: [${index + 1}, ${index + 2}] }`,
).join('\n')}
`;

async function open(page: Page, name: string, source: string, width: number): Promise<void> {
  const target = workspace.write(name, compile(source).html);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`file://${target}`, { waitUntil: 'load' });
}

test('every chart kind fits a 320px viewport without page overflow', async ({ page }) => {
  await open(page, 'charts-v2', fixture, 320);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  const kinds = await page.$$eval('figure.ak-chart', (figures) =>
    figures.map((figure) => figure.getAttribute('data-ak-kind')),
  );
  const v2Kinds = CHART_KINDS.filter(
    (kind) => !['line', 'area', 'pie', 'donut', 'sparkline', 'progress'].includes(kind),
  );
  for (const kind of v2Kinds) expect(kinds).toContain(kind);
  // Each figure stays inside the viewport; wide plots scroll inside their canvas.
  const widest = await page.$$eval('figure.ak-chart', (figures) =>
    Math.max(...figures.map((figure) => figure.getBoundingClientRect().right)),
  );
  expect(widest).toBeLessThanOrEqual(320);
});

test('a long legend wraps inside its figure', async ({ page }) => {
  await open(page, 'legend-wrap', LONG_LEGEND, 320);
  const layout = await page.$eval('.ak-chart-legend', (legend) => {
    const box = legend.getBoundingClientRect();
    const items = [...legend.querySelectorAll('li')].map((item) => item.getBoundingClientRect());
    return {
      right: box.right,
      figureRight: (legend.closest('figure') as HTMLElement).getBoundingClientRect().right,
      rows: new Set(items.map((item) => Math.round(item.top))).size,
    };
  });
  expect(layout.right).toBeLessThanOrEqual(layout.figureRight);
  expect(layout.rows).toBeGreaterThan(1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
