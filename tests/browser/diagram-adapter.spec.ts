import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type { DiagramAdapter } from '../../src/diagram/adapter.js';
import { compile } from '../../src/render/render.js';

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-diagram-adapter-'));

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

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

const adapter: DiagramAdapter = { name: 'browser-test', version: '1.0.0', render: () => WIDE_SVG };

/** Compile with the adapter and open the artifact from disk, collecting console errors. */
async function open(page: Page, name: string): Promise<string[]> {
  mkdirSync(workspace, { recursive: true });
  const target = join(workspace, `${name}.html`);
  writeFileSync(target, compile(SPEC, { diagramAdapter: adapter }).html, 'utf8');
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
});
