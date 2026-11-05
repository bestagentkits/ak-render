import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { gridDiagramAdapter } from '../unit/support/grid-diagram-adapter.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('diagram-viewer');

const SPEC = `version: 1
meta: { title: Viewer }
blocks:
  - type: diagram-panel
    id: flow
    title: Request flow
    spec:
      diagram_type: architecture
      components:
        - { id: client, label: Client }
        - { id: api, label: API }
        - { id: cache, label: Cache }
        - { id: db, label: "Cơ sở dữ liệu" }
        - { id: audit, label: Audit }
      connections:
        - { from: client, to: api, label: HTTPS }
        - { from: api, to: cache }
        - { from: api, to: db, label: SQL }
        - { from: cache, to: db }
`;

const node = (page: Page, id: string) => page.locator(`[data-ak-node="${id}"]`);
const state = (page: Page, id: string) => node(page, id).getAttribute('data-ak-dv-state');

async function open(page: Page, hash = ''): Promise<string[]> {
  const target = workspace.write(
    'viewer',
    compile(SPEC, { diagramAdapter: gridDiagramAdapter() }).html,
  );
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`file://${target}${hash}`, { waitUntil: 'load' });
  return errors;
}

test.describe('diagram viewer', () => {
  test('reveals its controls and makes every node operable', async ({ page }) => {
    const errors = await open(page);
    await expect(page.locator('.ak-dv-bar')).toBeVisible();
    await expect(page.locator('.ak-dv-details')).toBeHidden();
    await expect(node(page, 'api')).toHaveAttribute('role', 'button');
    await expect(node(page, 'api')).toHaveAttribute('tabindex', '0');
    await expect(node(page, 'api')).toHaveAttribute('aria-label', 'API, 2 outgoing, 1 incoming');
    expect(errors).toEqual([]);
  });

  test('selecting a node focuses it, marks its neighbours and dims the rest', async ({ page }) => {
    await open(page);
    await node(page, 'api').click();
    expect(await state(page, 'api')).toBe('focus');
    expect(await state(page, 'client')).toBe('near');
    expect(await state(page, 'db')).toBe('near');
    expect(await state(page, 'audit')).toBeNull();
    const dim = await node(page, 'audit').evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(dim)).toBeLessThan(0.5);
    const details = page.locator('.ak-dv-details');
    await expect(details).toBeVisible();
    await expect(details.locator('h3')).toHaveText('API');
    await expect(details).toContainText('2 outgoing, 1 incoming');
    expect(page.url()).toContain('#flow:node:api');
  });

  test('a neighbour button in the details panel moves the selection', async ({ page }) => {
    await open(page);
    await node(page, 'api').click();
    await page.locator('.ak-dv-details button', { hasText: /^→ Cache$/ }).click();
    expect(await state(page, 'cache')).toBe('focus');
    await expect(node(page, 'cache')).toBeFocused();
  });

  test('keyboard: Enter selects, Shift+Enter traces a route, Escape clears', async ({ page }) => {
    await open(page);
    await node(page, 'client').focus();
    await page.keyboard.press('Enter');
    expect(await state(page, 'client')).toBe('focus');
    await node(page, 'db').focus();
    await page.keyboard.press('Shift+Enter');
    for (const id of ['client', 'api', 'db']) expect(await state(page, id)).toBe('route');
    expect(await state(page, 'cache')).toBeNull();
    await expect(page.locator('.ak-dv-details')).toContainText('Client → API → Cơ sở dữ liệu');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-ak-dv-state]')).toHaveCount(0);
    await expect(page.locator('.ak-dv-details')).toBeHidden();
  });

  test('says so when no directed route exists', async ({ page }) => {
    await open(page);
    await node(page, 'db').click();
    await node(page, 'client').click({ modifiers: ['Shift'] });
    await expect(page.locator('.ak-dv-details')).toContainText('No route');
  });

  test('downstream shows everything reachable along the arrows', async ({ page }) => {
    await open(page);
    await node(page, 'api').click();
    await page.locator('.ak-dv-details button', { hasText: 'downstream' }).click();
    for (const id of ['cache', 'db']) expect(await state(page, id)).toBe('route');
    expect(await state(page, 'client')).toBeNull();
    await expect(page.locator('.ak-dv-details')).toContainText('2 nodes reachable');
  });

  test('clicking a relationship inspects it with its label', async ({ page }) => {
    await open(page);
    await page.locator('[data-ak-edge][data-ak-label="SQL"] path').dispatchEvent('click');
    await expect(page.locator('.ak-dv-details h3')).toHaveText('API → Cơ sở dữ liệu');
    await expect(page.locator('.ak-dv-details')).toContainText('SQL');
  });

  test('search ignores diacritics and Enter selects the first match', async ({ page }) => {
    await open(page);
    const search = page.locator('.ak-dv-search');
    await search.fill('co so');
    expect(await state(page, 'db')).toBe('match');
    await expect(page.locator('.ak-dv-status')).toContainText('1 match');
    await search.press('Enter');
    expect(await state(page, 'db')).toBe('focus');
  });

  test('zoom buttons resize the drawing and fit sets it to the panel', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    const svg = page.locator('.ak-diagram-canvas svg');
    const width = async () => (await svg.boundingBox())?.width ?? 0;
    const before = await width();
    await page.locator('[data-ak-dv-zoom="in"]').click();
    expect(await width()).toBeGreaterThan(before * 1.2);
    await page.locator('[data-ak-dv-zoom="fit"]').click();
    const fitted = await width();
    const room = await page
      .locator('.ak-diagram-rendered')
      .evaluate((el) => el.clientWidth - Number.parseFloat(getComputedStyle(el).paddingLeft) * 2);
    expect(Math.abs(fitted - room)).toBeLessThan(2);
    await page.locator('[data-ak-dv-zoom="reset"]').click();
    expect(Math.abs((await width()) - before)).toBeLessThan(1);
  });

  test('a shared link restores the selection', async ({ page }) => {
    await open(page, '#flow:node:cache');
    expect(await state(page, 'cache')).toBe('focus');
    await expect(page.locator('.ak-dv-details h3')).toHaveText('Cache');
  });

  test('without script the controls stay hidden and the drawing reads', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const target = workspace.write(
      'viewer-nojs',
      compile(SPEC, { diagramAdapter: gridDiagramAdapter() }).html,
    );
    await page.goto(`file://${target}`);
    await expect(page.locator('.ak-dv-bar')).toBeHidden();
    await expect(node(page, 'api')).toBeVisible();
    await context.close();
  });

  test('print drops the controls and the dimming', async ({ page }) => {
    await open(page);
    await node(page, 'api').click();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-dv-bar')).toBeHidden();
    await expect(page.locator('.ak-dv-details')).toBeHidden();
    const opacity = await node(page, 'audit').evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity).toBe('1');
  });
});

