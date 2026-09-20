import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'ak-render-interactions-'));

/**
 * Each fixture is compiled once and opened over `file://`, which is the same
 * path a reader takes. Nothing here starts a server, so an interaction that
 * depends on one would fail rather than quietly pass.
 */
function artifact(name: string): string {
  const source = readFileSync(`${pagesDir}/${name}`, 'utf8');
  const target = join(workspace, `${name.replace(/\.yaml$/u, '')}.html`);
  // The workspace is recreated on demand: a retry or a parallel worker may have
  // cleaned up an earlier copy.
  mkdirSync(workspace, { recursive: true });
  writeFileSync(target, compile(source, { source: name }).html, 'utf8');
  return target;
}

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  // Written per test rather than once at import time, so a retry or a parallel
  // worker can never observe a path that has already been cleaned up.
  await page.goto(`file://${artifact('interactive.yaml')}`, { waitUntil: 'load' });
}

test.describe('button activation', () => {
  test('responds to a pointer click', async ({ page }) => {
    await open(page);
    const toggle = page.locator('[data-ak-theme-toggle]');
    const before = await page.locator('html').getAttribute('data-theme');
    await toggle.click();
    expect(await page.locator('html').getAttribute('data-theme')).not.toBe(before);
  });

  test('responds to Enter and to Space', async ({ page }) => {
    await open(page);
    const button = page.locator('[data-ak-id="copy-spec"]');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-ak-live]')).toHaveText(/Copied/u);

    await page.locator('[data-ak-live]').evaluate((node) => {
      node.textContent = '';
    });
    await button.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('[data-ak-live]')).toHaveText(/Copied/u);
  });

  test('shows a visible focus ring when focused by keyboard', async ({ page }) => {
    await open(page);
    const button = page.locator('[data-ak-id="copy-spec"]');
    await button.focus();
    const outline = await button.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    });
    expect(outline).toMatch(/solid/u);
    expect(outline).not.toMatch(/0px/u);
  });
});

test.describe('slider', () => {
  const slider = (page: Page) => page.locator('[data-ak-id="confidence"] input[type="range"]');

  test('reports its value as text and keeps arrows, Home, and End working', async ({ page }) => {
    await open(page);
    const input = slider(page);
    const output = page.locator('[data-ak-id="confidence"] output');

    await expect(input).toHaveValue('80');
    await expect(output).toHaveText('80');

    await input.focus();
    await page.keyboard.press('ArrowRight');
    await expect(input).toHaveValue('85');
    await expect(output).toHaveText('85');

    await page.keyboard.press('ArrowLeft');
    await expect(output).toHaveText('80');

    await page.keyboard.press('End');
    await expect(input).toHaveValue('100');

    await page.keyboard.press('Home');
    await expect(input).toHaveValue('0');
  });

  test('updates its accessible value state, not just its text', async ({ page }) => {
    await open(page);
    const input = slider(page);
    await input.focus();
    await page.keyboard.press('Home');
    const state = await input.evaluate((node) => {
      const element = node as HTMLInputElement;
      return {
        role: element.getAttribute('role') ?? element.type,
        now: element.value,
        min: element.min,
        max: element.max,
        describedBy: element.getAttribute('aria-describedby'),
      };
    });
    expect(state.role).toBe('range');
    expect(state.now).toBe('0');
    expect(state.min).toBe('0');
    expect(state.max).toBe('100');
    expect(state.describedBy).toBe('confidence-output');
  });

  test('responds to a pointer drag', async ({ page }) => {
    await open(page);
    const input = slider(page);
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;

    const start = { x: box.x + box.width * 0.5, y: box.y + box.height / 2 };
    const end = { x: box.x + box.width * 0.9, y: box.y + box.height / 2 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();

    const value = Number(await input.inputValue());
    expect(value).toBeGreaterThan(50);
    await expect(page.locator('[data-ak-id="confidence"] output')).toHaveText(String(value));
  });

  test('binds its change to page state without an expression', async ({ page }) => {
    await open(page);
    const scale = page.locator('[data-ak-id="scale"] input[type="range"]');
    await scale.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-ak-id="scale"] output')).toHaveText('6');
  });
});

