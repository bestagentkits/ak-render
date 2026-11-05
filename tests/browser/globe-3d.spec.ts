import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('globe');
const source = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url)), 'utf8');
const routes = `file://${workspace.write(
  'globe-3d-routes',
  compile(source('globe-3d-routes'), { source: 'globe-3d-routes' }).html,
)}`;
const stress = () =>
  `file://${workspace.write(
    'globe-3d-stress',
    compile(source('globe-3d-stress'), { source: 'globe-3d-stress' }).html,
  )}`;

type Api = {
  stats(): { mounts: number; calls: number; geometries: number };
  unmountAll(): void;
};
const api = (page: Page, call: 'stats' | 'unmountAll') =>
  page.evaluate((name) => {
    const target = (window as unknown as { akRender3d: Api }).akRender3d;
    return name === 'stats' ? target.stats() : target.unmountAll();
  }, call);

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-ak-3d="globe"]')).toHaveAttribute('data-ak-3d-state', 'ready');
}

/** Rows of the office table that the filter bar leaves visible. */
async function visibleOffices(page: Page): Promise<string[]> {
  return page
    .locator('[data-ak-id="cities-table"] tbody tr')
    .evaluateAll((rows) =>
      rows
        .filter((row) => (row as HTMLElement).offsetParent !== null)
        .map((row) => (row as HTMLTableRowElement).cells[0]?.textContent?.trim() ?? ''),
    );
}

const globe = (page: Page) => page.locator('[data-ak-3d="globe"]');

