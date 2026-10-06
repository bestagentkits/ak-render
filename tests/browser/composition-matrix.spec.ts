import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import type { JsonValue } from '../../src/json.js';
import { compile } from '../../src/render/render.js';
import { evaluateCondition } from '../../src/spec/conditions.js';
import { normalize } from '../../src/spec/normalize.js';
import { browserWorkspace } from './browser-workspace.js';
import { startNetworkAudit } from './network-audit.js';

/**
 * Composition matrix: every fixture page, checked for the properties every
 * compiled page owes its reader, whatever blocks it composes. Each fixture is
 * its own describe block, so the suite shards by fixture across workers, and
 * each worker compiles a fixture once and reuses the HTML for every check.
 */

const fixturesDir = fileURLToPath(new URL('../../fixtures', import.meta.url));
const pagesDir = join(fixturesDir, 'pages');
const FIXTURES = readdirSync(pagesDir)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => name.slice(0, -'.yaml'.length))
  .sort();

const WIDTHS = [320, 375, 768, 1440] as const;
const SCHEMES = ['light', 'dark'] as const;

// Fixtures reference `assets/…` relatively, so the assets sit beside the pages.
const workspace = browserWorkspace('matrix', { assets: true });
const compiled = new Map<string, string>();

function source(name: string): string {
  return readFileSync(join(pagesDir, `${name}.yaml`), 'utf8');
}

/** The compiled fixture's file URL; the fixture compiles at most once per worker. */
function pageUrl(name: string): string {
  let html = compiled.get(name);
  if (html === undefined) {
    html = compile(source(name), { source: `${name}.yaml` }).html;
    compiled.set(name, html);
  }
  return `file://${workspace.write(name, html)}`;
}

/** Item titles of the disclosure blocks, which must read without scripts. */
function disclosureTitles(name: string): string[] {
  const titles: string[] = [];
  for (const node of normalize(source(name)).nodes) {
    if (!['tabs', 'accordion', 'carousel'].includes(node.type)) continue;
    const items = node.props.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const title = item.title;
        if (typeof title === 'string') titles.push(title);
      }
    }
  }
  return titles;
}

/** How many `visibleWhen` views the initial state shows. */
function initialViews(name: string): { shown: number; hidden: number } {
  const ir = normalize(source(name));
  const state = ir.state as Record<string, JsonValue>;
  let shown = 0;
  let hidden = 0;
  for (const node of ir.nodes) {
    if (node.when === undefined) continue;
    if (evaluateCondition(node.when, state)) shown += 1;
    else hidden += 1;
  }
  return { shown, hidden };
}

/** Collapse whitespace the way rendered text does, for substring checks. */
function flat(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

async function open(page: Page, name: string): Promise<() => { external: string[] }> {
  const audit = startNetworkAudit(page);
  await page.goto(pageUrl(name), { waitUntil: 'load' });
  return audit;
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function withContext<T>(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0],
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext(options);
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

/**
 * Marks every element a keyboard user should reach with Tab, and returns the
 * count. A radio group is one stop (its checked radio, else its first).
 */
async function markTabStops(page: Page): Promise<number> {
  return page.evaluate(() => {
    const selector =
      'a[href],button,input,select,textarea,summary,[tabindex],audio[controls],video[controls]';
    const seenRadioGroups = new Set<string>();
    let count = 0;
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (element.tabIndex < 0) continue;
      if ((element as HTMLButtonElement).disabled) continue;
      if (element.closest('[inert],[hidden]')) continue;
      if (!element.checkVisibility({ visibilityProperty: true })) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (element instanceof HTMLInputElement && element.type === 'radio') {
        const group = element.name;
        const members = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            `input[type="radio"][name="${CSS.escape(group)}"]`,
          ),
        );
        const stop = members.find((member) => member.checked) ?? members[0];
        if (stop !== element || seenRadioGroups.has(group)) continue;
        seenRadioGroups.add(group);
      }
      element.setAttribute('data-matrix-stop', String(count));
      count += 1;
    }
    return count;
  });
}

