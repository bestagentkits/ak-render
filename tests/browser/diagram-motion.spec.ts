import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { gridDiagramAdapter } from '../unit/support/grid-diagram-adapter.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('diagram-motion');

function panel(id: string, motion: string): string {
  return `  - type: diagram-panel
    id: ${id}
    title: ${id}
    spec:
      components: [{ id: client, label: Client }, { id: api, label: API }, { id: db, label: Database }]
      connections: [{ from: client, to: api, label: HTTPS }, { from: api, to: db, label: SQL }]
    motion: ${motion}
`;
}

function spec(...blocks: string[]): string {
  return `version: 1\nmeta: { title: Diagram motion }\nblocks:\n${blocks.join('')}`;
}

async function open(page: Page, source: string, name: string): Promise<string[]> {
  const target = workspace.write(
    name,
    compile(source, { diagramAdapter: gridDiagramAdapter() }).html,
  );
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${target}`, { waitUntil: 'load' });
  return errors;
}

const node = (page: Page, panelId: string, id: string) =>
  page.locator(`[data-ak-id="${panelId}"] [data-ak-node="${id}"]`);

test.describe('diagram motion governor', () => {
  test('edge-trace plays once on arrival and ends with the drawing as authored', async ({
    page,
  }) => {
    const errors = await open(page, spec(panel('one', 'edge-trace')), 'edge-trace');
    const figure = page.locator('[data-ak-id="one"]');
    await expect(figure).toHaveAttribute('data-ak-dm-play', 'ambient');
    await expect(page.locator('[data-ak-id="one"] [data-ak-dm-on]')).toHaveCount(2);
    await expect(figure).not.toHaveAttribute('data-ak-dm-play', /.*/u, { timeout: 8000 });
    await expect(
      page.locator('[data-ak-id="one"] [data-ak-dm-on], #one [data-ak-dm-len]'),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('only one diagram plays at a time; the next waits its turn', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 2400 });
    await open(page, spec(panel('one', 'edge-trace'), panel('two', 'node-activation')), 'two');
    await expect(page.locator('[data-ak-dm-play]')).toHaveCount(1);
    await expect(page.locator('[data-ak-id="one"]')).toHaveAttribute('data-ak-dm-play', 'ambient');
    await expect(page.locator('[data-ak-id="two"]')).toHaveAttribute('data-ak-dm-play', 'ambient', {
      timeout: 8000,
    });
    await expect(page.locator('[data-ak-id="one"]')).not.toHaveAttribute('data-ak-dm-play', /.*/u);
  });

  test('a selection pre-empts ambient playback and plays its own neighbourhood', async ({
    page,
  }) => {
    await open(page, spec(panel('one', 'node-activation')), 'focused');
    await expect(page.locator('[data-ak-id="one"]')).toHaveAttribute('data-ak-dm-play', 'ambient');
    await node(page, 'one', 'api').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-ak-id="one"]')).toHaveAttribute('data-ak-dm-play', 'focused');
    await expect(page.locator('[data-ak-id="one"] [data-ak-node][data-ak-dm-on]')).toHaveCount(3);
  });

  test('signal-relay rides on temporary copies and never edits the line', async ({ page }) => {
    await open(page, spec(panel('one', 'signal-relay')), 'relay');
    await expect(page.locator('[data-ak-id="one"] [data-ak-dm-pulse]')).toHaveCount(2);
    await expect(
      page.locator('[data-ak-id="one"] [data-ak-edge] path:not([data-ak-dm-pulse])[pathLength]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-ak-id="one"] [data-ak-dm-pulse]')).toHaveCount(0, {
      timeout: 8000,
    });
  });

  test('nothing plays under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, spec(panel('one', 'edge-trace')), 'reduced');
    await page.waitForTimeout(300);
    await expect(
      page.locator('[data-ak-dm-play], [data-ak-dm-on], [data-ak-dm-pulse]'),
    ).toHaveCount(0);
  });

  test('nothing plays under the none motion policy', async ({ page }) => {
    const source = spec(panel('one', 'edge-trace')).replace(
      'meta: { title: Diagram motion }',
      "meta: { title: Diagram motion }\ntheme: { preset: editorial, tokens: { 'motion-policy': none } }",
    );
    await open(page, source, 'policy-none');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-ak-dm-play]')).toHaveCount(0);
  });

  test('a theme switch stops a run at once', async ({ page }) => {
    await open(page, spec(panel('one', 'edge-trace')), 'theme');
    await expect(page.locator('[data-ak-id="one"]')).toHaveAttribute('data-ak-dm-play', 'ambient');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await expect(page.locator('[data-ak-dm-play], [data-ak-dm-on]')).toHaveCount(0);
  });

  test('sequence playback never starts itself, and steps name each relationship', async ({
    page,
  }) => {
    await open(page, spec(panel('one', 'sequence-playback')), 'sequence');
    const bar = page.locator('[data-ak-id="one"] .ak-dm-bar');
    await expect(bar).toBeVisible();
    await page.waitForTimeout(300);
    await expect(
      page.locator('[data-ak-id="one"] [data-ak-diagram-contract] [data-ak-dm-step]'),
    ).toHaveCount(0);
    await bar.locator('[data-ak-dm-next]').click();
    await expect(bar.locator('[data-ak-dm-status]')).toHaveText('Step 1 of 2: Client → API, HTTPS');
    await expect(
      page.locator('[data-ak-id="one"] [data-ak-diagram-contract] [data-ak-dm-step]'),
    ).toHaveCount(3);
    await bar.locator('[data-ak-dm-play]').click();
    await expect(bar.locator('[data-ak-dm-play]')).toHaveText('Pause');
    await expect(bar.locator('[data-ak-dm-status]')).toContainText('Step 2 of 2', {
      timeout: 4000,
    });
    await expect(bar.locator('[data-ak-dm-play]')).toHaveText('Replay', { timeout: 4000 });
    await bar.locator('[data-ak-dm-reset]').click();
    await expect(
      page.locator('[data-ak-id="one"] [data-ak-diagram-contract] [data-ak-dm-step]'),
    ).toHaveCount(0);
  });

  test('a sequence step and a viewer selection never dim together', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, spec(panel('one', 'sequence-playback')), 'sequence-viewer');
    const canvas = page.locator('[data-ak-id="one"] [data-ak-diagram-contract]');
    await node(page, 'one', 'db').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-ak-dv-state]')).not.toHaveCount(0);
    await page.locator('[data-ak-id="one"] [data-ak-dm-next]').click();
    await expect(page.locator('[data-ak-dv-state]')).toHaveCount(0);
    await expect(canvas).toHaveAttribute('data-ak-dm-seq', '');
    await node(page, 'one', 'api').focus();
    await page.keyboard.press('Enter');
    await expect(canvas).not.toHaveAttribute('data-ak-dm-seq', /.*/u);
  });

  test('under reduced motion the sequence steps but does not autoplay', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, spec(panel('one', 'sequence-playback')), 'sequence-reduced');
    const bar = page.locator('[data-ak-id="one"] .ak-dm-bar');
    await expect(bar.locator('[data-ak-dm-play]')).toBeHidden();
    await bar.locator('[data-ak-dm-next]').click();
    await expect(bar.locator('[data-ak-dm-status]')).toContainText('Step 1 of 2');
  });

  test('without script the sequence controls stay hidden', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const target = workspace.write(
      'sequence-nojs',
      compile(spec(panel('one', 'sequence-playback')), { diagramAdapter: gridDiagramAdapter() })
        .html,
    );
    await page.goto(`file://${target}`);
    await expect(page.locator('.ak-dm-bar')).toBeHidden();
    await expect(page.locator('[data-ak-node="api"]')).toBeVisible();
    await context.close();
  });
});