test.describe('diagram viewer hardening', () => {
  for (const hash of ['#flow:node:%E0', '#flow:node:constructor', '#flow:route:__proto__:db']) {
    test(`a malformed link (${hash}) leaves the viewer working`, async ({ page }) => {
      const errors = await open(page, hash);
      await expect(page.locator('[data-ak-dv-state]')).toHaveCount(0);
      await node(page, 'api').click();
      expect(await state(page, 'api')).toBe('focus');
      expect(errors).toEqual([]);
    });
  }

  test('Trace a route works by tap, without Shift', async ({ page }) => {
    await open(page);
    await node(page, 'client').click();
    await page.locator('.ak-dv-details button', { hasText: 'Trace a route' }).click();
    await node(page, 'db').click();
    expect(await state(page, 'api')).toBe('route');
  });

  test('relationships are reachable from the details panel by keyboard', async ({ page }) => {
    await open(page);
    await node(page, 'api').click();
    await page
      .locator('.ak-dv-details button', { hasText: 'API → Cơ sở dữ liệu (SQL)' })
      .press('Enter');
    await expect(page.locator('.ak-dv-details h3')).toHaveText('API → Cơ sở dữ liệu');
  });

  test('a failed trace clears the previous highlight', async ({ page }) => {
    await open(page);
    await node(page, 'db').click();
    await node(page, 'client').click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-ak-dv-state]')).toHaveCount(0);
  });

  test('Escape disarms a pending trace', async ({ page }) => {
    await open(page);
    await node(page, 'client').click();
    await page.locator('.ak-dv-details button', { hasText: 'Trace a route' }).click();
    await page.keyboard.press('Escape');
    await node(page, 'db').click();
    expect(await state(page, 'db')).toBe('focus');
  });
});
