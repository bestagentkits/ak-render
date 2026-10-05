#!/usr/bin/env node
/**
 * Demo media capture.
 *
 * Records real footage of the compiled gallery (screenshots and one short
 * walkthrough video) into `fixtures/assets/`, so the media fixtures show the
 * product itself instead of placeholder art. Nothing here is stock imagery: every
 * frame is an artifact this repository compiled.
 *
 * Not part of the deterministic build. The outputs are committed binaries; run
 * this by hand after a visible design change, then regenerate the gallery.
 *
 * Requires: a built gallery (`pnpm gallery:generate`), Playwright's Chromium,
 * `cwebp` and `ffmpeg` on PATH.
 *
 * Usage:
 *   node scripts/capture-demo-media.mjs [--only shot-recap,crop-kpi]
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const galleryDir = join(repoRoot, 'docs/gallery');
const assetsDir = join(repoRoot, 'fixtures/assets');
const scratch = mkdtempSync(join(tmpdir(), 'ak-demo-media-'));

const VIEWPORT = { width: 1440, height: 900 };

/** Page, color scheme, and the asset name each still is saved under. */
const STILLS = [
  { page: 'explain.html', scheme: 'light', name: 'shot-explain-light' },
  { page: 'explain.html', scheme: 'dark', name: 'shot-explain-dark' },
  { page: 'dashboard.html', scheme: 'light', name: 'shot-dashboard' },
  { page: 'dashboard.html', scheme: 'dark', name: 'shot-dashboard-dark' },
  { page: 'diff.html', scheme: 'dark', name: 'shot-diff' },
  { page: 'plan.html', scheme: 'light', name: 'shot-plan' },
  { page: 'index.html', scheme: 'light', name: 'shot-gallery' },
  { page: 'all-components.html', scheme: 'light', name: 'shot-components' },
  { page: 'showcase.html', scheme: 'light', name: 'shot-showcase' },
  { page: 'showcase.html', scheme: 'dark', name: 'shot-showcase-dark' },
  { page: 'brainstorm.html', scheme: 'light', name: 'shot-brainstorm' },
  { page: 'recap.html', scheme: 'dark', name: 'shot-recap' },
  { page: 'interactive.html', scheme: 'light', name: 'shot-interactive' },
  { page: 'media.html', scheme: 'light', name: 'shot-media' },
  { page: 'theme-showcase.html', scheme: 'light', name: 'shot-theme-showcase' },
];

/**
 * Element-level crops for tiles: one component at its own border, rendered at
 * 2x, so a tile shows a detail of a real page at full sharpness.
 */
const CROPS = [
  { page: 'dashboard.html', scheme: 'light', selector: '.ak-chart', name: 'crop-chart' },
  {
    page: 'dashboard.html',
    scheme: 'dark',
    selector: '.ak-chart:has(.ak-chart-slice)',
    name: 'crop-donut',
  },
  { page: 'diff.html', scheme: 'dark', selector: '.ak-compare', name: 'crop-compare' },
  { page: 'plan.html', scheme: 'light', selector: '.ak-timeline', name: 'crop-timeline' },
  { page: 'plan.html', scheme: 'light', selector: '.ak-diagram', name: 'crop-diagram' },
  { page: 'showcase.html', scheme: 'light', selector: '.ak-kpis', name: 'crop-kpi' },
  { page: 'showcase.html', scheme: 'dark', selector: '.ak-terminal', name: 'crop-terminal' },
  { page: 'showcase.html', scheme: 'light', selector: '.ak-checklist', name: 'crop-checklist' },
  { page: 'showcase.html', scheme: 'dark', selector: '.ak-tree-block', name: 'crop-file-tree' },
];

/**
 * `--only a,b` captures just the named stills and crops and skips the
 * walkthrough, so adding one asset does not re-encode every committed binary.
 */
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex === -1 ? undefined : new Set((process.argv[onlyIndex + 1] ?? '').split(','));
const wanted = (entry) => only === undefined || only.has(entry.name);

function pageUrl(name) {
  return pathToFileURL(join(galleryDir, name)).href;
}

function toWebp(png, name, width = 1200) {
  const out = join(assetsDir, `${name}.webp`);
  execFileSync('cwebp', [
    '-quiet',
    '-q',
    '78',
    '-m',
    '6',
    '-resize',
    String(width),
    '0',
    png,
    '-o',
    out,
  ]);
  return out;
}

async function captureCrops(browser) {
  for (const crop of CROPS.filter(wanted)) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      colorScheme: crop.scheme,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(pageUrl(crop.page));
    const target = page.locator(crop.selector).first();
    await target.scrollIntoViewIfNeeded();
    // Let entrance and count-up animations settle before the shot.
    await page.waitForTimeout(1800);
    const png = join(scratch, `${crop.name}.png`);
    await target.screenshot({ path: png });
    console.log(`  ${toWebp(png, crop.name, 1000)}`);
    await context.close();
  }
}