test.describe('globe-3d', { tag: '@gl' }, () => {
  test('renders a live WebGL globe offline and hides the poster', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.goto(routes);
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
    // The globe and its atmosphere cover a large share of the stage.
    expect(painted).toBeGreaterThan(0.2);
    await expect(page.locator('.ak-globe-poster')).toBeHidden();
    expect(requests).toEqual([]);
  });

  test('selecting a place writes state, and the state filters the HTML table', async ({ page }) => {
    await page.goto(routes);
    await ready(page);
    // The initial state selects Singapore, so the detail table shows only it.
    await expect.poll(() => visibleOffices(page)).toEqual(['Singapore']);
    await page.locator('[data-ak-3d-pick="syd"]').click();
    await expect(page.locator('[data-ak-3d-pick="syd"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(globe(page)).toHaveAttribute('data-ak-globe-selected', 'syd');
    await expect.poll(() => visibleOffices(page)).toEqual(['Sydney']);
    // And back: a page control on the same state selects the place on the globe.
    await page.locator('[data-ak-id="cities-table"]').scrollIntoViewIfNeeded();
    await page.locator('select').first().selectOption('gru');
    await expect(globe(page)).toHaveAttribute('data-ak-globe-selected', 'gru');
    await expect(page.locator('[data-ak-3d-pick="gru"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a selection flies the camera to the place', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(routes);
    await ready(page);
    await page.locator('[data-ak-3d-pick="syd"]').click();
    await globe(page).scrollIntoViewIfNeeded();
    // Under reduced motion the flight is a jump: Sydney now sits at the centre of the stage.
    const offset = await page.evaluate(() => {
      const stage = (
        document.querySelector('.ak-globe .ak-3d-stage') as HTMLElement
      ).getBoundingClientRect();
      const tag = (
        document.querySelector('.ak-globe .ak-net-tag') as HTMLElement
      ).getBoundingClientRect();
      return {
        x: Math.abs(tag.left + tag.width / 2 - (stage.left + stage.width / 2)) / stage.width,
        text: (document.querySelector('.ak-globe .ak-net-tag') as HTMLElement).textContent,
      };
    });
    expect(offset.text).toContain('Sydney');
    expect(offset.text).toContain('33.94° S');
    expect(offset.x).toBeLessThan(0.08);
  });

  test('a pointer pick on the canvas selects the place under it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(routes);
    await ready(page);
    // The jump centres São Paulo; a second pick lets go of it and leaves the camera there.
    await page.locator('[data-ak-3d-pick="gru"]').click();
    await page.locator('[data-ak-3d-pick="gru"]').click();
    await expect(globe(page)).toHaveAttribute('data-ak-globe-selected', '');
    await page.locator('.ak-globe .ak-3d-stage').scrollIntoViewIfNeeded();
    const box = (await page.locator('.ak-globe .ak-3d-stage').boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // The marker sits on its value spike just above the surface point at the centre.
    for (const dy of [0, -4, -8, -12, -16, -20, -24]) {
      await page.mouse.click(centre.x, centre.y + dy);
      if ((await globe(page).getAttribute('data-ak-globe-selected')) === 'gru') break;
    }
    await expect(globe(page)).toHaveAttribute('data-ak-globe-selected', 'gru');
  });

  test('the time step filters places and routes, and writes its state', async ({ page }) => {
    await page.goto(routes);
    await ready(page);
    await expect(globe(page)).toHaveAttribute('data-ak-globe-shown', '24');
    const slider = page.locator('[data-ak-globe-time]');
    await expect(slider).toBeEnabled();
    // Index 2 is 2018: offices that opened later drop out of the globe and the tables.
    await slider.fill('2');
    await expect(page.locator('.ak-globe-time output')).toHaveText('2018');
    await expect(globe(page)).toHaveAttribute('data-ak-globe-shown', '10');
    await expect(page.locator('[data-ak-globe-row]:not([data-ak-globe-out])')).toHaveCount(10);
    await expect(page.locator('[data-ak-globe-row="akl"]')).toBeHidden();
    await expect(page.locator('[data-ak-globe-arc]:not([data-ak-globe-out])')).toHaveCount(11);
    await slider.fill('8');
    await expect(globe(page)).toHaveAttribute('data-ak-globe-shown', '24');
  });

  test('a time between steps shows the same rows with and without JavaScript', async ({
    page,
    browser,
  }) => {
    const spec = source('globe-3d-routes').replace('year: ""', 'year: "2019-06"');
    const url = `file://${workspace.write('globe-3d-between', compile(spec, { source: 'between' }).html)}`;
    const shownRows = (target: Page) =>
      target
        .locator('[data-ak-globe-row]:not([data-ak-globe-out])')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-ak-globe-row')));
    const context = await browser.newContext({ javaScriptEnabled: false });
    const still = await context.newPage();
    await still.goto(url);
    const without = await shownRows(still);
    await context.close();
    await page.goto(url);
    await ready(page);
    expect(await shownRows(page)).toEqual(without);
    expect(without.length).toBeGreaterThan(5);
    expect(without).not.toContain('mad');
  });

  test('layer chips hide and show their places and routes', async ({ page }) => {
    await page.goto(routes);
    await ready(page);
    const offices = page.locator('[data-ak-globe-layer="offices"]');
    await offices.click();
    await expect(offices).toHaveAttribute('aria-pressed', 'false');
    await expect(globe(page)).toHaveAttribute('data-ak-globe-shown', '9');
    // Routes to a hidden office go with it.
    await expect(page.locator('[data-ak-globe-arc]:not([data-ak-globe-out])')).toHaveCount(10);
    await offices.click();
    await expect(globe(page)).toHaveAttribute('data-ak-globe-shown', '24');
  });

  test('keyboard walks the places and Escape clears the selection', async ({ page }) => {
    await page.goto(routes);
    await ready(page);
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('n');
    await expect(globe(page)).toHaveAttribute('data-ak-globe-selected', 'hnd');
    await page.keyboard.press('p');
    await expect(globe(page)).toHaveAttribute('data-ak-globe-selected', 'sin');
    await page.keyboard.press('Escape');
    await expect(globe(page)).toHaveAttribute('data-ak-globe-selected', '');
  });

  test('mounts 500 markers and 200 arcs in a handful of draw calls, clustered when far', async ({
    page,
  }) => {
    await page.goto(stress());
    await ready(page);
    await expect(globe(page)).toHaveAttribute('data-ak-globe-shown', '500');
    const stats = (await api(page, 'stats')) as { calls: number; mounts: number };
    expect(stats.mounts).toBe(1);
    expect(stats.calls).toBeLessThanOrEqual(12);
    // Far away, crowded sites merge into counts; close in, every site stands alone.
    await page.locator('.ak-globe .ak-3d-stage').scrollIntoViewIfNeeded();
    const bubbles = page.locator('.ak-globe-bubble:not([hidden])');
    expect(await bubbles.count()).toBeGreaterThan(5);
    await page.locator('.ak-3d-canvas').focus();
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('+');
    await expect(bubbles).toHaveCount(0);
  });

  test('unmount releases the scene and restores the static globe', async ({ page }) => {
    await page.goto(routes);
    await ready(page);
    await api(page, 'unmountAll');
    await expect(globe(page)).toHaveAttribute('data-ak-3d-state', 'static');
    await expect(page.locator('.ak-globe .ak-3d-canvas')).toHaveCount(0);
    await expect(page.locator('.ak-globe-poster')).toBeVisible();
    await expect(page.locator('[data-ak-globe-time]')).toBeDisabled();
  });

  test('without JavaScript the poster and the tables carry every place and route', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(routes);
    await expect(page.locator('.ak-globe-poster')).toBeVisible();
    await expect(page.locator('.ak-globe-poster .ak-globe-land')).toHaveCount(3);
    await expect(page.locator('[data-ak-globe-row]')).toHaveCount(24);
    await expect(page.locator('[data-ak-globe-arc]')).toHaveCount(26);
    await expect(page.locator('[data-ak-globe-row="syd"]')).toContainText('33.94° S');
    await expect(page.locator('[data-ak-globe-time]')).toBeDisabled();
    await context.close();
  });

  test('print shows the poster and every row', async ({ page }) => {
    await page.goto(routes);
    await ready(page);
    await page.locator('[data-ak-globe-layer="offices"]').click();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-globe-poster')).toBeVisible();
    await expect(page.locator('[data-ak-globe-row="akl"]')).toBeVisible();
  });
});
