import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const fixturesDir = fileURLToPath(new URL('../../fixtures', import.meta.url));
// The fixture references its images relatively, so they sit beside the page.
const workspace = browserWorkspace('product', { assets: true });
const html = compile(readFileSync(join(fixturesDir, 'pages/product-widgets.yaml'), 'utf8'), {
  source: 'product-widgets.yaml',
}).html;
const pageUrl = (): string => `file://${workspace.write('product-widgets', html)}`;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

const thumb = (index: number) => `#ak-lb-screens-${index}-thumb`;
const figure = (index: number) => `#ak-lb-screens-${index}`;

test.describe('gallery lightbox', () => {
  test('opens from the keyboard, steps, closes on Escape and returns focus', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(pageUrl(), { waitUntil: 'load' });
    await expect(page.locator('[data-ak-lightbox-root]')).toHaveAttribute(
      'data-ak-lightbox-ready',
      '',
    );
    await page.locator(thumb(1)).focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('dialog.ak-lightbox-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(page.locator(figure(1))).toBeVisible();
    await expect(page.locator(`${figure(1)} [data-ak-lightbox-close]`)).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(page.locator(figure(2))).toBeVisible();
    await expect(page.locator(figure(1))).toBeHidden();
    await expect(page.locator('[data-ak-live]')).toContainText('Image 2 of 3');

    // Activating a step link moves with wrap-around and keeps focus on that control.
    await page.locator(`${figure(2)} [data-ak-lightbox-step="-1"]`).click();
    await expect(page.locator(figure(1))).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(figure(3))).toBeVisible();
    await expect(page.locator(`${figure(3)} [data-ak-lightbox-step="-1"]`)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(page.locator(thumb(1))).toBeFocused();
    expect(page.url()).not.toContain('#ak-lb');
    expect(errors).toEqual([]);
  });

  test('the Close control shuts the viewer and returns focus to the opener', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(pageUrl(), { waitUntil: 'load' });
    await page.locator(thumb(2)).click();
    await page.locator(`${figure(2)} [data-ak-lightbox-close]`).click();
    await expect(page.locator('dialog.ak-lightbox-dialog')).not.toHaveAttribute('open', '');
    await expect(page.locator(thumb(2))).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('prints the grid without the viewer', async ({ page }) => {
    await page.goto(pageUrl(), { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.ak-gallery img').first()).toBeVisible();
    await expect(page.locator(figure(1))).toBeHidden();
  });
});

test.describe('without scripts', () => {
  test.use({ javaScriptEnabled: false });

  test('a thumbnail link opens the full-size figure and Close returns', async ({ page }) => {
    await page.goto(pageUrl(), { waitUntil: 'load' });
    await expect(page.locator(figure(1))).toBeHidden();
    await page.locator(thumb(1)).click();
    await expect(page).toHaveURL(/#ak-lb-screens-1$/u);
    await expect(page.locator(figure(1))).toBeVisible();
    await page
      .locator(`${figure(1)} a[href="#ak-lb-screens-2"]`)
      .first()
      .click();
    await expect(page.locator(figure(2))).toBeVisible();
    await expect(page.locator(figure(1))).toBeHidden();
    await page.locator(`${figure(2)} .ak-lightbox-close`).click();
    await expect(page).toHaveURL(/#ak-lb-screens-2-thumb$/u);
    await expect(page.locator(figure(2))).toBeHidden();
  });
});

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('pricing stacks, the calendar becomes an agenda, and nothing overflows', async ({
    page,
  }) => {
    await page.goto(pageUrl(), { waitUntil: 'load' });
    const lefts = await page
      .locator('.ak-plan')
      .evaluateAll((plans) => plans.map((plan) => Math.round(plan.getBoundingClientRect().left)));
    expect(lefts.length).toBe(3);
    expect(new Set(lefts).size).toBe(1);
    await expect(page.locator('.ak-calendar-weekdays')).toBeHidden();
    await expect(page.locator('.ak-calendar-day[data-events]').first()).toBeVisible();
    await expect(page.locator('.ak-calendar-day:not([data-events])').first()).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
