import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const fixture = fileURLToPath(new URL('../../fixtures/pages/motion-recipes.yaml', import.meta.url));
const workspace = browserWorkspace('motion-recipes');

function artifact(policy: 'full' | 'reduced' | 'none' = 'full'): string {
  const source = readFileSync(fixture, 'utf8').replace(
    /^theme:\n {2}preset: ([\w-]+)$/mu,
    `theme:\n  preset: $1\n  tokens:\n    motion-policy: ${policy}`,
  );
  const name = `motion-recipes-${policy}`;
  return workspace.write(name, compile(source, { source: `${name}.yaml` }).html);
}

async function open(
  page: Page,
  options: { system?: 'no-preference' | 'reduce'; policy?: 'full' | 'reduced' | 'none' } = {},
): Promise<void> {
  await page.emulateMedia({ reducedMotion: options.system ?? 'no-preference' });
  await page.goto(`file://${artifact(options.policy)}`, { waitUntil: 'load' });
}

/** Names of the recipe animations running on the document timeline. */
const recipeAnimations = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .map((animation) => (animation as CSSAnimation).animationName ?? '')
      .filter((name) => name.startsWith('ak-m-')),
  );

const block = (page: Page, id: string) => page.locator(`[data-ak-id="${id}"]`);

/** Records every recipe animation that starts, as `<block id or role>:<name>`. */
const recordStarts = (page: Page) =>
  page.evaluate(() => {
    const starts: string[] = [];
    (window as unknown as { starts: string[] }).starts = starts;
    document.addEventListener(
      'animationstart',
      (event) => {
        if (!event.animationName.startsWith('ak-m-') || event.pseudoElement !== '') return;
        const el = event.target as HTMLElement;
        const owner = el.closest('[data-ak-id]')?.getAttribute('data-ak-id') ?? '';
        starts.push(`${el.getAttribute('role') ?? owner}:${event.animationName}`);
      },
      true,
    );
  });

const starts = (page: Page) =>
  page.evaluate(() => [...(window as unknown as { starts: string[] }).starts]);

/** The tab marker's box and the selected tab's box, relative to the tablist. */
const markerAndTab = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector(
      '[data-ak-id="plan-tabs"] > [role="tablist"]',
    ) as HTMLElement;
    const tab = list.querySelector('[aria-selected="true"]') as HTMLElement;
    const marker = getComputedStyle(list, '::before');
    const [x = '0', y = '0'] = marker.translate.split(' ');
    return {
      marker: {
        x: Math.round(Number.parseFloat(x)),
        y: Math.round(Number.parseFloat(y)),
        w: Math.round(Number.parseFloat(marker.width)),
        h: Math.round(Number.parseFloat(marker.height)),
      },
      tab: { x: tab.offsetLeft, y: tab.offsetTop, w: tab.offsetWidth, h: tab.offsetHeight },
      transition: marker.transitionDuration,
      /** True when the marker would slide: a timed transition on a moving property. */
      slides:
        marker.transitionDuration.split(',').some((time) => Number.parseFloat(time) > 0) &&
        /translate|width|height|all/u.test(marker.transitionProperty),
    };
  });

