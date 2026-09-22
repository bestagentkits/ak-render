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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile, VERSION } from '../../src/index.js';
import { startNetworkAudit } from './network-audit.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const assetsDir = fileURLToPath(new URL('../../fixtures/assets', import.meta.url));
const artifactPath = fileURLToPath(
  new URL('../../docs/artifacts/benchmark-browser.json', import.meta.url),
);
const fixtures = readdirSync(pagesDir)
  .filter((name) => name.endsWith('.yaml'))
  .sort();

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-benchmark-'));

// Fixtures reference local assets by relative path, so an offline load is only
// complete when they sit beside the emitted artifact. Without this the run
// reports missing-asset console errors that belong to the harness, not the page.
cpSync(assetsDir, join(workspace, 'assets'), { recursive: true, force: true });

/** Widths the responsive contract names. */
const WIDTHS = [375, 768, 1440] as const;

interface A11yFailure {
  rule: string;
  detail: string;
}

interface FixtureMeasurement {
  fixture: string;
  bytes: number;
  consoleErrors: string[];
  networkRequests: string[];
  externalRequests: string[];
  a11yCritical: A11yFailure[];
  overflow: { width: number; scrollWidth: number; clientWidth: number; overflows: boolean }[];
  interactions: { name: string; ok: boolean; detail: string }[];
}

function writeArtifact(measurements: FixtureMeasurement[]): void {
  const artifact = {
    artifact: 'benchmark-browser',
    producer: 'tests/browser/benchmark.spec.ts',
    measuredAt: new Date().toISOString(),
    compiler: { name: '@bestagentkits/render', version: VERSION },
    method: {
      environment: 'Playwright chromium, artifacts opened over file://',
      overflow:
        'Horizontal overflow is documentElement.scrollWidth > clientWidth + 1 at each width.',
      a11y: 'A focused set of structural checks (single h1, image alt, accessible control names, labelled inputs, heading order, landmarks, language, visible focus). Not a full WCAG audit.',
      interactions: 'Emitted controls are exercised as a reader would use them.',
    },
    widths: WIDTHS,
    fixtures: measurements,
    totals: {
      fixtures: measurements.length,
      consoleErrors: measurements.reduce((sum, entry) => sum + entry.consoleErrors.length, 0),
      externalRequests: measurements.reduce((sum, entry) => sum + entry.externalRequests.length, 0),
      a11yCritical: measurements.reduce((sum, entry) => sum + entry.a11yCritical.length, 0),
      overflowFailures: measurements.reduce(
        (sum, entry) => sum + entry.overflow.filter((row) => row.overflows).length,
        0,
      ),
      interactionFailures: measurements.reduce(
        (sum, entry) => sum + entry.interactions.filter((row) => !row.ok).length,
        0,
      ),
    },
  };
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

async function auditA11y(page: Page): Promise<A11yFailure[]> {
  return page.evaluate(() => {
    const failures: { rule: string; detail: string }[] = [];
    const accessibleName = (element: Element): string => {
      const aria = element.getAttribute('aria-label');
      if (aria !== null && aria.trim() !== '') return aria.trim();
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy !== null) {
        const target = document.getElementById(labelledBy);
        if (target !== null && (target.textContent ?? '').trim() !== '') {
          return (target.textContent ?? '').trim();
        }
      }
      return (element.textContent ?? '').trim();
    };

    const h1s = document.querySelectorAll('h1');
    if (h1s.length !== 1) failures.push({ rule: 'single-h1', detail: `${h1s.length} h1 elements` });

    if ((document.documentElement.getAttribute('lang') ?? '') === '') {
      failures.push({ rule: 'html-lang', detail: 'no lang attribute' });
    }

    if (document.querySelector('main') === null) {
      failures.push({ rule: 'main-landmark', detail: 'no main element' });
    }

    for (const image of document.querySelectorAll('img')) {
      if (!image.hasAttribute('alt')) {
        failures.push({ rule: 'image-alt', detail: image.outerHTML.slice(0, 80) });
      }
    }

    for (const control of document.querySelectorAll('button, a[href]')) {
      if (accessibleName(control) === '') {
        failures.push({ rule: 'control-name', detail: control.outerHTML.slice(0, 80) });
      }
    }

    for (const input of document.querySelectorAll('input, select, textarea')) {
      const id = input.getAttribute('id');
      const hasLabel = id !== null && document.querySelector(`label[for="${id}"]`) !== null;
      const named = accessibleName(input) !== '' || input.getAttribute('aria-label') !== null;
      if (!hasLabel && !named) {
        failures.push({ rule: 'input-label', detail: input.outerHTML.slice(0, 80) });
      }
    }

    let previous = 0;
    for (const heading of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const level = Number(heading.tagName.slice(1));
      if (previous !== 0 && level > previous + 1) {
        failures.push({
          rule: 'heading-order',
          detail: `${heading.tagName} after H${previous}: ${(heading.textContent ?? '').trim().slice(0, 40)}`,
        });
      }
      previous = level;
    }

    return failures;
  });
}

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/**
 * One serial test measures every fixture, because the artifact is the
 * deliverable: an aggregate written by whichever worker ran last would be a
 * partial measurement presented as a complete one.
 */
