import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'ak-render-data-table-'));

function fixtureUrl(): string {
  mkdirSync(workspace, { recursive: true });
  const target = join(workspace, 'data-tables.html');
  const source = readFileSync(`${pagesDir}/data-tables.yaml`, 'utf8');
  writeFileSync(target, compile(source, { source: 'data-tables' }).html, 'utf8');
  return `file://${target}`;
}

const url = fixtureUrl();

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** The fixture's first table: 24 runs, so it has search and a sticky header. */
const RUNS = '[data-ak-data-table][data-ak-sticky]';

async function open(page: Page): Promise<void> {
  await page.goto(url);
  await expect(page.locator(RUNS)).toHaveAttribute('data-ak-table-ready', '');
}

async function columnValues(page: Page, column: number): Promise<string[]> {
  return page
    .locator(`${RUNS} tbody tr`)
    .evaluateAll(
      (rows, index) =>
        rows.map(
          (row) => (row as HTMLTableRowElement).cells[index]?.getAttribute('data-sort') ?? '',
        ),
      column,
    );
}

function visibleRows(page: Page) {
  return page.locator(`${RUNS} tbody tr:visible`);
}

test('a click sorts a column and toggles aria-sort', async ({ page }) => {
  await open(page);
  const header = page.locator(`${RUNS} thead th`).nth(3);
  const button = header.getByRole('button', { name: /Saving/u });
  await expect(header).not.toHaveAttribute('aria-sort', /.+/u);

  await button.click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const ascending = (await columnValues(page, 3)).map(Number);
  expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
  await expect(page.locator('[data-ak-live]')).toHaveText('Sorted by Saving, ascending');
  // Only one column is sorted at a time.
  await expect(page.locator(`${RUNS} thead th[aria-sort]`)).toHaveCount(1);

  await button.click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  const descending = (await columnValues(page, 3)).map(Number);
  expect(descending).toEqual([...descending].sort((a, b) => b - a));
});

test('Enter on a focused header sorts it', async ({ page }) => {
  await open(page);
  const header = page.locator(`${RUNS} thead th`).first();
  await header.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const names = await columnValues(page, 0);
  expect(names).toEqual([...names].sort());
});

test('search narrows the rows and announces the count', async ({ page }) => {
  await open(page);
  await expect(visibleRows(page)).toHaveCount(24);
  await page.locator(`${RUNS} [data-ak-dt-search]`).fill('helix');
  await expect(visibleRows(page)).toHaveCount(2);
  await expect(page.locator(`${RUNS} [data-ak-dt-count]`)).toHaveText('2 of 24 rows');
  await expect(page.locator('[data-ak-live]')).toHaveText('2 of 24 rows shown');

  await page.locator(`${RUNS} [data-ak-dt-search]`).fill('no such model');
  await expect(visibleRows(page)).toHaveCount(0);
  await expect(page.locator(`${RUNS} [data-ak-dt-empty]`)).toBeVisible();

  await page.locator(`${RUNS} [data-ak-dt-search]`).fill('');
  await expect(visibleRows(page)).toHaveCount(24);
  await expect(page.locator(`${RUNS} [data-ak-dt-empty]`)).toBeHidden();
});

test('print hides the controls and shows every row', async ({ page }) => {
  await open(page);
  await page.locator(`${RUNS} [data-ak-dt-search]`).fill('helix');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator(`${RUNS} .ak-dt-tools`)).toBeHidden();
  await expect(visibleRows(page)).toHaveCount(24);
});

test.describe('without scripts', () => {
  test.use({ javaScriptEnabled: false });

  test('shows the complete table and no controls', async ({ page }) => {
    await page.goto(url);
    await expect(visibleRows(page)).toHaveCount(24);
    await expect(page.locator(`${RUNS} .ak-dt-tools`)).toBeHidden();
    await expect(page.locator(`${RUNS} thead button`)).toHaveCount(0);
    // Rows keep the authored order after the transform: p95 ascending.
    const latency = (await columnValues(page, 5)).map(Number);
    expect(latency).toEqual([...latency].sort((a, b) => a - b));
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('rows become labelled cards with no horizontal overflow', async ({ page }) => {
    await open(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    const cell = page.locator(`${RUNS} tbody tr`).first().locator('td').first();
    await expect(cell).toHaveCSS('display', 'flex');
    const label = await cell.evaluate((element) => getComputedStyle(element, '::before').content);
    expect(label).toBe('"Provider"');
    // Sorting stays reachable: the header becomes a row of 44px chips.
    const chip = page.locator(`${RUNS} thead th`).first().getByRole('button');
    await expect(chip).toBeVisible();
    expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
