import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('motion-recipes');

type Policy = 'full' | 'reduced' | 'none';

/** One page with every first-party recipe; tall spacers push the stagger below the fold. */
function spec(policy: Policy): string {
  return `version: 1
meta:
  title: Motion recipes
theme:
  preset: product-studio
  tokens:
    motion-policy: ${policy}
state:
  view: summary
blocks:
  - type: hero
    id: still-hero
    title: Launch update
    motion: { preset: none }
  - type: callout
    id: top-callout
    title: Shipped
    text: The release is out.
    motion: { preset: reveal-soft }
  - type: button
    id: open-dialog
    label: Open details
    on:
      click: { action: toggle, target: details }
  - type: tabs
    id: indicator-tabs
    motion: { preset: tab-indicator }
    items:
      - { title: Overview, text: First panel }
      - { title: Latency budget, text: Second panel }
      - { title: Risks, text: Third panel }
  - type: tabs
    id: fading-tabs
    motion: { preset: crossfade }
    items:
      - { title: One, text: Panel one }
      - { title: Two, text: Panel two }
  - type: accordion
    id: faq
    motion: { preset: accordion-expand }
    items:
      - { title: Why, text: Because the content height grows smoothly. }
  - type: dialog
    id: details
    title: Details
    text: The dialog rises in and sinks out.
    motion: { preset: dialog-rise }
  - type: spacer
    size: large
  - type: spacer
    size: large
  - type: spacer
    size: large
  - type: spacer
    size: large
  - type: stats
    id: below-stats
    motion: { preset: stagger }
    items:
      - { label: Revenue, value: '$120K' }
      - { label: Users, value: '4,210' }
      - { label: Churn, value: '2.1%' }
  - type: kpi
    id: below-kpi
    motion: { preset: number-tick }
    items:
      - { label: Uptime, value: '99.9%' }
  - type: kpi
    id: staggered-kpi
    motion: { preset: stagger }
    items:
      - { label: Uptime, value: '99.9%' }
      - { label: Errors, value: '0.1%' }
      - { label: Latency, value: '120ms' }
  - type: table
    id: still-table
    motion: { preset: none }
    columns: [Region, January, February, March, April, May, June, July, August, September]
    rows:
      - ['North America', '120', '130', '140', '150', '160', '170', '180', '190', '200']
      - ['Europe', '90', '95', '100', '105', '110', '115', '120', '125', '130']
`;
}

function artifact(policy: Policy): string {
  const name = `recipes-${policy}`;
  return workspace.write(name, compile(spec(policy), { source: `${name}.yaml` }).html);
}

/** A page whose only runtime is a recipe: no theme toggle, no other feature. */
function motionOnlyArtifact(): string {
  const source = `version: 1
meta:
  title: Motion only
blocks:
  - type: hero
    title: Motion only
    motion: { preset: reveal-soft }
`;
  return workspace.write(
    'recipes-motion-only',
    compile(source, { source: 'recipes-motion-only.yaml', themeToggle: false }).html,
  );
}

async function open(
  page: Page,
  { policy = 'full', reduce = false }: { policy?: Policy; reduce?: boolean } = {},
): Promise<void> {
  await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
  await page.goto(`file://${artifact(policy)}`, { waitUntil: 'load' });
}

/** Names of the recipe keyframe animations currently on the page. */
const recipeAnimations = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .map((animation) => (animation as CSSAnimation).animationName ?? '')
      .filter((name) => name.startsWith('ak-m-')),
  );

const block = (page: Page, id: string) => page.locator(`[data-ak-id="${id}"]`).first();

/** The selected tab's box and the pill's custom properties, in tablist coordinates. */
const indicator = (page: Page, id: string) =>
  page.evaluate((tabsId) => {
    const container = document.querySelector(`[data-ak-id="${tabsId}"]`) as HTMLElement;
    const list = container.querySelector('[role="tablist"]') as HTMLElement;
    const tab = container.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
    const style = getComputedStyle(list);
    const pill = getComputedStyle(list, '::before');
    return {
      ready: container.hasAttribute('data-ak-indicator'),
      x: style.getPropertyValue('--ak-ind-x').trim(),
      w: style.getPropertyValue('--ak-ind-w').trim(),
      tabX: `${tab.offsetLeft}px`,
      tabW: `${tab.offsetWidth}px`,
      tabBackground: getComputedStyle(tab).backgroundColor,
      pillBackground: pill.backgroundColor,
      pillContent: pill.content,
    };
  }, id);

