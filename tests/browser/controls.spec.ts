import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { FILTERABLE_REGISTRY } from '../unit/support/probe-filterable-group.js';
import { browserWorkspace } from './browser-workspace.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const workspace = browserWorkspace('controls');

function write(name: string, spec: unknown): string {
  const html = compile(spec, { source: name, registry: FILTERABLE_REGISTRY }).html;
  return `file://${workspace.write(name, html)}`;
}

function fixture(name: string): string {
  return write(name, readFileSync(`${pagesDir}/${name}.yaml`, 'utf8'));
}

const RUNS = [
  { model: 'Legacy', tokens: 33696, provider: 'acme', cached: false, day: '2026-01-04' },
  { model: 'AK Render', tokens: 4387, provider: 'acme', cached: true, day: '2026-02-11' },
  { model: 'Draft', tokens: 9100, provider: 'globex', cached: true, day: '2026-03-20' },
  { model: 'Mini', tokens: 1200, provider: 'globex', cached: false, day: '2026-04-02' },
  { model: 'Max', tokens: 52000, provider: 'initech', cached: true, day: '2026-05-15' },
];

/** A filter-bar over a test-only filterable list, so the runtime is exercised end to end. */
const FILTER_PAGE = {
  version: 1,
  meta: { title: 'Filter runs' },
  state: { provider: '' },
  blocks: [
    {
      type: 'filter-bar',
      id: 'run-filters',
      title: 'Filter runs',
      target: 'runs',
      blocks: [
        {
          type: 'select',
          id: 'provider',
          label: 'Provider',
          field: 'provider',
          optionsFrom: 'provider',
          bind: 'state.provider',
        },
        { type: 'number-input', id: 'min-tokens', label: 'Min tokens', field: 'tokens' },
        { type: 'text-input', id: 'name', label: 'Model name', field: 'model' },
        { type: 'switch', id: 'cached', label: 'Cached only', field: 'cached' },
        { type: 'date-input', id: 'since', label: 'Since', field: 'day', match: 'min' },
        { type: 'search', id: 'anything', label: 'Anything' },
      ],
    },
    { type: 'probe-rows', id: 'runs', data: RUNS },
    {
      type: 'radio-group',
      id: 'provider-mirror',
      label: 'Provider (mirror)',
      bind: 'state.provider',
      options: [{ value: 'acme' }, { value: 'globex' }, { value: 'initech' }],
    },
  ],
};

const rows = (page: Page) => page.locator('[data-ak-id="runs"] li:not([hidden])');
const count = (page: Page) => page.locator('[data-ak-filter-count]');