type RingWindow = Window & { matrixRing?: (element: Element) => string };

/**
 * Installs `matrixRing(element)`: the outline, shadow, border and fill of an
 * element and its three nearest ancestors, so a focused control can be told
 * apart from the same control at rest wherever its ring is drawn. Installed as
 * a function value, since the page CSP forbids building code from strings.
 */
async function installRing(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as RingWindow).matrixRing = (element) => {
      const parts: string[] = [];
      let current: Element | null = element;
      for (let depth = 0; current !== null && depth < 4; depth += 1) {
        const style = getComputedStyle(current);
        const outline =
          style.outlineStyle === 'none' || Number.parseFloat(style.outlineWidth) === 0
            ? 'none'
            : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`;
        parts.push(`${outline}|${style.boxShadow}|${style.borderColor}|${style.backgroundColor}`);
        current = current.parentElement;
      }
      return parts.join('/');
    };
  });
}

test.describe.configure({ mode: 'parallel' });

for (const name of FIXTURES) {
  test.describe(name, () => {
    test('no horizontal overflow at every width, in light and dark, with zero network', async ({
      page,
    }) => {
      const audit = await open(page, name);
      for (const colorScheme of SCHEMES) {
        await page.emulateMedia({ colorScheme });
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          // Let resize listeners (table fit, carousels) settle for one frame.
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
          );
          expect(await overflow(page), `${colorScheme} at ${width}px`).toBeLessThanOrEqual(0);
        }
      }
      expect(audit().external).toEqual([]);
    });

    test('reduced motion leaves no running animation', async ({ browser }) => {
      await withContext(browser, { reducedMotion: 'reduce' }, async (page) => {
        await open(page, name);
        await expect
          .poll(
            () =>
              page.evaluate(() =>
                document
                  .getAnimations()
                  // A scroll-driven animation (the reading progress rail) only
                  // tracks the scroll position; it never moves on its own.
                  .filter(
                    (animation) =>
                      animation.playState === 'running' &&
                      animation.timeline instanceof DocumentTimeline,
                  )
                  .map((animation) =>
                    animation instanceof CSSAnimation
                      ? animation.animationName
                      : animation instanceof CSSTransition
                        ? `transition:${animation.transitionProperty}`
                        : 'script animation',
                  ),
              ),
            { timeout: 5_000, message: 'animations still running under reduced motion' },
          )
          .toEqual([]);
      });
    });

    test('reads without scripts: disclosures and the initial view are present', async ({
      browser,
    }) => {
      const titles = disclosureTitles(name);
      const views = initialViews(name);
      await withContext(browser, { javaScriptEnabled: false }, async (page) => {
        const audit = await open(page, name);
        // Disclosures are native <details>: a reader opens them without
        // scripts, outermost first, so nested panels become readable too.
        const closed = page.locator('details:not([open]) > summary').filter({ visible: true });
        for (let guard = 0; guard < 200 && (await closed.count()) > 0; guard += 1) {
          await closed.first().click();
        }
        const text = flat(await page.locator('body').innerText());
        for (const title of titles) expect(text, `title "${title}"`).toContain(flat(title));

        // Every tab panel and carousel slide renders its own text.
        const panels = await page
          .locator('[role="tabpanel"], .ak-carousel-slide')
          .evaluateAll((elements) =>
            elements.map((element) => ({
              rendered: (element as HTMLElement).innerText.replace(/\s+/gu, ' ').trim().length,
              hidden: (element as HTMLElement).closest('[hidden]') !== null,
            })),
          );
        for (const panel of panels) {
          expect(panel.hidden).toBe(false);
          expect(panel.rendered).toBeGreaterThan(0);
        }

        const shown = page.locator('.ak-when:not([hidden])');
        await expect(shown).toHaveCount(views.shown);
        await expect(page.locator('.ak-when[hidden]')).toHaveCount(views.hidden);
        for (const view of await shown.all()) {
          expect(flat(await view.innerText()).length).toBeGreaterThan(0);
        }
        expect(audit().external).toEqual([]);
      });
    });

    test('print shows every panel', async ({ page }) => {
      await open(page, name);
      await page.emulateMedia({ media: 'print' });
      const panels = await page
        .locator('[role="tabpanel"], .ak-carousel-slide, .ak-accordion > details > :not(summary)')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              visible: element.checkVisibility({ visibilityProperty: true }),
              area: rect.width * rect.height,
            };
          }),
        );
      for (const panel of panels) {
        expect(panel.visible).toBe(true);
        expect(panel.area).toBeGreaterThan(0);
      }
    });

    test('Tab reaches every control, each with a visible focus ring', async ({ page }) => {
      const audit = await open(page, name);
      const stops = await markTabStops(page);
      // Every page has at least the skip link and the theme toggle.
      expect(stops).toBeGreaterThanOrEqual(2);
      await installRing(page);
      const reached = new Map<string, string>();
      // Generous bound: a page cannot have more Tab stops than this.
      for (let press = 0; press < stops + 40 && reached.size < stops; press += 1) {
        await page.keyboard.press('Tab');
        const hit = await page.evaluate(() => {
          const active = document.activeElement;
          const stop = active?.getAttribute('data-matrix-stop');
          const ring = (window as RingWindow).matrixRing;
          if (active === null || stop === null || stop === undefined || ring === undefined) {
            return null;
          }
          return { stop, ring: ring(active) };
        });
        if (hit !== null && !reached.has(hit.stop)) reached.set(hit.stop, hit.ring);
      }
      const missed = await page.evaluate(
        (seen) =>
          Array.from(document.querySelectorAll('[data-matrix-stop]'))
            .filter((element) => !seen.includes(element.getAttribute('data-matrix-stop') ?? ''))
            .map((element) => element.outerHTML.slice(0, 120)),
        [...reached.keys()],
      );
      expect(missed).toEqual([]);

      // A focused control must look different from the same control at rest.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const resting = await page.evaluate(() => {
        const ring = (window as RingWindow).matrixRing;
        return Object.fromEntries(
          Array.from(document.querySelectorAll('[data-matrix-stop]')).map((element) => [
            element.getAttribute('data-matrix-stop') ?? '',
            ring === undefined ? '' : ring(element),
          ]),
        );
      });
      const ringless = [...reached.entries()]
        .filter(([stop, ring]) => resting[stop] === ring)
        .map(([stop]) => stop);
      expect(ringless).toEqual([]);
      expect(audit().external).toEqual([]);
    });

    test('axe finds no critical violation', async ({ page }) => {
      await open(page, name);
      const results = await new AxeBuilder({ page }).analyze();
      const critical = results.violations
        .filter((violation) => violation.impact === 'critical')
        .map((violation) => `${violation.id}: ${violation.nodes.length} node(s)`);
      expect(critical).toEqual([]);
    });
  });
}

test.describe('visibleWhen spacing', () => {
  test('a conditional view keeps the normal block gap', async ({ page }) => {
    await open(page, 'interactive-data-explorer');
    const [gap, margin] = await page.locator('[data-ak-id="latency-chart"]').evaluate((chart) => {
      // Resolve --ak-gap through a probe in the same section.
      const probe = document.createElement('div');
      probe.style.setProperty('margin-top', 'var(--ak-gap)');
      chart.closest('.ak-section')?.appendChild(probe);
      const resolved = Number.parseFloat(getComputedStyle(probe).marginTop);
      probe.remove();
      return [resolved, Number.parseFloat(getComputedStyle(chart).marginTop)];
    });
    expect(gap).toBeGreaterThan(0);
    expect(margin).toBe(gap);
  });
});