test.describe('carousel', () => {
  const carousel = (page: Page) => page.locator('[data-ak-id="steps-carousel"]');
  const status = (page: Page) => carousel(page).locator('[data-ak-carousel-status]');

  test('navigates with the previous and next buttons', async ({ page }) => {
    await open(page);
    await expect(status(page)).toHaveText('1 / 3');
    await carousel(page).locator('[data-ak-carousel="next"]').click();
    await expect(status(page)).toHaveText('2 / 3');
    await carousel(page).locator('[data-ak-carousel="prev"]').click();
    await expect(status(page)).toHaveText('1 / 3');
  });

  test('disables the previous control on the first slide', async ({ page }) => {
    await open(page);
    await expect(carousel(page).locator('[data-ak-carousel="prev"]')).toBeDisabled();
    await carousel(page).locator('[data-ak-carousel="next"]').click();
    await expect(carousel(page).locator('[data-ak-carousel="prev"]')).toBeEnabled();
  });

  test('navigates with the arrow keys and moves focus to the active slide', async ({ page }) => {
    await open(page);
    await carousel(page).locator('[data-ak-carousel="next"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(status(page)).toHaveText('2 / 3');

    const focusedIsActiveSlide = await page.evaluate(() => {
      const active = document.activeElement;
      return (
        active?.hasAttribute('data-ak-slide') === true && active.hasAttribute('hidden') === false
      );
    });
    expect(focusedIsActiveSlide).toBe(true);
  });

  test('navigates with a touch swipe', async ({ page }) => {
    await open(page);
    const slide = carousel(page).locator('[data-ak-slide]').first();
    await slide.dispatchEvent('touchstart', {
      touches: [{ clientX: 260, clientY: 200, identifier: 1, target: null }],
      changedTouches: [{ clientX: 260, clientY: 200, identifier: 1, target: null }],
      bubbles: true,
      cancelable: true,
    });
    await slide.dispatchEvent('touchend', {
      touches: [],
      changedTouches: [{ clientX: 120, clientY: 200, identifier: 1, target: null }],
      bubbles: true,
      cancelable: true,
    });
    await expect(status(page)).toHaveText('2 / 3');
  });

  test('keeps exactly one slide visible and hidden slides out of the tab order', async ({
    page,
  }) => {
    await open(page);
    const visible = carousel(page).locator('[data-ak-slide]:not([hidden])');
    await expect(visible).toHaveCount(1);
    expect(await carousel(page).locator('[data-ak-slide][hidden]').count()).toBe(2);
  });

  test('does not autoplay', async ({ page }) => {
    await open(page);
    await expect(status(page)).toHaveText('1 / 3');
    await page.waitForTimeout(1200);
    await expect(status(page)).toHaveText('1 / 3');
  });
});

test.describe('tabs', () => {
  const tabs = (page: Page) => page.locator('[data-ak-id="mode-tabs"]');

  test('exposes tablist, tab, and tabpanel semantics wired by id', async ({ page }) => {
    await open(page);
    const first = tabs(page).locator('[role="tab"]').first();
    const controls = await first.getAttribute('aria-controls');
    expect(controls).toBe('mode-tabs-panel-0');
    await expect(tabs(page).locator(`#${controls}`)).toHaveCount(1);
    // The panel must name the tab that labels it, and that reference has to
    // resolve back to the tab element itself.
    const panel = tabs(page).locator(`#${controls}`);
    const labelledBy = await panel.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(await first.getAttribute('id')).toBe(labelledBy);
    await expect(tabs(page).locator(`#${labelledBy}`)).toHaveAttribute('role', 'tab');
  });

  test('selects on click and keeps one panel visible', async ({ page }) => {
    await open(page);
    const second = tabs(page).locator('[role="tab"]').nth(1);
    await second.click();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(tabs(page).locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1);
    await expect(tabs(page).locator('#mode-tabs-panel-1')).not.toHaveAttribute('hidden', '');
  });

  test('navigates with arrow keys, Home, and End using a roving tabindex', async ({ page }) => {
    await open(page);
    const first = tabs(page).locator('[role="tab"]').first();
    await first.focus();

    await page.keyboard.press('ArrowRight');
    const second = tabs(page).locator('[role="tab"]').nth(1);
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(second).toBeFocused();
    await expect(first).toHaveAttribute('tabindex', '-1');
    await expect(second).toHaveAttribute('tabindex', '0');

    await page.keyboard.press('End');
    await expect(tabs(page).locator('[role="tab"]').nth(2)).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.keyboard.press('ArrowRight');
    await expect(first).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowLeft');
    await expect(tabs(page).locator('[role="tab"]').nth(2)).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('announces the selected tab position', async ({ page }) => {
    await open(page);
    await tabs(page).locator('[role="tab"]').nth(1).click();
    await expect(page.locator('[data-ak-live]')).toHaveText(/Tab 2 of 3/u);
  });
});

test.describe('accordion and disclosure', () => {
  test('toggles natively through the summary', async ({ page }) => {
    await open(page);
    const second = page.locator('[data-ak-id="faq-item-1"]');
    await expect(second).not.toHaveAttribute('open', '');
    await second.locator('summary').click();
    await expect(second).toHaveAttribute('open', '');
    await second.locator('summary').click();
    await expect(second).not.toHaveAttribute('open', '');
  });

  test('opens and closes through declarative expand and collapse actions', async ({ page }) => {
    await open(page);
    const first = page.locator('[data-ak-id="faq-item-0"]');
    await page.locator('[data-ak-id="collapse-faq"]').click();
    await expect(first).not.toHaveAttribute('open', '');
    await page.locator('[data-ak-id="expand-faq"]').click();
    await expect(first).toHaveAttribute('open', '');
  });

  test('keeps disclosure content in the document for assistive technology', async ({ page }) => {
    await open(page);
    const first = page.locator('[data-ak-id="faq-item-0"]');
    await expect(first.locator('p')).toHaveCount(1);
    await expect(first.locator('summary')).toHaveText(/Why no page-authored script/u);
  });
});

test.describe('reduced motion', () => {
  const duration = (page: Page) =>
    page.evaluate(() =>
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue('--ak-motion-duration')
        .trim(),
    );

  test('keeps the preset duration when no preference is expressed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    const value = await duration(page);
    expect(value).not.toBe('');
    expect(value).not.toMatch(/^0(m?s)?$/u);
  });

  test('zeroes the duration when the user asks for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    expect(await duration(page)).toMatch(/^0(m?s)?$/u);
  });

  test('carries the reduced-motion rule in the artifact itself', async ({ page }) => {
    await open(page);
    const css = await page.locator('style').first().textContent();
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('--ak-motion-duration:0ms');
  });

  test('honours a preset that disables motion outright', async ({ page }) => {
    const source = `version: 1
meta:
  title: Still
theme:
  tokens:
    motion-policy: none
blocks:
  - type: hero
    title: Still
`;
    const target = join(workspace, 'still.html');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(target, compile(source).html, 'utf8');
    await page.goto(`file://${target}`, { waitUntil: 'load' });
    expect(await duration(page)).toMatch(/^0(m?s)?$/u);
  });
});
