#!/usr/bin/env node
/**
 * Public site build.
 *
 * Compiles `site/landing.yaml` with the built package into `site/dist/index.html`,
 * copies only the gallery assets the landing references into `site/dist/assets/`,
 * and copies the committed gallery (`docs/gallery/`) to `site/dist/gallery/`, so
 * one static directory serves the landing at `/` and the gallery at `/gallery/`.
 *
 * The landing is a Page Spec like any other: the site dogfoods the compiler.
 * Deterministic and offline: no network, no timestamps, plain static files.
 *
 * Requires a built package (`pnpm build`). Usage:
 *   node scripts/build-site.mjs
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const specPath = join(repoRoot, 'site/landing.yaml');
const galleryDir = join(repoRoot, 'docs/gallery');
const galleryAssetsDir = join(galleryDir, 'assets');
const outDir = join(repoRoot, 'site/dist');

let compile;
try {
  ({ compile } = await import(new URL('../dist/index.js', import.meta.url)));
} catch {
  console.error('build-site: dist/ is missing; run "pnpm build" first');
  process.exit(1);
}

const source = readFileSync(specPath, 'utf8');
const result = compile(source, { source: 'site/landing.yaml' });

/** Every `assets/...` string anywhere in the spec, sorted so the copy order is stable. */
function collectAssets(value, found = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('assets/')) found.add(value.slice('assets/'.length));
  } else if (Array.isArray(value)) {
    for (const item of value) collectAssets(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectAssets(item, found);
  }
  return found;
}

const assets = [...collectAssets(parse(source))].sort();
const missing = assets.filter((name) => !existsSync(join(galleryAssetsDir, name)));
if (missing.length > 0) {
  console.error(`build-site: the landing references missing assets: ${missing.join(', ')}`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'assets'), { recursive: true });
writeFileSync(join(outDir, 'index.html'), result.html, 'utf8');
for (const name of assets) {
  cpSync(join(galleryAssetsDir, name), join(outDir, 'assets', name));
}
cpSync(galleryDir, join(outDir, 'gallery'), { recursive: true });

console.log(`build-site: wrote site/dist/index.html (${result.bytes} bytes, hash ${result.hash})`);
console.log(`  assets: ${assets.length} copied to site/dist/assets/`);
console.log('  gallery: docs/gallery/ copied to site/dist/gallery/');
