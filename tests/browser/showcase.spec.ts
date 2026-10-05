import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';

const fixturesDir = fileURLToPath(new URL('../../fixtures', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'ak-render-showcase-'));

/** Compile the showcase fixture beside a copy of its assets, as the gallery does. */
function artifact(): string {
  mkdirSync(workspace, { recursive: true });
  cpSync(join(fixturesDir, 'assets'), join(workspace, 'assets'), { recursive: true });
  const source = readFileSync(join(fixturesDir, 'pages/showcase.yaml'), 'utf8');
  const target = join(workspace, 'showcase.html');
  writeFileSync(target, compile(source, { source: 'showcase.yaml' }).html, 'utf8');
  return target;
}

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  await page.goto(`file://${artifact()}`, { waitUntil: 'load' });
}

test.describe('before/after slider', () => {
  const figure = (page: Page) => page.locator('[data-ak-before-after]');
  const split = (page: Page) =>
    page
      .locator('.ak-ba-stage')
      .evaluate((stage) => (stage as HTMLElement).style.getPropertyValue('--ak-split'));

  test('switches to the overlay and starts at the authored position', async ({ page }) => {
    await open(page);
    await expect(figure(page)).toHaveAttribute('data-ak-ready', '');
    expect(await split(page)).toBe('50%');
  });

  test('moves with the keyboard', async ({ page }) => {
    await open(page);
    const range = page.getByRole('slider', { name: /Reveal Light or Dark/u });
    await range.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await split(page)).toBe('52%');
    await page.keyboard.press('Home');
    expect(await split(page)).toBe('0%');
  });

  test('follows a pointer drag across the stage', async ({ page }) => {
    await open(page);
    const stage = page.locator('.ak-ba-stage');
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    if (box === null) throw new Error('stage has no box');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(await split(page)).toBe('25%');
  });
});

test.describe('effects', () => {
  test('plays the terminal entrance once it scrolls into view', async ({ page }) => {
    await open(page);
    const terminal = page.locator('.ak-terminal');
    await terminal.scrollIntoViewIfNeeded();
    await expect(terminal).toHaveAttribute('data-ak-inview', '');
  });

  test('settles counted values on their authored text', async ({ page }) => {
    await open(page);
    const value = page.locator('.ak-kpi-value').first();
    const authored = await value.textContent();
    await value.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1700);
    await expect(value).toHaveText(authored ?? '');
  });

  test('stays still under reduced motion', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await open(page);
    const terminal = page.locator('.ak-terminal');
    await terminal.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await expect(terminal).not.toHaveAttribute('data-ak-inview', '');
    const animated = await page
      .locator('.ak-marquee-track')
      .first()
      .evaluate((track) => getComputedStyle(track).animationName);
    expect(animated).toBe('none');
    await context.close();
  });
});

test.describe('fonts, night band, and theme reveal', () => {
  test('loads the embedded display face from data', async ({ page }) => {
    await open(page);
    const statuses = await page.evaluate(async () => {
      await document.fonts.ready;
      await document.fonts.load('700 48px "AK Geist"');
      return [...document.fonts]
        .filter((face) => face.family.replaceAll('"', '') === 'AK Geist')
        .map((face) => face.status);
    });
    expect(statuses).toContain('loaded');
  });

  test('sets the inverse band on dark tokens while the page stays light', async ({ page }) => {
    await open(page);
    const [band, root] = await page.evaluate(() => {
      const section = document.querySelector('[data-surface="inverse"]') as HTMLElement;
      return [
        getComputedStyle(section).getPropertyValue('--ak-color-text').trim(),
        getComputedStyle(document.documentElement).getPropertyValue('--ak-color-text').trim(),
      ];
    });
    expect(band).toBe('#dbe7f3');
    expect(root).toBe('#0f1724');
  });

  test('shows the hero shot and a CTA with real links', async ({ page }) => {
    await open(page);
    const width = await page
      .locator('.ak-hero-media img')
      .evaluate((image) => (image as HTMLImageElement).naturalWidth);
    expect(width).toBeGreaterThan(0);
    await expect(page.locator('.ak-cta a.ak-btn')).toHaveCount(2);
  });

  test('reveals the theme from the toggle, or switches instantly under reduced motion', async ({
    browser,
  }) => {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      const context = await browser.newContext({ reducedMotion });
      const page = await context.newPage();
      await open(page);
      await page.getByRole('button', { name: 'Toggle dark theme' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      const origin = await page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--ak-vt-x'),
      );
      if (reducedMotion === 'reduce') expect(origin).toBe('');
      else expect(origin).toMatch(/^\d+px$/u);
      await context.close();
    }
  });
});
