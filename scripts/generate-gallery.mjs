#!/usr/bin/env node
/**
 * Fixture gallery.
 *
 * Compiles every fixture and every preset snapshot into a browsable example
 * site under `docs/gallery/`, and builds the index page **with the compiler
 * itself** — the gallery is a Page Spec, not hand-written HTML, so a regression
 * that breaks a block breaks the gallery too.
 *
 * Deterministic: no timestamps and no run-dependent ordering, so `--check` can
 * fail CI when the committed gallery is stale.
 *
 * Usage:
 *   node scripts/generate-gallery.mjs [--check]
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const checkMode = process.argv.includes('--check');
const pagesDir = join(repoRoot, 'fixtures/pages');
const galleryDir = join(repoRoot, 'docs/gallery');
// The fixtures reference assets relatively, so the gallery has to carry them
// beside the pages it links, or every image in every page is a broken link.
const assetsDir = join(repoRoot, 'fixtures/assets');
const galleryAssetsDir = join(galleryDir, 'assets');

let compile;
let VERSION;
try {
  ({ compile, VERSION } = await import(new URL('../dist/index.js', import.meta.url)));
} catch {
  console.error('generate-gallery: dist/ is missing; run "pnpm build" first');
  process.exit(1);
}

const fixtures = readdirSync(pagesDir)
  .filter((name) => name.endsWith('.yaml'))
  .sort();

const written = new Map();

/** Compile one fixture and return the entry the index will link to. */
function buildFixture(fixture) {
  const source = readFileSync(join(pagesDir, fixture), 'utf8');
  const result = compile(source, { source: fixture });
  const slug = fixture.replace(/\.yaml$/u, '');
  written.set(`${slug}.html`, result.html);
  const meta = result.ir.meta;
  return {
    slug,
    file: `${slug}.html`,
    title: typeof meta.title === 'string' ? meta.title : slug,
    description: typeof meta.description === 'string' ? meta.description : '',
    bytes: result.bytes,
    hash: result.hash,
    nodes: result.ir.nodes.length,
    features: result.features,
  };
}

const entries = fixtures.map(buildFixture);

/** The index is itself a Page Spec: the gallery dogfoods the compiler. */
const indexSpec = {
  version: 1,
  meta: {
    title: 'AK Render fixture gallery',
    description: `Every fixture compiled by @bestagentkits/render@${VERSION}. Each page is a standalone artifact that opens from disk with no network.`,
  },
  theme: { preset: 'blueprint' },
  blocks: [
    {
      type: 'hero',
      eyebrow: `@bestagentkits/render@${VERSION}`,
      title: 'Fixture gallery',
      description:
        'Each artifact below was compiled from a Page Spec in fixtures/pages and opens directly from disk with zero external requests.',
    },
    {
      type: 'stats',
      items: [
        { label: 'Fixtures', value: String(entries.length) },
        { label: 'Compiler', value: VERSION },
        { label: 'Network', value: 'denied' },
      ],
    },
    {
      type: 'table',
      title: 'Fixtures',
      columns: ['Title', 'Nodes', 'Bytes'],
      rows: entries.map((entry) => [entry.title, String(entry.nodes), String(entry.bytes)]),
    },
    {
      type: 'list',
      title: 'Open a page',
      items: entries.map((entry) => ({ text: entry.file, badge: `${entry.bytes} B` })),
    },
    // One link per artifact, so the gallery is navigable without a script.
    ...entries.map((entry) => ({
      type: 'link',
      label: `${entry.title} (${entry.file})`,
      href: entry.file,
    })),
    {
      type: 'list',
      title: 'What each artifact proves',
      items: [
        {
          text: 'The catalog covers layout, content, information, collections, charts, diagrams, and media.',
        },
        { text: 'Every artifact is deterministic: the same spec yields the same bytes and hash.' },
        {
          text: 'Every artifact opens over file:// with no CDN, no font fetch, and no remote image.',
        },
        { text: 'Interactions are declarative: no page-authored script and no inline handler.' },
      ],
    },
  ],
};

const index = compile(indexSpec, { source: 'gallery-index' });
written.set('index.html', index.html);

const expected = new Map(written);

if (checkMode) {
  const problems = [];
  for (const [file, html] of expected) {
    const path = join(galleryDir, file);
    if (!existsSync(path)) {
      problems.push(`missing ${relative(repoRoot, path)}`);
      continue;
    }
    if (readFileSync(path, 'utf8') !== html) problems.push(`stale ${relative(repoRoot, path)}`);
  }
  const onDisk = existsSync(galleryDir)
    ? readdirSync(galleryDir).filter((name) => name.endsWith('.html'))
    : [];
  for (const name of onDisk) {
    if (!expected.has(name)) problems.push(`unexpected docs/gallery/${name}`);
  }
  for (const name of readdirSync(assetsDir)) {
    const source = join(assetsDir, name);
    const target = join(galleryAssetsDir, name);
    if (!existsSync(target)) {
      problems.push(`missing ${relative(repoRoot, target)}`);
      continue;
    }
    if (readFileSync(source).compare(readFileSync(target)) !== 0) {
      problems.push(`stale ${relative(repoRoot, target)}`);
    }
  }
  if (problems.length > 0) {
    console.error('generate-gallery: the committed gallery is out of date:');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('Run "pnpm gallery:generate".');
    process.exit(1);
  }
  console.log(`generate-gallery: ${expected.size} gallery pages are up to date`);
} else {
  rmSync(galleryDir, { recursive: true, force: true });
  mkdirSync(galleryDir, { recursive: true });
  for (const [file, html] of expected) {
    writeFileSync(join(galleryDir, file), html, 'utf8');
  }
  cpSync(assetsDir, galleryAssetsDir, { recursive: true });
  console.log(`generate-gallery: wrote ${expected.size} pages to docs/gallery/`);
  for (const entry of entries) {
    console.log(`  ${entry.file}: ${entry.bytes} bytes, ${entry.nodes} nodes`);
  }
  console.log(`  index.html: ${index.bytes} bytes`);
}