test('measures every fixture for browser-side gates', async ({ page }) => {
  const measurements: FixtureMeasurement[] = [];

  for (const fixture of fixtures) {
    mkdirSync(workspace, { recursive: true });
    cpSync(assetsDir, join(workspace, 'assets'), { recursive: true, force: true });
    const target = join(workspace, fixture.replace(/\.yaml$/u, '.html'));
    const result = compile(readFileSync(join(pagesDir, fixture), 'utf8'), { source: fixture });
    writeFileSync(target, result.html, 'utf8');

    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    const finishAudit = startNetworkAudit(page);
    await page.goto(`file://${target}`, { waitUntil: 'load' });

    const a11yCritical = await auditA11y(page);

    const overflow: FixtureMeasurement['overflow'] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const measured = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      overflow.push({
        width,
        scrollWidth: measured.scrollWidth,
        clientWidth: measured.clientWidth,
        overflows: measured.scrollWidth > measured.clientWidth + 1,
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    const interactions: FixtureMeasurement['interactions'] = [];

    const toggle = page.locator('[data-ak-theme-toggle]');
    if ((await toggle.count()) > 0) {
      const before = await page.locator('html').getAttribute('data-theme');
      await toggle.first().click();
      const after = await page.locator('html').getAttribute('data-theme');
      interactions.push({
        name: 'theme-toggle',
        ok: after !== before,
        detail: `${String(before)} -> ${String(after)}`,
      });
    }

    const tabs = page.locator('[role="tab"]');
    if ((await tabs.count()) > 0) {
      await tabs.first().focus();
      await page.keyboard.press('ArrowRight');
      const selected = await page
        .locator('[role="tab"][aria-selected="true"]')
        .first()
        .textContent();
      interactions.push({
        name: 'tabs-keyboard',
        ok: selected !== null,
        detail: `selected ${String(selected).trim()}`,
      });
    }

    const slider = page.locator('input[type="range"]');
    if ((await slider.count()) > 0) {
      await slider.first().focus();
      await page.keyboard.press('ArrowRight');
      const value = await slider.first().inputValue();
      interactions.push({ name: 'slider-keyboard', ok: value !== '', detail: `value ${value}` });
    }

    const carouselNext = page.locator('[data-ak-carousel="next"]');
    if ((await carouselNext.count()) > 0) {
      const statusBefore = await page.locator('[data-ak-carousel-status]').first().textContent();
      await carouselNext.first().click();
      const statusAfter = await page.locator('[data-ak-carousel-status]').first().textContent();
      interactions.push({
        name: 'carousel-next',
        ok: statusAfter !== statusBefore,
        detail: `${String(statusBefore)} -> ${String(statusAfter)}`,
      });
    }

    const audit = finishAudit();

    measurements.push({
      fixture,
      bytes: result.bytes,
      consoleErrors,
      networkRequests: audit.requests,
      externalRequests: audit.external,
      a11yCritical,
      overflow,
      interactions,
    });

    expect(consoleErrors, `${fixture} console errors`).toEqual([]);
    expect(audit.external, `${fixture} external requests`).toEqual([]);
    expect(a11yCritical, `${fixture} a11y failures`).toEqual([]);
    expect(
      overflow.filter((row) => row.overflows),
      `${fixture} horizontal overflow`,
    ).toEqual([]);
    expect(
      interactions.filter((row) => !row.ok),
      `${fixture} interaction failures`,
    ).toEqual([]);

    page.removeAllListeners('console');
    page.removeAllListeners('pageerror');
  }

  writeArtifact(measurements);
  expect(measurements.length).toBe(fixtures.length);
});
