import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { createModelResolver } from '../../src/assets/model-assets.js';
import { createPointCloudResolver } from '../../src/assets/point-cloud-assets.js';
import { compile } from '../../src/index.js';
import { browserWorkspace } from './browser-workspace.js';
import { THREE_FIXTURES } from './three-fixtures.js';

// Every 3D widget in light and dark at phone, tablet and desktop widths. The
// assertions are structural: no horizontal overflow, readable text, and each
// widget either drawing (`ready`, `frozen`) or showing its static plan
// (`static`). No pixel comparison.
const fixtureDir = fileURLToPath(new URL('../../fixtures/3d/', import.meta.url));
const workspace = browserWorkspace('three-matrix');

const WIDTHS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const SETTLED = ['ready', 'frozen', 'static'];

function compileFixture(name: string): string {
  const spec = readFileSync(join(fixtureDir, `${name}.yaml`), 'utf8');
  return compile(spec, {
    source: name,
    modelResolver: createModelResolver(fixtureDir),
    pointCloudResolver: createPointCloudResolver(fixtureDir),
  }).html;
}

/** Resolves once every mounted 3D widget has settled, or the budget runs out. */
async function settle(page: Page): Promise<string[]> {
  await page.waitForFunction(
    (settled: string[]) => {
      const states = [...document.querySelectorAll('[data-ak-3d]')].map((el) =>
        el.getAttribute('data-ak-3d-state'),
      );
      return (
        states.length > 0 && states.every((state) => state !== null && settled.includes(state))
      );
    },
    SETTLED,
    { timeout: 90_000 },
  );
  return page
    .locator('[data-ak-3d]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-ak-3d-state') ?? ''));
}

test.describe('3d widget matrix', { tag: '@gl' }, () => {
  for (const name of THREE_FIXTURES) {
    for (const scheme of SCHEMES) {
      for (const size of WIDTHS) {
        test(`${name} is readable at ${size.name} ${size.width}px in ${scheme}`, async ({
          browser,
        }) => {
          const context = await browser.newContext({
            viewport: { width: size.width, height: size.height },
            colorScheme: scheme,
          });
          const page = await context.newPage();
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.goto(
            `file://${workspace.write(`${name}-${scheme}-${size.width}`, compileFixture(name))}`,
            {
              waitUntil: 'load',
            },
          );

          const states = await settle(page);
          expect(states.length, 'mounted 3d widgets').toBeGreaterThan(0);
          expect(
            states.filter((state) => state === 'error'),
            'widgets in error',
          ).toEqual([]);

          const layout = await page.evaluate(() => {
            const root = document.documentElement;
            const text = document.body.innerText.trim().length;
            return { overflow: root.scrollWidth - root.clientWidth, text };
          });
          expect(layout.overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
          expect(layout.text, 'visible text').toBeGreaterThanOrEqual(80);
          expect(errors).toEqual([]);
          await context.close();
        });
      }
    }
  }
});
