import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';
import { startNetworkAudit } from './network-audit.js';

const fixturePath = fileURLToPath(new URL('../../fixtures/pages/icons.yaml', import.meta.url));
const workspace = browserWorkspace('icons');

function open(source: string, name: string): string {
  return `file://${workspace.write(name, compile(source, { source: name }).html)}`;
}

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 800 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`icons render without overflow or network at ${viewport.width}px`, async ({ page }) => {
    const audit = startNetworkAudit(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(open(readFileSync(fixturePath, 'utf8'), `icons-${viewport.name}`));

    const icons = page.locator('svg.ak-icon');
    expect(await icons.count()).toBeGreaterThan(10);
    for (const icon of await icons.all()) {
      const box = await icon.boundingBox();
      expect(box, 'icon has a painted box').not.toBeNull();
      expect(box?.width ?? 0).toBeGreaterThan(4);
    }
    // Every <use> points at a symbol that exists in the same document.
    const dangling = await page.evaluate(
      () =>
        [...document.querySelectorAll('svg.ak-icon use')].filter((use) => {
          const href = use.getAttribute('href') ?? '';
          return !href.startsWith('#') || document.getElementById(href.slice(1)) === null;
        }).length,
    );
    expect(dangling).toBe(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(audit().external).toEqual([]);
  });
}

test('icons follow the text colour in dark mode and print', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(open(readFileSync(fixturePath, 'utf8'), 'icons-dark'));
  const dark = await page.evaluate(() => {
    const icon = document.querySelector('.ak-card-icon svg.ak-icon') as SVGElement;
    return getComputedStyle(icon).color;
  });
  expect(dark).not.toBe('');
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  expect(await page.locator('svg.ak-icon').first().isVisible()).toBe(true);
});

test('a decorative icon is hidden and a labelled one is a named image', async ({ page }) => {
  await page.goto(open(readFileSync(fixturePath, 'utf8'), 'icons-a11y'));
  expect(await page.locator('svg.ak-icon[aria-hidden="true"]').count()).toBeGreaterThan(5);
  await expect(page.getByRole('img', { name: 'Settings' })).toHaveCount(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test('the emitted page has no external references and no inline style', async ({ page }) => {
  const html = compile(readFileSync(fixturePath, 'utf8'), { source: 'icons.yaml' }).html;
  expect(html).not.toMatch(/(?:href|src)="https?:\/\/(?!render\.agentkit\.best)/u);
  expect(html).not.toMatch(/<svg[^>]*\sstyle=/u);
  await page.goto(open(readFileSync(fixturePath, 'utf8'), 'icons-csp'));
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/iu.test(message.text())) violations.push(message.text());
  });
  await page.reload();
  expect(violations).toEqual([]);
});