test.describe('on-enter recipes', () => {
  test('blocks below the fold show their final state, then play as they scroll in', async ({
    page,
  }) => {
    await open(page);
    const stats = block(page, 'below-stats');
    // A full-page capture taken now must read completely (ADR 0002).
    expect(await stats.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(await page.screenshot({ fullPage: true })).toBeTruthy();
    await expect(stats).not.toHaveAttribute('data-ak-entered', '');
    await stats.scrollIntoViewIfNeeded();
    await expect(stats).toHaveAttribute('data-ak-entered', '');
    // The items stagger: later items start later, and at most eight offsets exist.
    const delays = await stats.evaluate((el) =>
      Array.from(el.querySelectorAll('dl > div')).map(
        (item) => getComputedStyle(item).animationDelay,
      ),
    );
    expect(delays[0]).toBe('0s');
    expect(Number.parseFloat(delays[2] ?? '0')).toBeGreaterThan(
      Number.parseFloat(delays[1] ?? '0'),
    );
    await expect.poll(() => stats.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  });

  test('a block in view on load reveals in place and settles fully visible', async ({ page }) => {
    await open(page);
    const callout = block(page, 'top-callout');
    await expect(callout).toHaveAttribute('data-ak-entered', '');
    await expect.poll(() => callout.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  });

  test('number-tick plays on the figures, not the labels', async ({ page }) => {
    await open(page);
    const kpi = block(page, 'below-kpi');
    await kpi.scrollIntoViewIfNeeded();
    await expect(kpi).toHaveAttribute('data-ak-entered', '');
    const names = await kpi.evaluate((el) =>
      el
        .getAnimations({ subtree: true })
        .map((animation) => (animation as CSSAnimation).animationName),
    );
    expect(names).toContain('ak-m-tick');
  });

  test('a preset replaces the built-in entrance, so it cannot start early', async ({ page }) => {
    await open(page);
    const kpi = block(page, 'staggered-kpi');
    // Just inside the built-in observer's margin, outside the recipe's.
    await kpi.evaluate((el) => {
      window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight + 20);
    });
    await page.waitForTimeout(200);
    expect(await kpi.getAttribute('data-ak-inview')).toBeNull();
    await kpi.scrollIntoViewIfNeeded();
    await expect(kpi).toHaveAttribute('data-ak-entered', '');
    expect(await kpi.getAttribute('data-ak-inview')).toBeNull();
    const names = await kpi.evaluate((el) =>
      el
        .getAnimations({ subtree: true })
        .map((animation) => (animation as CSSAnimation).animationName),
    );
    expect(names).toContain('ak-m-item-in');
  });

  test('a page whose only runtime is a recipe boots without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`file://${motionOnlyArtifact()}`, { waitUntil: 'load' });
    await expect(page.locator('.ak-hero').first()).toHaveAttribute('data-ak-entered', '');
    expect(errors).toEqual([]);
  });

  for (const [label, options] of [
    ['system reduced motion', { reduce: true }],
    ['policy reduced', { policy: 'reduced' as const }],
    ['policy none', { policy: 'none' as const }],
  ] as const) {
    test(`${label}: blocks stay in their final state and no recipe animates`, async ({ page }) => {
      await open(page, options);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      for (const id of ['below-stats', 'below-kpi']) {
        await expect(block(page, id)).not.toHaveAttribute('data-ak-entered', '');
        expect(await block(page, id).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      }
      await page.getByRole('tab', { name: 'Two' }).click();
      expect(await recipeAnimations(page)).toEqual([]);
    });
  }
});

test.describe('preset none', () => {
  test('stops pseudo-element motion too', async ({ page }) => {
    await open(page);
    const hero = block(page, 'still-hero');
    // The hero's aurora runs on ::before, which a plain descendant rule misses.
    expect(await hero.evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe(
      'none',
    );
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          return target instanceof Element && target.closest('[data-ak-id="still-hero"]') !== null;
        })
        .map((animation) => (animation as CSSAnimation).animationName),
    );
    expect(running).toEqual([]);
  });

  test('keeps the scroll-position shade on an overflowing table', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    const shade = await block(page, 'still-table').evaluate((el) => {
      const wrap = el.querySelector('.ak-table-wrap') ?? el.closest('.ak-table-wrap');
      if (!(wrap instanceof HTMLElement)) return 'missing';
      if (wrap.scrollWidth <= wrap.clientWidth) return 'no overflow';
      if (!CSS.supports('animation-timeline', 'scroll()')) return 'unsupported';
      return getComputedStyle(wrap).backgroundSize;
    });
    expect(shade).toMatch(/14px 100%/u);
  });
});

