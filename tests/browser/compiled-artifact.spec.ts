import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { startNetworkAudit } from './network-audit.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const assetsDir = fileURLToPath(new URL('../../fixtures/assets', import.meta.url));
const fixtures = readdirSync(pagesDir).filter((name) => name.endsWith('.yaml'));

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-artifacts-'));

// Local assets are referenced relatively, so they must exist beside the emitted
// artifact for an offline load to be complete. Rebuilt on demand because a
// retry or a parallel worker may have cleaned up an earlier copy.
function ensureWorkspace(): string {
  mkdirSync(workspace, { recursive: true });
  cpSync(assetsDir, join(workspace, 'assets'), { recursive: true, force: true });
  return workspace;
}

ensureWorkspace();

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

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
      const target = join(ensureWorkspace(), fixture.replace(/\.yaml$/u, '.html'));
      writeFileSync(target, result.html, 'utf8');

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
    const target = join(ensureWorkspace(), 'interactive-actions.html');
    writeFileSync(target, compile(source).html, 'utf8');
    await page.goto(`file://${target}`, { waitUntil: 'load' });

    const toggle = page.locator('[data-ak-theme-toggle]');
    const before = await page.locator('html').getAttribute('data-theme');
    await toggle.click();
    const after = await page.locator('html').getAttribute('data-theme');
    expect(after).not.toBe(before);
    expect(await toggle.getAttribute('aria-pressed')).toBe(String(after === 'dark'));
  });

  test('a copy and download binding reaches the runtime without page-authored script', async ({
    page,
  }) => {
    const source = readFileSync(`${pagesDir}/interactive.yaml`, 'utf8');
    const target = join(ensureWorkspace(), 'interactive-copy.html');
    writeFileSync(target, compile(source).html, 'utf8');
    await page.goto(`file://${target}`, { waitUntil: 'load' });

    const scripts = await page.locator('script').count();
    expect(scripts).toBe(1);
    await expect(page.locator('[data-ak-id="copy-spec"]')).toHaveCount(1);
  });
});
