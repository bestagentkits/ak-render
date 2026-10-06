import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'ak-render-state-'));

function write(name: string, spec: unknown): string {
  mkdirSync(workspace, { recursive: true });
  const target = join(workspace, `${name}.html`);
  writeFileSync(target, compile(spec, { source: name }).html, 'utf8');
  return `file://${target}`;
}

function fixture(name: string): string {
  return write(name, readFileSync(`${pagesDir}/${name}.yaml`, 'utf8'));
}

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const CONDITIONAL_PAGE = {
  version: 1,
  meta: { title: 'Conditional views' },
  state: { view: 'table' },
  blocks: [
    {
      type: 'button',
      id: 'show-chart',
      label: 'Show chart',
      on: { click: { action: 'set-value', path: 'state.view', value: 'chart' } },
    },
    {
      type: 'text',
      id: 'table-view',
      text: 'Table view.',
      visibleWhen: { path: 'state.view', equals: 'table' },
    },
    {
      type: 'text',
      id: 'chart-view',
      text: 'Chart view.',
      visibleWhen: { path: 'state.view', equals: 'chart' },
    },
  ],
};

async function visibleCount(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .evaluateAll(
      (elements) =>
        elements.filter((element) => (element as HTMLElement).offsetParent !== null).length,
    );
}

test.describe('visibleWhen', () => {
  test('shows the initial view and follows state changes', async ({ page }) => {
    await page.goto(write('conditional', CONDITIONAL_PAGE), { waitUntil: 'load' });
    await expect(page.locator('[data-ak-id="table-view"]')).toBeVisible();
    await expect(page.locator('[data-ak-id="chart-view"]')).toBeHidden();
    await page.locator('[data-ak-id="show-chart"]').click();
    await expect(page.locator('[data-ak-id="chart-view"]')).toBeVisible();
    await expect(page.locator('[data-ak-id="table-view"]')).toBeHidden();
  });
});

test.describe('without scripts', () => {
  test.use({ javaScriptEnabled: false });

  test('the initial visibleWhen view is already applied', async ({ page }) => {
    await page.goto(write('conditional-static', CONDITIONAL_PAGE), { waitUntil: 'load' });
    await expect(page.locator('[data-ak-id="table-view"]')).toBeVisible();
    await expect(page.locator('[data-ak-id="chart-view"]')).toBeHidden();
  });

  test('every tab panel is readable and the inert tablist is hidden', async ({ page }) => {
    await page.goto(fixture('interactive'), { waitUntil: 'load' });
    const panels = await page.locator('.ak-tabs [role="tabpanel"]').count();
    expect(panels).toBeGreaterThan(1);
    expect(await visibleCount(page, '.ak-tabs [role="tabpanel"]')).toBe(panels);
    expect(await visibleCount(page, '.ak-tab-panel-title')).toBe(panels);
    expect(await visibleCount(page, '.ak-tabs [role="tablist"]')).toBe(0);
  });

  test('every carousel slide is present and the inert controls are hidden', async ({ page }) => {
    await page.goto(fixture('interactive'), { waitUntil: 'load' });
    const slides = await page.locator('[data-ak-slide]').count();
    expect(slides).toBeGreaterThan(1);
    expect(await page.locator('[data-ak-slide][hidden]').count()).toBe(0);
    expect(await visibleCount(page, '.ak-carousel-controls')).toBe(0);
  });
});

test.describe('with scripts', () => {
  test('tabs show one panel and hide the panel titles', async ({ page }) => {
    await page.goto(fixture('interactive'), { waitUntil: 'load' });
    await expect(page.locator('.ak-tabs').first()).toHaveAttribute('data-ak-tabs-ready', '');
    expect(await visibleCount(page, '.ak-tabs [role="tabpanel"]')).toBe(1);
    expect(await visibleCount(page, '.ak-tab-panel-title')).toBe(0);
  });

  test('print shows every tab panel and carousel slide', async ({ page }) => {
    await page.goto(fixture('interactive'), { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const panels = await page.locator('.ak-tabs [role="tabpanel"]').count();
    expect(await visibleCount(page, '.ak-tabs [role="tabpanel"]')).toBe(panels);
    const slides = await page.locator('[data-ak-slide]').count();
    expect(await visibleCount(page, '[data-ak-slide]')).toBe(slides);
    expect(await visibleCount(page, '.ak-carousel-controls')).toBe(0);
  });
});
