import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { type MotionStudio, startMotionStudio } from '../../src/motion/studio/studio-server.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('../../fixtures/pages/motion-recipes.yaml', import.meta.url)),
  'utf8',
);

let studio: MotionStudio;
let file: string;

test.beforeEach(async () => {
  file = join(mkdtempSync(join(tmpdir(), 'ak-render-studio-')), 'page.yaml');
  writeFileSync(file, FIXTURE);
  studio = await startMotionStudio({ file });
});

test.afterEach(async () => {
  await studio.close();
});

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(studio.url);
  await expect(page.locator('#blocks button').first()).toBeVisible();
  await expect(page.locator('#recipe')).toBeVisible();
  // The studio's own CSP must hold with no violation.
  expect(errors).toEqual([]);
}

const diff = (page: Page) => page.locator('#diff');

test('lists blocks, inspects the selected recipe and previews the real page', async ({ page }) => {
  await open(page);
  await expect(page.locator('#blocks button[data-id="reveal-card"]')).toBeVisible();
  await expect(page.locator('#recipes button')).toHaveCount(7);
  await expect(page.locator('#inspector')).toContainText('reveal-card');
  await expect(page.locator('#inspector .lane').first()).toBeVisible();
  await expect(page.locator('#css')).toContainText('[data-ak-motion="reveal-soft"]');
  await expect(diff(page)).toHaveText('(no changes)');
  await expect(page.locator('#accept')).toBeDisabled();
  const preview = page.frameLocator('#proposed');
  await expect(preview.locator('[data-ak-id="reveal-card"]')).toHaveAttribute(
    'data-ak-motion',
    'reveal-soft',
  );
});

test('a recipe change previews, diffs, undoes and resets without touching the file', async ({
  page,
}) => {
  await open(page);
  await page.locator('#recipe').selectOption('');
  await expect(diff(page)).toContainText('-        motion: reveal-soft');
  await expect(page.locator('#accept')).toBeEnabled();
  await expect(
    page.frameLocator('#proposed').locator('[data-ak-id="reveal-card"]'),
  ).not.toHaveAttribute('data-ak-motion', /./u);

  await page.locator('#easing').selectOption('linear');
  await expect(diff(page)).toContainText('+    motion-easing: linear');

  await page.locator('#undo').click();
  await expect(diff(page)).not.toContainText('motion-easing');
  await expect(diff(page)).toContainText('-        motion: reveal-soft');

  await page.locator('#reset').click();
  await expect(diff(page)).toHaveText('(no changes)');
  await expect(page.locator('#reset')).toBeDisabled();
  expect(readFileSync(file, 'utf8')).toBe(FIXTURE);
});

test('the duration slider tunes the token and the inspector timing', async ({ page }) => {
  await open(page);
  await page.locator('#duration').fill('400');
  await expect(diff(page)).toContainText('+    motion-duration: 400ms');
  await expect(page.locator('#inspector')).toContainText('motion-duration 400ms');
});

test('the duration slider reads the authored token in milliseconds or seconds', async ({
  page,
}) => {
  for (const [token, ms] of [
    ['200ms', '200'],
    ['0.3s', '300'],
  ] as const) {
    await studio.close();
    writeFileSync(
      file,
      FIXTURE.replace(
        '  preset: editorial\n',
        `  preset: editorial\n  tokens:\n    motion-duration: ${token}\n`,
      ),
    );
    studio = await startMotionStudio({ file });
    await open(page);
    await expect(page.locator('#duration')).toHaveValue(ms);
    await expect(page.locator('#duration-out')).toHaveText(`${ms}ms`);
  }
});

test('Accept writes the reviewed diff and keeps comments and order', async ({ page }) => {
  await open(page);
  await page.locator('#policy').selectOption('reduced');
  await expect(diff(page)).toContainText('+    motion-policy: reduced');
  await page.locator('#accept').click();
  await expect(page.locator('#message')).toContainText('Accepted');
  await expect(diff(page)).toHaveText('(no changes)');
  const written = readFileSync(file, 'utf8');
  expect(written).toContain('theme:\n  preset: editorial\n  tokens:\n    motion-policy: reduced\n');
  expect(written.replace('  tokens:\n    motion-policy: reduced\n', '')).toBe(FIXTURE);
});

test('Accept refuses a stale proposal after the file changed on disk', async ({ page }) => {
  await open(page);
  await page.locator('#easing').selectOption('linear');
  await expect(page.locator('#accept')).toBeEnabled();
  const edited = FIXTURE.replace('title: Motion Recipes', 'title: Edited elsewhere');
  writeFileSync(file, edited);
  await page.locator('#accept').click();
  await expect(page.locator('#message')).toContainText('changed on disk');
  expect(readFileSync(file, 'utf8')).toBe(edited);
});

