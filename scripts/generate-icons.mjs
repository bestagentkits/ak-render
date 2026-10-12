#!/usr/bin/env node
/**
 * Generate `src/icons/icon-data.generated.ts` from the pinned `@iconify-json/*`
 * dev dependencies.
 *
 * Icons are imported at build time only: the compiler ships the glyphs it can
 * resolve and nothing else, so output never depends on a catalog that changes
 * outside this repository. The set is the concept map (`icon-concepts.mjs`)
 * plus a short list of extra explicit names, in the variants each pack offers.
 *
 *   node scripts/generate-icons.mjs          write the module
 *   node scripts/generate-icons.mjs --check  fail when the module is stale
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA_ICONS, ICON_CONCEPTS } from './icon-concepts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src/icons/icon-data.generated.ts');
const require = createRequire(import.meta.url);

/** Pack id, iconify prefix package, concept key, and the variants it bundles. */
const PACKS = [
  { id: 'lucide', pkg: 'lucide', key: 'l', variants: [''] },
  { id: 'phosphor', pkg: 'ph', key: 'p', variants: ['', '-bold', '-fill'] },
  { id: 'tabler', pkg: 'tabler', key: 't', variants: [''] },
  { id: 'pixelarticons', pkg: 'pixelarticons', key: 'x', variants: [''] },
  { id: 'codicons', pkg: 'codicon', key: 'c', variants: [''] },
];

const errors = [];
const fail = (message) => errors.push(message);

function loadPack(pack) {
  const icons = require(`@iconify-json/${pack.pkg}/icons.json`);
  const info = require(`@iconify-json/${pack.pkg}/info.json`);
  const manifest = JSON.parse(
    readFileSync(require.resolve(`@iconify-json/${pack.pkg}/package.json`), 'utf8'),
  );
  return { icons, info, version: manifest.version };
}

/** An icon entry, following a plain alias (no rotate/flip) to its parent. */
function entryOf(source, name) {
  const direct = source.icons.icons[name];
  if (direct !== undefined) return direct;
  const alias = source.icons.aliases?.[name];
  if (alias === undefined) return undefined;
  const { parent, ...transform } = alias;
  if (Object.keys(transform).length > 0) return undefined;
  return source.icons.icons[parent];
}

const wanted = new Map(PACKS.map((pack) => [pack.id, new Set()]));
const concepts = [];
for (const [id, keywords, overrides] of ICON_CONCEPTS) {
  const names = {};
  for (const pack of PACKS) {
    const name = pack.key in overrides ? overrides[pack.key] : id;
    if (name === null) continue;
    names[pack.id] = name;
  }
  concepts.push({ id, keywords: keywords.split(/\s+/u), brand: overrides.brand === true, names });
}

const sources = new Map(PACKS.map((pack) => [pack.id, loadPack(pack)]));

// Resolve what each pack can supply. A concept name missing from a pack is dropped
// from the map and reported, so a stale mapping is visible instead of silent.
const missing = [];
for (const concept of concepts) {
  for (const pack of PACKS) {
    const name = concept.names[pack.id];
    if (name === undefined) continue;
    const source = sources.get(pack.id);
    if (entryOf(source, name) === undefined) {
      missing.push(`${concept.id}: ${pack.id}/${name}`);
      delete concept.names[pack.id];
      continue;
    }
    for (const variant of pack.variants) {
      if (entryOf(source, `${name}${variant}`) !== undefined)
        wanted.get(pack.id).add(`${name}${variant}`);
    }
  }
}
for (const pack of PACKS) {
  const key = pack.id;
  for (const name of EXTRA_ICONS[key] ?? []) {
    const source = sources.get(key);
    if (entryOf(source, name) === undefined) {
      fail(`extra icon ${key}/${name} does not exist in the pinned pack`);
      continue;
    }
    wanted.get(key).add(name);
  }
}

const tidy = (body) =>
  body
    .replace(/\s*\n\s*/gu, '')
    .replace(/>\s+</gu, '><')
    .replace(/\s+class="[^"]*"/gu, '')
    .trim();

const packMeta = {};
const data = {};
for (const pack of PACKS) {
  const source = sources.get(pack.id);
  const license = source.info.license ?? {};
  packMeta[pack.id] = {
    source: `@iconify-json/${pack.pkg}`,
    version: source.version,
    license: license.spdx ?? license.title ?? 'unknown',
    licenseUrl: license.url ?? '',
    author: source.info.author?.name ?? '',
    viewBox: source.icons.width ?? 16,
  };
  const size = packMeta[pack.id].viewBox;
  data[pack.id] = {};
  for (const name of [...wanted.get(pack.id)].sort()) {
    const entry = entryOf(source, name);
    const width = entry.width ?? source.icons.width ?? 16;
    const height = entry.height ?? source.icons.height ?? 16;
    if (width !== height) {
      fail(`${pack.id}/${name} is not square (${width}x${height})`);
      continue;
    }
    data[pack.id][name] = width === size ? tidy(entry.body) : [tidy(entry.body), width];
  }
}

if (missing.length > 0) {
  console.warn(`concept names missing from a pinned pack (dropped):\n  ${missing.join('\n  ')}`);
}
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const json = (value) => JSON.stringify(value, null, 2);
const output = `/**
 * Generated by \`scripts/generate-icons.mjs\`. Do not edit by hand.
 *
 * Pinned glyphs imported at build time from the \`@iconify-json/*\` packages
 * named in \`ICON_PACK_SOURCES\`. Regenerate with \`pnpm icons:generate\`.
 */

export interface GeneratedPackSource {
  /** The npm package the glyphs were imported from. */
  source: string;
  version: string;
  license: string;
  licenseUrl: string;
  author: string;
  /** Square coordinate size of a glyph that does not state its own. */
  viewBox: number;
}

/** A glyph body, or the body with its own square coordinate size. */
export type GeneratedGlyph = string | readonly [body: string, size: number];

export const ICON_PACK_SOURCES: Readonly<Record<string, GeneratedPackSource>> = ${json(packMeta)};

export const GENERATED_CONCEPTS: readonly {
  id: string;
  keywords: readonly string[];
  brand: boolean;
  names: Readonly<Record<string, string>>;
}[] = ${json(concepts)};

export const ICON_GLYPHS: Readonly<Record<string, Readonly<Record<string, GeneratedGlyph>>>> = ${json(data)};
`;

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== output) {
    console.error('src/icons/icon-data.generated.ts is stale; run `pnpm icons:generate`.');
    process.exit(1);
  }
  console.log('icon data is up to date');
} else {
  writeFileSync(target, output);
  const counts = Object.entries(data).map(([id, glyphs]) => `${id} ${Object.keys(glyphs).length}`);
  console.log(`wrote ${target} (${counts.join(', ')}; ${(output.length / 1024).toFixed(0)} KB)`);
}
