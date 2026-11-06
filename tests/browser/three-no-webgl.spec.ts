import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createModelResolver } from '../../src/assets/model-assets.js';
import { createPointCloudResolver } from '../../src/assets/point-cloud-assets.js';
import { compile } from '../../src/index.js';
import { browserWorkspace } from './browser-workspace.js';
import { THREE_FIXTURES as FIXTURES } from './three-fixtures.js';

// Without WebGL 2 every 3D widget must stop at `unsupported` and leave its
// static content (table, list, image or SVG) readable.

const fixtureDir = fileURLToPath(new URL('../../fixtures/3d/', import.meta.url));
const workspace = browserWorkspace('three-no-webgl');

// Worker-scoped, so this file gets its own browser without WebGL.
test.use({ launchOptions: { args: ['--disable-webgl', '--disable-webgl2'] } });

test.describe('3d widgets without WebGL', () => {
  for (const name of FIXTURES) {
    test(`${name} reports unsupported and keeps its static content readable`, async ({ page }) => {
      const spec = readFileSync(join(fixtureDir, `${name}.yaml`), 'utf8');
      const html = compile(spec, {
        source: name,
        modelResolver: createModelResolver(fixtureDir),
        pointCloudResolver: createPointCloudResolver(fixtureDir),
      }).html;
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`file://${workspace.write(name, html)}`, { waitUntil: 'load' });

      const states = await page
        .locator('[data-ak-3d]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-ak-3d-state')));
      expect(states.length, 'mounted 3d widgets').toBeGreaterThan(0);
      expect(states).toEqual(states.map(() => 'unsupported'));

      const readable = await page.evaluate(() => {
        const visible = (el: Element) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        };
        const fallback = [...document.querySelectorAll('table, ol, ul, img, figure')].filter(
          visible,
        );
        return { text: document.body.innerText.trim().length, fallback: fallback.length };
      });
      expect(readable.text, 'visible text without WebGL').toBeGreaterThanOrEqual(80);
      expect(readable.fallback, 'visible table, list, image or figure').toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }
});