test('an incompatible proposal is reported and cannot be accepted', async ({ page }) => {
  await open(page);
  const state = await page.evaluate(async (url) => {
    const session = /\/studio\/([0-9a-f]+)\//u.exec(url)?.[1] ?? '';
    const response = await fetch(`${url}api/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ak-studio': session },
      body: JSON.stringify({ proposal: { blocks: { 'reveal-card': 'tabs-slide' } } }),
    });
    return (await response.json()).state;
  }, studio.url);
  expect(state.ok).toBe(false);
  expect(state.error.message).toMatch(/tabs-slide/u);
});

test('Compare shows the original beside the proposal', async ({ page }) => {
  await open(page);
  await expect(page.locator('#original-figure')).toBeHidden();
  await page.locator('#compare').click();
  await expect(page.locator('#compare')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#original-figure')).toBeVisible();
  await expect(page.frameLocator('#original').locator('[data-ak-id="reveal-card"]')).toBeVisible();
});

test('the recipe gallery plays a compiled example', async ({ page }) => {
  await open(page);
  await page.locator('#recipes button[data-recipe="tabs-slide"]').click();
  await expect(page.locator('#proposed-caption')).toContainText('tabs-slide');
  await expect(page.frameLocator('#proposed').locator('[data-ak-motion="tabs-slide"]')).toHaveCount(
    1,
  );
});

test('Pause and Replay control the preview animations', async ({ page }) => {
  await open(page);
  const states = () =>
    page
      .frameLocator('#proposed')
      .locator('body')
      .evaluate((body) => body.ownerDocument.getAnimations().map((item) => item.playState));
  await expect.poll(async () => (await states()).length).toBeGreaterThan(0);
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveAttribute('aria-pressed', 'true');
  expect(new Set(await states())).toEqual(new Set(['paused']));
  await page.locator('#replay').click();
  await expect(page.locator('#pause')).toHaveAttribute('aria-pressed', 'false');
});

test('Accept stays off until the diff for the latest change is on screen', async ({ page }) => {
  await open(page);
  await page.locator('#policy').selectOption('reduced');
  await expect(page.locator('#accept')).toBeEnabled();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/state', async (route) => {
    await held;
    await route.continue();
  });
  await page.locator('#easing').selectOption('linear');
  await expect(page.locator('#accept')).toBeDisabled();
  release();
  await expect(diff(page)).toContainText('+    motion-easing: linear');
  await expect(page.locator('#accept')).toBeEnabled();
  await page.unroute('**/api/state');
});

test('Accept stays off while a write is in flight, even when the proposal changes', async ({
  page,
}) => {
  await open(page);
  await page.locator('#policy').selectOption('reduced');
  await expect(page.locator('#accept')).toBeEnabled();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/accept', async (route) => {
    await held;
    await route.continue();
  });
  await page.locator('#accept').click();
  await page.locator('#easing').selectOption('linear');
  await expect(diff(page)).toContainText('+    motion-easing: linear');
  await expect(page.locator('#accept')).toBeDisabled();
  release();
  // The write lands, and the edit made meanwhile stays as the next proposal.
  await expect.poll(() => readFileSync(file, 'utf8')).toContain('motion-policy: reduced');
  await expect(diff(page)).not.toContainText('+    motion-policy');
  await expect(diff(page)).toContainText('+    motion-easing: linear');
  await expect(page.locator('#easing')).toHaveValue('linear');
  await expect(page.locator('#accept')).toBeEnabled();
  await page.unroute('**/api/accept');
});

test('keyboard focus stays on the recipe select after a change', async ({ page }) => {
  await open(page);
  await page.locator('#recipe').focus();
  await page.locator('#recipe').selectOption('');
  await expect(diff(page)).toContainText('-        motion: reveal-soft');
  await expect(page.locator('#recipe')).toBeFocused();
});

test('Rapid toggle leaves the selected tabs settled on one panel', async ({ page }) => {
  await open(page);
  const tabs = page.locator('#blocks button').filter({ hasText: 'tabs-slide' }).first();
  await tabs.click();
  await page.locator('#stress').click();
  await expect(page.locator('#message')).toContainText('rapid clicks');
  const preview = page.frameLocator('#proposed');
  await expect(preview.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
});

test('the block list is keyboard navigable', async ({ page }) => {
  await open(page);
  const first = page.locator('#blocks button').first();
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#blocks button').nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#blocks button').last()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#blocks button').last()).toHaveAttribute('aria-current', 'true');
});

test('the theme toggle switches the studio colour scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await background();
  await page.locator('#scheme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background()).not.toBe(light);
});

test('fits a 375px viewport without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('#accept')).toBeVisible();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, select')]
      .filter((node) => (node as HTMLElement).offsetParent !== null)
      .filter((node) => node.getBoundingClientRect().height < 44)
      .map((node) => node.id || node.textContent?.trim()),
  );
  expect(small).toEqual([]);
});

test('a reduced-motion preference reaches the previewed page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const preview = page.frameLocator('#proposed');
  await expect(preview.locator('[data-ak-id="reveal-card"]')).toBeVisible();
  const running = await page
    .frameLocator('#proposed')
    .locator('body')
    .evaluate((body) =>
      body.ownerDocument
        .getAnimations()
        // Scroll-linked progress is driven by the reader, not by time.
        .filter(
          (animation) =>
            animation.playState === 'running' && animation.timeline instanceof DocumentTimeline,
        )
        .map((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
          const name = (animation as CSSAnimation).animationName ?? 'transition';
          return `${name} on ${target?.outerHTML.slice(0, 120) ?? '?'}`;
        }),
    );
  expect(running).toEqual([]);
});

test('Preview as switches the motion policy of both previews without touching the diff', async ({
  page,
}) => {
  await open(page);
  await page.locator('#compare').click();
  for (const [mode, attribute] of [
    ['none', 'none'],
    ['reduced', 'reduced'],
    ['os-reduce', 'none'],
  ] as const) {
    await page.locator('#preview-mode').selectOption(mode);
    for (const frame of ['#proposed', '#original']) {
      await expect(page.frameLocator(frame).locator('html')).toHaveAttribute(
        'data-motion',
        attribute,
      );
    }
    await expect(diff(page)).toHaveText('(no changes)');
  }
  await page.locator('#preview-mode').selectOption('');
  await expect(page.frameLocator('#proposed').locator('html')).not.toHaveAttribute(
    'data-motion',
    /./u,
  );
});
