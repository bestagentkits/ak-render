#!/usr/bin/env node
/**
 * Site images.
 *
 * Rasterizes `site/public/favicon.svg` into the PNG icons browsers and home
 * screens ask for, and renders the social card (`og-card.png`, 1200×630) from
 * a Page Spec compiled by the built package, so the card uses the landing's
 * own theme and fonts. Outputs are committed under `site/public/`; rerun after
 * the mark or the landing headline changes.
 *
 * Needs a built package (`pnpm build`) and the Playwright Chromium install.
 * Usage:
 *   node scripts/generate-site-images.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(repoRoot, 'site/public');

let compile;
try {
  ({ compile } = await import(new URL('../dist/index.js', import.meta.url)));
} catch {
  console.error('generate-site-images: dist/ is missing; run "pnpm build" first');
  process.exit(1);
}

const ICONS = [
  ['favicon-32.png', 32],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

/** The card is a one-hero page in the landing's preset, framed at 1200×630. */
const CARD_SPEC = {
  version: 1,
  meta: { title: 'AK Render social card', locale: 'en' },
  theme: { preset: 'blueprint' },
  blocks: [
    {
      type: 'hero',
      eyebrow: 'Open source · MIT · render.agentkit.best',
      title: 'Your agent writes YAML. The compiler ships HTML.',
      description:
        'AK Render turns a short **Page Spec** into one deterministic, offline, self-contained HTML file.',
      align: 'center',
    },
  ],
};

// Only the screenshot hides the page chrome; the compiled card stays untouched.
const CARD_CHROME = `
.ak-page-bar,.ak-skip,.ak-progress-rail,.ak-colophon{display:none!important}
html,body{height:100%;overflow:hidden}
.ak-shell{height:100%;min-height:0!important;padding:0 64px!important;display:flex!important;flex-direction:column}
.ak-shell>main{flex:1;min-height:0;display:flex!important;align-items:center;justify-content:center;padding:0!important;margin:0!important}
.ak-hero{padding:0!important}
.ak-hero h1{max-width:16ch}
`;

const browser = await chromium.launch();
try {
  const svg = readFileSync(join(publicDir, 'favicon.svg'), 'utf8');
  for (const [name, size] of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({ path: join(publicDir, name), omitBackground: true });
    await page.close();
    console.log(`  ${name}: ${size}×${size}`);
  }

  const { html } = compile(CARD_SPEC, { source: 'site-card' });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    bypassCSP: true,
  });
  const card = await context.newPage();
  await card.setContent(html, { waitUntil: 'load' });
  await card.addStyleTag({ content: CARD_CHROME });
  await card.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: join(publicDir, 'og-card.png') });
  await context.close();
  console.log('  og-card.png: 1200×630');
} finally {
  await browser.close();
}