test.describe('controls write state', () => {
  test('the select changes state and swaps the visibleWhen sections', async ({ page }) => {
    await page.goto(fixture('controls'), { waitUntil: 'load' });
    await expect(page.locator('[data-ak-id="cost-view"]')).toBeVisible();
    await expect(page.locator('[data-ak-id="latency-view"]')).toBeHidden();
    await page.getByLabel('Metric').selectOption('latency');
    await expect(page.locator('[data-ak-id="latency-view"]')).toBeVisible();
    await expect(page.locator('[data-ak-id="cost-view"]')).toBeHidden();
  });

  test('keyboard alone toggles the switch and moves the radio choice', async ({ page }) => {
    await page.goto(fixture('controls'), { waitUntil: 'load' });
    const details = page.locator('[data-ak-id="details-callout"]');
    await expect(details).toBeHidden();
    const toggle = page.getByRole('switch', { name: 'Show methodology' });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect(details).toBeVisible();

    const apac = page.locator('[data-ak-id="apac-note"]');
    await expect(apac).toBeHidden();
    await page.getByRole('radio', { name: 'United States' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Asia Pacific' })).toBeChecked();
    await expect(apac).toBeVisible();

    // Tab reaches the next control after the radio group.
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Owner')).toBeFocused();
  });

  test('controls bound to one key stay in sync', async ({ page }) => {
    await page.goto(write('filter-sync', FILTER_PAGE), { waitUntil: 'load' });
    await page.getByRole('radio', { name: 'globex' }).check();
    await expect(page.getByLabel('Provider', { exact: true })).toHaveValue('globex');
    await expect(rows(page)).toHaveCount(2);
  });
});

test.describe('filter-bar', () => {
  test('select plus number minimum narrow the rows and the count', async ({ page }) => {
    await page.goto(write('filter', FILTER_PAGE), { waitUntil: 'load' });
    await expect(count(page)).toHaveText('5 of 5 items');
    await page.getByLabel('Provider', { exact: true }).selectOption('acme');
    await expect(rows(page)).toHaveCount(2);
    await page.getByLabel('Min tokens').fill('5000');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toHaveText(/Legacy/u);
    await expect(count(page)).toHaveText('1 of 5 items');
    await expect(page.locator('[data-ak-live]')).toHaveText('1 of 5 items');
  });

  test('text, switch, date and search criteria combine with AND', async ({ page }) => {
    await page.goto(write('filter-combined', FILTER_PAGE), { waitUntil: 'load' });
    await page.getByLabel('Model name').fill('a');
    await expect(rows(page)).toHaveCount(4);
    await page.getByRole('switch', { name: 'Cached only' }).check();
    await expect(rows(page)).toHaveCount(3);
    await page.getByLabel('Since').fill('2026-03-01');
    await expect(rows(page)).toHaveCount(2);
    await page.getByLabel('Anything').fill('initech');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('[data-ak-live]')).toHaveText('1 of 5 items');
  });

  test('Reset restores the initial values and shows every row', async ({ page }) => {
    await page.goto(write('filter-reset', FILTER_PAGE), { waitUntil: 'load' });
    await page.getByLabel('Provider', { exact: true }).selectOption('globex');
    await page.getByLabel('Model name').fill('mi');
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(rows(page)).toHaveCount(5);
    await expect(page.getByLabel('Provider', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Model name')).toHaveValue('');
    await expect(count(page)).toHaveText('5 of 5 items');
    // The bound mirror follows the reset state too.
    await expect(page.getByRole('radio', { name: 'globex' })).not.toBeChecked();
  });

  test('keyboard alone filters and resets', async ({ page }) => {
    await page.goto(write('filter-keyboard', FILTER_PAGE), { waitUntil: 'load' });
    await page.getByLabel('Min tokens').focus();
    await page.keyboard.type('9000');
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Reset' }).focus();
    await page.keyboard.press('Enter');
    await expect(rows(page)).toHaveCount(5);
  });

  test('targets reach 44px and nothing overflows at 375', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(write('filter-mobile', FILTER_PAGE), { waitUntil: 'load' });
    const heights = await page
      .locator('.ak-control select, .ak-control input[type="number"], .ak-choice, .ak-filter-reset')
      .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().height));
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });

  test('every control has an accessible name and visible focus', async ({ page }) => {
    await page.goto(write('filter-a11y', FILTER_PAGE), { waitUntil: 'load' });
    for (const name of ['Provider', 'Min tokens', 'Model name', 'Since', 'Anything']) {
      await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('group', { name: 'Provider (mirror)' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Filter runs' })).toBeVisible();
    const field = page.getByLabel('Model name');
    await field.focus();
    const ring = await field.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring).not.toBe('none');
  });
});

test.describe('without scripts', () => {
  test.use({ javaScriptEnabled: false });

  test('all rows and the initial section show; controls are disabled with a note', async ({
    page,
  }) => {
    await page.goto(write('filter-static', FILTER_PAGE), { waitUntil: 'load' });
    await expect(rows(page)).toHaveCount(5);
    await expect(count(page)).toHaveText('5 items');
    await expect(page.getByLabel('Min tokens')).toBeDisabled();
    await expect(page.locator('[data-ak-requires-js]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset' })).toBeHidden();

    await page.goto(fixture('controls'), { waitUntil: 'load' });
    await expect(page.locator('[data-ak-id="cost-view"]')).toBeVisible();
    await expect(page.locator('[data-ak-id="latency-view"]')).toBeHidden();
    await expect(page.locator('[data-ak-id="alerts-on"]')).toBeVisible();
    await expect(page.getByLabel('Metric')).toHaveValue('cost');
    await expect(page.getByLabel('Metric')).toBeDisabled();
  });
});

test.describe('print', () => {
  test('hides the controls and the bar and keeps every row', async ({ page }) => {
    await page.goto(write('filter-print', FILTER_PAGE), { waitUntil: 'load' });
    await page.getByLabel('Provider', { exact: true }).selectOption('acme');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-filter-bar')).toBeHidden();
    await expect(page.locator('[data-ak-id="provider-mirror"]')).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect(rows(page)).toHaveCount(5);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(rows(page)).toHaveCount(2);
  });
});