test.describe('motion recipes under full motion', () => {
  test('arrival recipes play once as their blocks scroll into view', async ({ page }) => {
    await open(page);
    const card = block(page, 'reveal-card');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute('data-ak-inview', '');
    await expect(block(page, 'stagger-steps')).toHaveAttribute('data-ak-inview', '');
    const delays = await page.evaluate(() =>
      [...document.querySelectorAll('[data-ak-id="stagger-steps"] .ak-steps > li')].map(
        (item) => getComputedStyle(item).animationDelay,
      ),
    );
    expect(new Set(delays).size).toBe(delays.length);
    await block(page, 'roll-stats').scrollIntoViewIfNeeded();
    await expect(block(page, 'roll-stats')).toHaveAttribute('data-ak-inview', '');
    await expect(card).toHaveCSS('animation-name', 'ak-m-rise');
    await expect(block(page, 'roll-stats').locator('dd').first()).toHaveCSS(
      'animation-name',
      'ak-m-roll',
    );
  });

  test('the tab marker follows clicks and arrow keys, and the panel fades in', async ({ page }) => {
    await open(page);
    const tabs = block(page, 'plan-tabs');
    await tabs.scrollIntoViewIfNeeded();
    await expect(tabs.locator('> [role="tablist"]')).toHaveAttribute('data-ak-indicator-live', '');
    let state = await markerAndTab(page);
    expect(state.marker).toEqual(state.tab);
    expect(state.slides).toBe(true);

    await recordStarts(page);
    await tabs.getByRole('tab', { name: 'Pricing' }).click();
    const panel = tabs.locator('> [role="tabpanel"]:not([hidden])');
    await expect(panel).toContainText('Arrow keys');
    await expect.poll(() => starts(page)).toContain('tabpanel:ak-m-fade');
    await expect(panel).not.toHaveAttribute('data-ak-entering', /.*/u);
    await expect
      .poll(async () => {
        state = await markerAndTab(page);
        return JSON.stringify(state.marker) === JSON.stringify(state.tab);
      })
      .toBe(true);

    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Frequently asked' })).toBeFocused();
    await expect(tabs.getByRole('tab', { name: 'Frequently asked' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect
      .poll(async () => {
        state = await markerAndTab(page);
        return JSON.stringify(state.marker) === JSON.stringify(state.tab);
      })
      .toBe(true);
  });

  test('rapid state changes settle on the final view with nothing left mid-motion', async ({
    page,
  }) => {
    await open(page);
    const radios = block(page, 'plan-radios');
    await radios.scrollIntoViewIfNeeded();
    for (const label of ['Annual', 'Monthly', 'Annual', 'Monthly', 'Annual']) {
      await radios.getByLabel(label).check();
    }
    await expect(block(page, 'annual-callout')).toBeVisible();
    await expect(block(page, 'annual-kpi')).toBeVisible();
    await expect(block(page, 'monthly-kpi')).toBeHidden();
    await expect(page.locator('[data-ak-entering]')).toHaveCount(0);
    expect(await block(page, 'annual-callout').evaluate((el) => getComputedStyle(el).opacity)).toBe(
      '1',
    );
  });

  test('a state change fades the shown block in once and rolls its figures again', async ({
    page,
  }) => {
    await open(page);
    const radios = block(page, 'plan-radios');
    await radios.scrollIntoViewIfNeeded();
    await recordStarts(page);
    await radios.getByLabel('Annual').check();
    await expect(block(page, 'annual-callout')).toBeVisible();
    await expect.poll(() => starts(page)).toContain('annual-callout:ak-m-fade');
    await expect.poll(() => starts(page)).toContain('annual-kpi:ak-m-roll');
    await expect(page.locator('[data-ak-entering]')).toHaveCount(0);

    // Re-running the bindings without a visibility change replays nothing.
    const before = (await starts(page)).length;
    await radios.getByLabel('Annual').dispatchEvent('change');
    await page.waitForTimeout(400);
    expect(await starts(page)).toHaveLength(before);

    // Showing the figures again rolls them again.
    await radios.getByLabel('Monthly').check();
    await expect(block(page, 'monthly-kpi')).toBeVisible();
    await radios.getByLabel('Annual').check();
    await expect(block(page, 'annual-kpi')).toBeVisible();
    await expect
      .poll(async () => (await starts(page)).filter((name) => name === 'annual-kpi:ak-m-roll'))
      .toHaveLength(4);
  });

  test('the close button plays the same exit and returns focus', async ({ page }) => {
    await open(page);
    const opener = block(page, 'open-confirm');
    const dialog = page.locator('dialog[data-ak-id="confirm-dialog"]');
    await opener.click();
    await expect(dialog).toHaveAttribute('open', '');
    const exit = await dialog.evaluate((el) => {
      (el.querySelector('[data-ak-dialog-close]') as HTMLElement).click();
      return {
        leaving: el.hasAttribute('data-ak-leaving'),
        animation: getComputedStyle(el).animationName,
      };
    });
    // The exit runs while the dialog is still open, then the dialog closes.
    expect(exit).toEqual({ leaving: true, animation: 'ak-m-pop-out' });
    await expect(dialog).not.toHaveAttribute('open', /.*/u);
    await expect(dialog).not.toHaveAttribute('data-ak-leaving', /.*/u);
    await expect(opener).toBeFocused();
  });

  test('the dialog exits before closing and focus returns to its opener', async ({ page }) => {
    await open(page);
    const opener = block(page, 'open-confirm');
    const dialog = page.locator('dialog[data-ak-id="confirm-dialog"]');
    await opener.click();
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog).toHaveCSS('animation-name', 'ak-m-pop-in');
    await dialog.evaluate((el) => {
      const seen: string[] = [];
      (window as unknown as { seen: string[] }).seen = seen;
      new MutationObserver(() => {
        seen.push(`${el.hasAttribute('data-ak-leaving')}:${(el as HTMLDialogElement).open}`);
      }).observe(el, { attributes: true });
    });

    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open', /.*/u);
    // The exit played while the dialog was still open, then the dialog closed.
    expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toContain(
      'true:true',
    );
    await expect(dialog).not.toHaveAttribute('data-ak-leaving', /.*/u);
    await expect(opener).toBeFocused();
  });

  test('a reopen during the exit cancels the close', async ({ page }) => {
    await open(page);
    const dialog = page.locator('dialog[data-ak-id="confirm-dialog"]');
    await block(page, 'open-confirm').click();
    await expect(dialog).toHaveAttribute('open', '');
    const leaving = await page.evaluate(() => {
      const panel = document.querySelector('dialog[data-ak-id="confirm-dialog"]') as HTMLElement;
      (panel.querySelector('[data-ak-dialog-close]') as HTMLElement).click();
      const started = panel.hasAttribute('data-ak-leaving');
      (document.querySelector('[data-ak-id="open-confirm"]') as HTMLElement).click();
      return started;
    });
    expect(leaving).toBe(true);
    await page.waitForTimeout(600);
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog).not.toHaveAttribute('data-ak-leaving', /.*/u);
  });

  test('the accordion expands smoothly and still toggles natively', async ({ page }) => {
    await open(page);
    const first = block(page, 'faq').locator('details').first();
    const wasOpen = await first.evaluate((el) => (el as HTMLDetailsElement).open);
    await first.locator('summary').click();
    await expect(first).toHaveJSProperty('open', !wasOpen);
    const transition = await first.evaluate(
      (el) => getComputedStyle(el, '::details-content').transitionProperty,
    );
    expect(transition).toContain('block-size');
  });

  test('a section opened just before printing prints at full height', async ({ page }) => {
    await open(page);
    const closed = block(page, 'faq').locator('details:not([open])').first();
    // Switch to print straight after opening: no screen transition may carry
    // over, and the section is not held at its closed height.
    await closed.evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await page.emulateMedia({ media: 'print' });
    const content = await closed.evaluate((el) => {
      const style = getComputedStyle(el, '::details-content');
      return { duration: style.transitionDuration, size: style.blockSize };
    });
    expect(content.duration).toBe('0s');
    expect(content.size).not.toBe('0px');
  });
});

test.describe('a tab marker that first shows from a hidden block', () => {
  test('snaps into place instead of growing from the corner', async ({ page }) => {
    const spec = {
      version: 1,
      meta: { title: 'Hidden tabs' },
      state: { show: 'no' },
      blocks: [
        {
          type: 'radio-group',
          id: 'show',
          label: 'Show the tabs',
          bind: 'state.show',
          options: [
            { value: 'no', label: 'Hide' },
            { value: 'yes', label: 'Show' },
          ],
        },
        {
          type: 'tabs',
          id: 'late-tabs',
          visibleWhen: { path: 'state.show', equals: 'yes' },
          items: [
            { title: 'First', text: 'One.' },
            { title: 'Second tab', text: 'Two.' },
          ],
          motion: 'tabs-slide',
        },
      ],
    };
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const file = workspace.write('motion-recipes-hidden-tabs', compile(spec).html);
    await page.goto(`file://${file}`, { waitUntil: 'load' });
    const list = block(page, 'late-tabs').locator('> [role="tablist"]');
    await expect(list).not.toHaveAttribute('data-ak-indicator', /.*/u);

    // Sample the marker on every frame after the tabs show.
    const frames = await page.evaluate(async () => {
      (document.querySelector('input[value="yes"]') as HTMLInputElement).click();
      const tablist = document.querySelector(
        '[data-ak-id="late-tabs"] > [role="tablist"]',
      ) as HTMLElement;
      const samples: { marker: number; tab: number }[] = [];
      for (let frame = 0; frame < 8; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        const tab = tablist.querySelector('[aria-selected="true"]') as HTMLElement;
        if (!tablist.hasAttribute('data-ak-indicator')) continue;
        samples.push({
          marker: Math.round(Number.parseFloat(getComputedStyle(tablist, '::before').width)),
          tab: tab.offsetWidth,
        });
      }
      return samples;
    });
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(frame.marker).toBe(frame.tab);
    await expect(list).toHaveAttribute('data-ak-indicator-live', '');
  });
});

test.describe('motion recipes under reduced and still states', () => {
  for (const [system, policy] of [
    ['reduce', 'full'],
    ['no-preference', 'reduced'],
    ['no-preference', 'none'],
  ] as const) {
    test(`system ${system} with ${policy} policy plays no recipe`, async ({ page }) => {
      await open(page, { system, policy });
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        }
      });
      const tabs = block(page, 'plan-tabs');
      await tabs.getByRole('tab', { name: 'Pricing' }).click();
      const state = await markerAndTab(page);
      expect(state.marker).toEqual(state.tab);
      expect(state.slides).toBe(false);

      await block(page, 'plan-radios').getByLabel('Annual').check();
      await expect(block(page, 'annual-callout')).toBeVisible();
      expect(await recipeAnimations(page)).toEqual([]);
      await expect(page.locator('[data-ak-entering]')).toHaveCount(0);

      const opener = block(page, 'open-confirm');
      const dialog = page.locator('dialog[data-ak-id="confirm-dialog"]');
      await opener.click();
      await expect(dialog).toHaveAttribute('open', '');
      await page.keyboard.press('Escape');
      await expect(dialog).not.toHaveAttribute('open', /.*/u);
      await expect(dialog).not.toHaveAttribute('data-ak-leaving', /.*/u);
      await expect(opener).toBeFocused();
    });
  }

  test('print shows every block at rest', async ({ page }) => {
    await open(page);
    await page.emulateMedia({ media: 'print' });
    expect(await recipeAnimations(page)).toEqual([]);
    const closed = block(page, 'faq').locator('details:not([open])').first();
    const size = await closed.evaluate((el) => getComputedStyle(el, '::details-content').blockSize);
    expect(size).not.toBe('0px');
  });
});