async function captureStills(browser) {
  for (const still of STILLS.filter(wanted)) {
    const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: still.scheme });
    const page = await context.newPage();
    await page.goto(pageUrl(still.page));
    // Let the hero entrance finish so the still shows the settled page.
    await page.waitForTimeout(1200);
    const png = join(scratch, `${still.name}.png`);
    await page.screenshot({ path: png });
    console.log(`  ${toWebp(png, still.name)}`);
    await context.close();
  }
}

/** Smoothly scroll by a distance over a duration, so the recording reads as a person browsing. */
async function glide(page, distance, ms) {
  await page.evaluate(
    ([d, t]) =>
      new Promise((resolve) => {
        const start = window.scrollY;
        const began = performance.now();
        const step = (now) => {
          const p = Math.min((now - began) / t, 1);
          const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
          window.scrollTo(0, start + d * eased);
          if (p < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [distance, ms],
  );
}

async function captureWalkthrough(browser) {
  const videoDir = join(scratch, 'video');
  const size = { width: 1280, height: 800 };
  const context = await browser.newContext({
    viewport: size,
    colorScheme: 'light',
    recordVideo: { dir: videoDir, size },
  });
  const page = await context.newPage();

  // The showcase first: the hero entrance, the bento, the KPI sparklines, the
  // terminal typing in, and a drag across the before/after slider.
  await page.goto(pageUrl('showcase.html'));
  await page.waitForTimeout(1800);
  await glide(page, 560, 1500);
  await page.waitForTimeout(400);
  await glide(page, 760, 1600);
  for (const tile of await page.locator('.ak-tile').all()) {
    if (!(await tile.isVisible())) continue;
    const box = await tile.boundingBox();
    if (box === null || box.y < 0 || box.y + 40 > size.height) continue;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 10 });
  }
  await glide(page, (await page.locator('.ak-kpis').boundingBox()).y - 120, 1500);
  await page.waitForTimeout(1600);
  await glide(page, (await page.locator('.ak-terminal').boundingBox()).y - 160, 1300);
  await page.waitForTimeout(3200);
  await glide(page, (await page.locator('.ak-ba-stage').boundingBox()).y - 140, 1300);
  const stage = await page.locator('.ak-ba-stage').boundingBox();
  const middle = stage.y + Math.min(stage.height, size.height - stage.y) / 2;
  await page.mouse.move(stage.x + stage.width * 0.5, middle, { steps: 8 });
  await page.mouse.down();
  for (const ratio of [0.2, 0.82, 0.5]) {
    await page.mouse.move(stage.x + stage.width * ratio, middle, { steps: 28 });
    await page.waitForTimeout(250);
  }
  await page.mouse.up();
  await page.getByRole('button', { name: 'Toggle dark theme' }).click();
  await page.waitForTimeout(1100);
  await glide(page, -(await page.evaluate(() => window.scrollY)), 1800);
  await page.waitForTimeout(800);

  await page.goto(pageUrl('explain.html'));
  await page.waitForTimeout(1400);
  await glide(page, 520, 1400);
  for (const tab of ['Validate', 'Normalize', 'Render']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(650);
  }
  await glide(page, 620, 1600);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Toggle dark theme' }).click();
  await page.waitForTimeout(900);
  await glide(page, -1140, 1600);
  await page.waitForTimeout(600);
  await page.goto(pageUrl('dashboard.html'));
  await page.waitForTimeout(1300);
  await glide(page, 460, 1200);
  const bars = page.locator('.ak-chart-bar');
  for (let index = 0; index < Math.min(await bars.count(), 4); index += 1) {
    await bars.nth(index).hover();
    await page.waitForTimeout(450);
  }
  await glide(page, 900, 1800);
  await page.waitForTimeout(700);
  await context.close();

  const [raw] = readdirSync(videoDir);
  const source = join(videoDir, raw);
  const out = join(assetsDir, 'walkthrough.webm');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    source,
    '-vf',
    'scale=1120:-2',
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '40',
    '-row-mt',
    '1',
    '-an',
    out,
  ]);
  console.log(`  ${out}`);

  // The poster is the first settled frame, so the player shows the page before play.
  const posterPng = join(scratch, 'walkthrough-poster.png');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    '1.6',
    '-i',
    source,
    '-frames:v',
    '1',
    posterPng,
  ]);
  console.log(`  ${toWebp(posterPng, 'walkthrough-poster')}`);
}

const browser = await chromium.launch();
try {
  console.log('capture-demo-media: stills');
  await captureStills(browser);
  console.log('capture-demo-media: crops');
  await captureCrops(browser);
  if (only === undefined) {
    console.log('capture-demo-media: walkthrough');
    await captureWalkthrough(browser);
  }
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
