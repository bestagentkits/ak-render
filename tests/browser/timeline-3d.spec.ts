import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('timeline-3d');

function pageUrl(name: string): string {
  const file = fileURLToPath(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url));
  return `file://${workspace.write(name, compile(readFileSync(file, 'utf8'), { source: name }).html)}`;
}
async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
}
const current = (page: Page) => page.locator('[data-ak-3d="timeline"]');
const stats = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { akRender3d: { stats(): { timelineResources: number } } }
      ).akRender3d.stats().timelineResources,
  );

test.describe('timeline-3d', { tag: '@gl' }, () => {
  test('100 milestones: keyboard, scrubber, list and state step in order, offline', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl('timeline-3d-hundred'));
    await ready(page);
    await expect(page.locator('[data-ak-tl-milestone]')).toHaveCount(100);
    await expect(current(page)).toHaveAttribute('data-ak-tl-current', 's050');
    // From the overview the first step flies in; the next moves on by one.
    await page.locator('[data-ak-tl-step="1"]').click();
    await expect(page.locator('[data-ak-tl-overview]')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('[data-ak-tl-step="1"]').click();
    await expect(current(page)).toHaveAttribute('data-ak-tl-current', 's051');
    await expect(page.locator('.ak-tl-card')).toContainText('051 / 100');
    // Canvas keys.
    await page.locator('.ak-3d-canvas').focus();
    await page.keyboard.press('End');
    await expect(current(page)).toHaveAttribute('data-ak-tl-current', 's100');
    await page.keyboard.press('ArrowLeft');
    await expect(current(page)).toHaveAttribute('data-ak-tl-current', 's099');
    // The list is one tab stop; arrows move within it.
    const chosen = page.locator('[data-ak-tl-milestone="s099"]');
    await expect(chosen).toHaveAttribute('tabindex', '0');
    await chosen.focus();
    await page.keyboard.press('Home');
    await expect(current(page)).toHaveAttribute('data-ak-tl-current', 's001');
    await expect(page.locator('[data-ak-tl-milestone="s001"]')).toBeFocused();
    // Touch-style scrubbing and tapping a list item.
    await page.locator('[data-ak-tl-scrub]').fill('42');
    await expect(current(page)).toHaveAttribute('data-ak-tl-current', 's042');
    await page.locator('[data-ak-tl-milestone="s007"]').click();
    await expect(current(page)).toHaveAttribute('data-ak-tl-current', 's007');
    await expect(page.locator('[data-ak-tl-scrub]')).toHaveValue('7');
    expect(await stats(page)).toBeGreaterThan(0);
    await page.evaluate(() =>
      (window as unknown as { akRender3d: { unmountAll(): void } }).akRender3d.unmountAll(),
    );
    expect(await stats(page)).toBe(0);
    expect(requests).toEqual([]);
  });

  test('a page state change flies to the bound milestone', async ({ page }) => {
    await page.goto(pageUrl('timeline-3d-space'));
    await ready(page);
    await expect(current(page)).toHaveAttribute('data-ak-tl-current', 'apollo-11');
    await page.locator('select').selectOption('hubble');
    await expect(current(page)).toHaveAttribute('data-ak-tl-current', 'hubble');
    await expect(page.locator('.ak-tl-card')).toContainText('Hubble');
  });
});