test.describe('motion recipes without scripts', () => {
  test.use({ javaScriptEnabled: false });

  test('content reads in full and the tab marker stays off', async ({ page }) => {
    await page.goto(`file://${artifact()}`, { waitUntil: 'load' });
    await expect(block(page, 'reveal-card')).toBeVisible();
    await expect(block(page, 'reveal-card')).toHaveCSS('opacity', '1');
    const list = block(page, 'plan-tabs').locator('> [role="tablist"]');
    await expect(list).not.toHaveAttribute('data-ak-indicator', /.*/u);
    await expect(block(page, 'plan-tabs').locator('> [role="tabpanel"]')).toHaveCount(3);
    expect(await recipeAnimations(page)).toEqual([]);
  });
});

test.describe('motion recipes on a narrow dark page', () => {
  test.use({ viewport: { width: 375, height: 812 }, colorScheme: 'dark' });

  test('the tab marker tracks a wrapped tab row', async ({ page }) => {
    await open(page);
    const tabs = block(page, 'plan-tabs');
    await tabs.scrollIntoViewIfNeeded();
    await tabs.getByRole('tab', { name: 'Frequently asked' }).click();
    await expect
      .poll(async () => {
        const state = await markerAndTab(page);
        return JSON.stringify(state.marker) === JSON.stringify(state.tab);
      })
      .toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
