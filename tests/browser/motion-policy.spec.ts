import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const workspace = browserWorkspace('motion-policy');

type Policy = 'full' | 'reduced' | 'none';
type System = 'no-preference' | 'reduce';

/**
 * The showcase fixture carries most animation families at once: the hero word
 * reveal and aurora, the marquee, scroll-linked parallax, the terminal and KPI
 * entrances, count-up stats and the theme toggle. The interactive fixture adds
 * the dialog and disclosure transitions.
 */
function artifact(fixture: string, policy: Policy): string {
  const source = readFileSync(`${pagesDir}/${fixture}.yaml`, 'utf8').replace(
    /^theme:\n {2}preset: ([\w-]+)$/mu,
    `theme:\n  preset: $1\n  tokens:\n    motion-policy: ${policy}`,
  );
  const name = `${fixture}-${policy}`;
  return workspace.write(name, compile(source, { source: `${name}.yaml` }).html);
}

async function open(page: Page, fixture: string, policy: Policy, system: System): Promise<void> {
  await page.emulateMedia({ reducedMotion: system });
  await page.goto(`file://${artifact(fixture, policy)}`, { waitUntil: 'load' });
}

/** Time-based CSS animations, after scrolling the page so every entrance has fired. */
async function timeAnimations(page: Page): Promise<string[]> {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
    window.scrollTo(0, 0);
  });
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.timeline === document.timeline)
      .map((animation) => (animation as CSSAnimation).animationName ?? 'transition')
      .filter((name) => name !== 'transition'),
  );
}

const duration = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ak-motion-duration').trim(),
  );

const STILL = /^0(m?s)?$/u;

/** Effective state: the system setting always wins over the theme policy. */
const MATRIX: [Policy, System, 'full' | 'restrained' | 'still'][] = [
  ['full', 'no-preference', 'full'],
  ['full', 'reduce', 'still'],
  ['reduced', 'no-preference', 'restrained'],
  ['reduced', 'reduce', 'still'],
  ['none', 'no-preference', 'still'],
  ['none', 'reduce', 'still'],
];

test.describe('effective motion policy', () => {
  for (const [policy, system, state] of MATRIX) {
    test(`${policy} theme with system ${system} is ${state}`, async ({ page }) => {
      await open(page, 'showcase', policy, system);
      const root = page.locator('html');
      if (policy === 'full') expect(await root.getAttribute('data-motion')).toBeNull();
      else await expect(root).toHaveAttribute('data-motion', policy);

      if (state === 'still') expect(await duration(page)).toMatch(STILL);
      else expect(await duration(page)).not.toMatch(STILL);

      const running = await timeAnimations(page);
      if (state === 'full') {
        expect(running).toEqual(expect.arrayContaining(['ak-aurora', 'ak-marquee']));
      } else {
        expect(running).toEqual([]);
      }

      const smooth = await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      );
      expect(smooth).toBe(state === 'full' ? 'smooth' : 'auto');

      // Content never waits on motion: the hero title and count-up figures read in full.
      await expect(page.locator('h1')).toBeVisible();
      const opacity = await page
        .locator('h1')
        .evaluate((el) => Number(getComputedStyle(el).opacity));
      expect(opacity).toBe(1);
    });
  }

  test('restrained keeps state feedback transitions; still makes them instant', async ({
    page,
  }) => {
    const summaryDuration = () =>
      page
        .locator('.ak-accordion summary')
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration);
    await open(page, 'interactive', 'reduced', 'no-preference');
    expect(await summaryDuration()).not.toMatch(/^0s(, 0s)*$/u);
    await open(page, 'interactive', 'reduced', 'reduce');
    expect(await summaryDuration()).toMatch(/^0s(, 0s)*$/u);
    await open(page, 'interactive', 'none', 'no-preference');
    expect(await summaryDuration()).toMatch(/^0s(, 0s)*$/u);
  });

  for (const [policy, system, state] of MATRIX) {
    test(`dialog opens ${state === 'full' ? 'with' : 'without'} an entrance under ${policy}/${system}`, async ({
      page,
    }) => {
      await open(page, 'interactive', policy, system);
      const trigger = page.locator('[data-ak-id="open-dialog"]');
      await trigger.click();
      const dialog = page.locator('dialog.ak-dialog[open]');
      await expect(dialog).toBeVisible();
      const name = await dialog.evaluate((el) => getComputedStyle(el).animationName);
      expect(name).toBe(state === 'full' ? 'ak-dialog-in' : 'none');
      // Focus moves into the open dialog and Escape returns it, whatever the motion.
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  }

  test('the theme toggle skips its view transition unless motion is full', async ({ page }) => {
    for (const [policy, system, state] of MATRIX) {
      await open(page, 'interactive', policy, system);
      const used = await page.evaluate(() => {
        let called = false;
        const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
        doc.startViewTransition = (callback: () => void) => {
          called = true;
          callback();
          return {};
        };
        (document.querySelector('[data-ak-theme-toggle]') as HTMLElement).click();
        return called;
      });
      expect(used, `${policy}/${system}`).toBe(state === 'full');
      await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/u);
    }
  });

  test('scroll-position indicators follow the scroll in every state', async ({ page }) => {
    for (const [policy, system] of MATRIX) {
      await open(page, 'showcase', policy, system);
      const indicators = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => animation.timeline !== document.timeline)
          .map((animation) => (animation as CSSAnimation).animationName),
      );
      expect(indicators, `${policy}/${system}`).toContain('ak-reading');
    }
  });
});

test.describe('motion fallbacks', () => {
  test('print settles every animation', async ({ page }) => {
    await open(page, 'showcase', 'full', 'no-preference');
    await page.emulateMedia({ media: 'print' });
    const running = await page.evaluate(() => document.getAnimations().length);
    expect(running).toBe(0);
  });

  test('without JavaScript every animated block shows its final state', async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      reducedMotion: 'no-preference',
    });
    const page = await context.newPage();
    await page.goto(`file://${artifact('showcase', 'full')}`, { waitUntil: 'load' });
    const hidden = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-ak-animate], [data-ak-animate] *, .ak-word > span'),
      )
        .filter((el) => {
          const style = getComputedStyle(el);
          return style.visibility === 'hidden' || Number(style.opacity) === 0;
        })
        .map((el) => el.className),
    );
    expect(hidden).toEqual([]);
    await expect(page.locator('h1')).toBeVisible();
    await context.close();
  });
});