test.describe('without scripts', () => {
  test.use({ javaScriptEnabled: false });

  test('every recipe leaves the content readable and in its final state', async ({ page }) => {
    await open(page);
    for (const id of ['below-stats', 'below-kpi', 'indicator-tabs', 'faq']) {
      const element = block(page, id);
      await expect(element).not.toHaveAttribute('data-ak-entered', '');
      expect(await element.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    }
    await expect(page.getByText('Third panel')).toBeVisible();
    await expect(page.getByText('Panel two')).toBeVisible();
  });
});

test.describe('print', () => {
  test('blocks print settled, and closed accordion sections print in full', async ({ page }) => {
    await open(page);
    const faq = page.locator('[data-ak-id="faq"] details').first();
    if ((await faq.getAttribute('open')) !== null) await faq.locator('summary').click();
    await expect(faq).not.toHaveAttribute('open', '');
    await page.emulateMedia({ media: 'print' });
    expect(await block(page, 'below-stats').evaluate((el) => getComputedStyle(el).opacity)).toBe(
      '1',
    );
    expect(await recipeAnimations(page)).toEqual([]);
    const fits = await faq.evaluate((el) => {
      const summary = el.querySelector('summary') as HTMLElement;
      const answer = el.querySelector('summary ~ *') as HTMLElement;
      return (
        el.getBoundingClientRect().height + 1 >=
        summary.getBoundingClientRect().height + answer.getBoundingClientRect().height
      );
    });
    expect(fits).toBe(true);
  });
});

test.describe('tab indicator', () => {
  test('follows keyboard selection and keeps roving focus', async ({ page }) => {
    await open(page);
    await expect.poll(async () => (await indicator(page, 'indicator-tabs')).ready).toBe(true);
    const first = await indicator(page, 'indicator-tabs');
    expect(first.x).toBe(first.tabX);
    expect(first.w).toBe(first.tabW);
    // The pill carries the surface, so the selected tab drops its own.
    await expect
      .poll(async () => (await indicator(page, 'indicator-tabs')).tabBackground)
      .toBe('rgba(0, 0, 0, 0)');

    await page.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Latency budget' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Latency budget' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect
      .poll(async () => {
        const state = await indicator(page, 'indicator-tabs');
        return state.x === state.tabX && state.w === state.tabW;
      })
      .toBe(true);

    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Risks' })).toBeFocused();
    await expect(page.getByText('Third panel')).toBeVisible();
    await expect
      .poll(async () => {
        const state = await indicator(page, 'indicator-tabs');
        return state.x === state.tabX;
      })
      .toBe(true);
  });

  test('rapid toggles settle on the last selection with one visible panel', async ({ page }) => {
    await open(page);
    const tabs = ['Latency budget', 'Risks', 'Overview', 'Risks', 'Latency budget'];
    for (let round = 0; round < 3; round += 1) {
      for (const name of tabs) await page.getByRole('tab', { name }).click({ delay: 0 });
    }
    await expect(page.getByRole('tab', { name: 'Latency budget' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const visible = await page
      .locator('[data-ak-id="indicator-tabs"] > [role="tabpanel"]:not([hidden])')
      .count();
    expect(visible).toBe(1);
    await expect
      .poll(async () => {
        const state = await indicator(page, 'indicator-tabs');
        return state.x === state.tabX && state.w === state.tabW;
      })
      .toBe(true);
  });

  test('crossfade plays on a tab change but not on load', async ({ page }) => {
    await open(page);
    await page.waitForTimeout(200);
    expect(await recipeAnimations(page)).not.toContain('ak-m-fade-in');
    await expect(page.locator('[data-ak-entering]')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Two' }).click();
    const panel = page.locator('[data-ak-id="fading-tabs"] > [role="tabpanel"]').nth(1);
    await expect(panel).toHaveAttribute('data-ak-entering', '');
    expect(await recipeAnimations(page)).toContain('ak-m-fade-in');
    await expect(page.getByText('Panel two')).toBeVisible();
    // Back and forth quickly: one panel shows, and it settles fully opaque.
    for (const name of ['One', 'Two', 'One', 'Two', 'One']) {
      await page.getByRole('tab', { name }).click({ delay: 0 });
    }
    await expect(
      page.locator('[data-ak-id="fading-tabs"] > [role="tabpanel"]:not([hidden])'),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        page
          .locator('[data-ak-id="fading-tabs"] > [role="tabpanel"]')
          .first()
          .evaluate((el) => getComputedStyle(el).opacity),
      )
      .toBe('1');
  });

  test.describe('dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('the pill takes the dark surface', async ({ page }) => {
      await open(page);
      await expect.poll(async () => (await indicator(page, 'indicator-tabs')).ready).toBe(true);
      const surface = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--ak-color-surface)';
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
      const state = await indicator(page, 'indicator-tabs');
      expect(state.pillBackground).toBe(surface);
      expect(state.pillContent).toBe('""');
    });
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });

    test('the pill matches the selected tab and nothing overflows', async ({ page }) => {
      await open(page);
      await page.getByRole('tab', { name: 'Risks' }).tap();
      await expect
        .poll(async () => {
          const state = await indicator(page, 'indicator-tabs');
          return state.ready && state.x === state.tabX && state.w === state.tabW;
        })
        .toBe(true);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});

test.describe('dialog exit', () => {
  test('sinks away, then closes and returns focus to the opener', async ({ page }) => {
    await open(page);
    const opener = page.getByRole('button', { name: 'Open details' });
    const dialog = page.locator('dialog[data-ak-id="details"]');
    await opener.click();
    await expect(dialog).toHaveAttribute('open', '');
    await dialog.getByRole('button', { name: 'Close' }).click();
    // Still open while it exits.
    await expect(dialog).toHaveAttribute('data-ak-closing', '');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(dialog).not.toHaveAttribute('data-ak-closing', '');
    await expect(opener).toBeFocused();
  });

  test('Escape exits the same way and restores focus', async ({ page }) => {
    await open(page);
    const opener = page.getByRole('button', { name: 'Open details' });
    const dialog = page.locator('dialog[data-ak-id="details"]');
    await opener.click();
    await expect(dialog).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveAttribute('data-ak-closing', '');
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(opener).toBeFocused();
  });

  test('reopening mid-exit keeps the dialog open, and close fires once', async ({ page }) => {
    await open(page);
    const opener = page.getByRole('button', { name: 'Open details' });
    const dialog = page.locator('dialog[data-ak-id="details"]');
    await page.evaluate(() => {
      const target = document.querySelector('dialog[data-ak-id="details"]') as HTMLDialogElement;
      (window as unknown as { closes: number }).closes = 0;
      (window as unknown as { opens: number }).opens = 0;
      target.addEventListener('close', () => {
        (window as unknown as { closes: number }).closes += 1;
      });
      // Count the dialog's open event through a binding the runtime reads.
      target.setAttribute(
        'data-ak-on-open',
        JSON.stringify([{ action: 'copy', target: 'details' }]),
      );
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => {
            (window as unknown as { opens: number }).opens += 1;
            return Promise.resolve();
          },
        },
      });
    });
    await opener.click();
    await page.evaluate(() => {
      const target = document.querySelector('dialog[data-ak-id="details"]') as HTMLDialogElement;
      const close = target.querySelector('[data-ak-dialog-close]') as HTMLButtonElement;
      // Close twice, then reopen during the exit.
      close.click();
      close.click();
      (document.querySelector('[data-ak-id="open-dialog"]') as HTMLElement).click();
    });
    await page.waitForTimeout(800);
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog).not.toHaveAttribute('data-ak-closing', '');
    expect(await page.evaluate(() => (window as unknown as { closes: number }).closes)).toBe(0);
    // It never closed, so it announced opening only once.
    expect(await page.evaluate(() => (window as unknown as { opens: number }).opens)).toBe(1);
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(dialog).not.toHaveAttribute('open', '');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { closes: number }).closes)).toBe(1);
    await expect(opener).toBeFocused();
  });

  test('closes even when animationend never fires', async ({ page }) => {
    await open(page);
    const opener = page.getByRole('button', { name: 'Open details' });
    const dialog = page.locator('dialog[data-ak-id="details"]');
    await opener.click();
    await page.evaluate(() => {
      const target = document.querySelector('dialog[data-ak-id="details"]') as HTMLDialogElement;
      (target.querySelector('[data-ak-dialog-close]') as HTMLButtonElement).click();
      // A stalled exit: the animation never ends, so neither does animationend.
      for (const animation of target.getAnimations()) animation.pause();
    });
    await expect(dialog).toHaveAttribute('data-ak-closing', '');
    await expect(dialog).not.toHaveAttribute('open', '', { timeout: 2000 });
    await expect(opener).toBeFocused();
  });

  test('closes at once in a backgrounded document', async ({ page }) => {
    await open(page);
    const dialog = page.locator('dialog[data-ak-id="details"]');
    await page.getByRole('button', { name: 'Open details' }).click();
    const closedAtOnce = await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      const target = document.querySelector('dialog[data-ak-id="details"]') as HTMLDialogElement;
      (target.querySelector('[data-ak-dialog-close]') as HTMLButtonElement).click();
      return !target.open;
    });
    expect(closedAtOnce).toBe(true);
    await expect(dialog).not.toHaveAttribute('data-ak-closing', '');
  });

  test('closes at once under reduced motion', async ({ page }) => {
    await open(page, { reduce: true });
    const opener = page.getByRole('button', { name: 'Open details' });
    await opener.click();
    const closedAtOnce = await page.evaluate(() => {
      const target = document.querySelector('dialog[data-ak-id="details"]') as HTMLDialogElement;
      (target.querySelector('[data-ak-dialog-close]') as HTMLButtonElement).click();
      return !target.open;
    });
    expect(closedAtOnce).toBe(true);
    await expect(opener).toBeFocused();
  });

  test('a toggle action on an open dialog closes it', async ({ page }) => {
    await open(page, { policy: 'none' });
    const dialog = page.locator('dialog[data-ak-id="details"]');
    await page.getByRole('button', { name: 'Open details' }).click();
    await expect(dialog).toHaveAttribute('open', '');
    await page.evaluate(() => {
      const opener = document.querySelector('[data-ak-id="open-dialog"]') as HTMLElement;
      opener.click();
    });
    await expect(dialog).not.toHaveAttribute('open', '');
  });
});

test.describe('accordion expand', () => {
  test('grows to its content height, and is instant under reduced motion', async ({ page }) => {
    await open(page);
    const details = page.locator('[data-ak-id="faq"] details').first();
    const supported = await page.evaluate(() => CSS.supports('interpolate-size', 'allow-keywords'));
    if ((await details.getAttribute('open')) !== null) await details.locator('summary').click();
    await expect(details).not.toHaveAttribute('open', '');
    // Open and read the animations in one task, so a busy machine cannot let
    // the transition finish before it is observed.
    const transitions = await details.evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
      return el.getAnimations({ subtree: true }).map((animation) => animation.constructor.name);
    });
    await expect(details).toHaveAttribute('open', '');
    if (supported) expect(transitions).toContain('CSSTransition');
    await expect(details.getByText('Because the content height grows smoothly.')).toBeVisible();

    await open(page, { reduce: true });
    const still = page.locator('[data-ak-id="faq"] details').first();
    if ((await still.getAttribute('open')) !== null) await still.locator('summary').click();
    await still.locator('summary').click();
    const running = await still.evaluate((el) => el.getAnimations({ subtree: true }).length);
    expect(running).toBe(0);
  });
});
