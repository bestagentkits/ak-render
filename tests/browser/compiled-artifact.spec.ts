import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';
import { startNetworkAudit } from './network-audit.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const fixtures = readdirSync(pagesDir).filter((name) => name.endsWith('.yaml'));

// Local assets are referenced relatively, so they must exist beside the emitted
// artifact for an offline load to be complete.
const workspace = browserWorkspace('artifacts', { assets: true });

/**
 * The offline contract, observed rather than asserted: each fixture is compiled,
 * written to disk, and opened over `file://` in a real browser with the network
 * audit attached.
 */
test.describe('compiled artifacts open from disk with zero network access', () => {
  for (const fixture of fixtures) {
    test(fixture, async ({ page }) => {
      const source = readFileSync(`${pagesDir}/${fixture}`, 'utf8');
      const result = compile(source, { source: fixture });
      const target = workspace.write(fixture.replace(/\.yaml$/u, ''), result.html);

      const consoleErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));

      const audit = startNetworkAudit(page);
      await page.goto(`file://${target}`, { waitUntil: 'load' });

      expect(audit().external).toEqual([]);
      expect(await page.title()).toBe(result.ir.meta.title);
      expect(await page.locator('main').count()).toBe(1);
      expect(await page.locator('h1').count()).toBe(1);
      expect(consoleErrors).toEqual([]);
    });
  }
});

test.describe('emitted interactions work from disk', () => {
  test('theme toggle switches the document theme and persists it', async ({ page }) => {
    const source = readFileSync(`${pagesDir}/interactive.yaml`, 'utf8');
    const target = workspace.write('interactive-actions', compile(source).html);
    await page.goto(`file://${target}`, { waitUntil: 'load' });

    const toggle = page.locator('[data-ak-theme-toggle]');
    const before = await page.locator('html').getAttribute('data-theme');
    await toggle.click();
    // The switch lands inside a view transition's update callback, a frame later.
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).not.toBe(before);
    const after = await page.locator('html').getAttribute('data-theme');
    await expect(toggle).toHaveAttribute('aria-pressed', String(after === 'dark'));
  });

  test('a copy and download binding reaches the runtime without page-authored script', async ({
    page,
  }) => {
    const source = readFileSync(`${pagesDir}/interactive.yaml`, 'utf8');
    const target = workspace.write('interactive-copy', compile(source).html);
    await page.goto(`file://${target}`, { waitUntil: 'load' });

    const scripts = await page.locator('script').count();
    expect(scripts).toBe(1);
    await expect(page.locator('[data-ak-id="copy-spec"]')).toHaveCount(1);
  });
});
