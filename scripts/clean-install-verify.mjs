#!/usr/bin/env node
/**
 * Clean-install verification.
 *
 * Packs the real tarball, installs it into a throwaway consumer project, and
 * verifies the promise a published version makes:
 *
 *   1. the installed CLI compiles a JSON Page Spec and a YAML Page Spec;
 *   2. the installed output is byte-identical to this checkout's compiler;
 *   3. the artifact opens over `file://` in a real browser;
 *   4. it issues zero external network requests.
 *
 * Steps 3 and 4 need Playwright's chromium. When the browser is unavailable the
 * script fails rather than silently skipping the offline claim.
 *
 * Usage: node scripts/clean-install-verify.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'ak-render-clean-install-'));

function fail(message) {
  console.error(`clean-install-verify FAILED: ${message}`);
  rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

const JSON_SPEC = {
  version: 1,
  meta: { title: 'Clean install JSON', description: 'Compiled by an installed package.' },
  blocks: [
    { type: 'hero', title: 'Clean install JSON' },
    { type: 'stats', items: [{ label: 'Input', value: 'JSON' }] },
    {
      type: 'chart',
      kind: 'bar',
      title: 'Values',
      labels: ['a', 'b'],
      series: [{ label: 'Series', values: [1, 2] }],
    },
  ],
};

const YAML_SPEC = `version: 1
meta:
  title: Clean install YAML
  description: Compiled by an installed package.
blocks:
  - type: hero
    title: Clean install YAML
  - type: stats
    items:
      - label: Input
        value: YAML
  - type: chart
    kind: line
    title: Values
    labels: [a, b]
    series:
      - label: Series
        values: [3, 4]
`;

/** External references a default artifact must never contain. */
const EXTERNAL_MARKERS = [
  { pattern: /@font-face/iu, label: '@font-face' },
  { pattern: /fonts\.googleapis|fonts\.gstatic/iu, label: 'Google Fonts' },
  { pattern: /@import\s+url/iu, label: '@import url(...)' },
  { pattern: /\ssrc="https?:/iu, label: 'remote src' },
  { pattern: /\shref="https?:/iu, label: 'remote href' },
  { pattern: /cdn\./iu, label: 'CDN reference' },
];

try {
  for (const required of ['dist/index.js', 'dist/cli.js']) {
    if (!existsSync(join(repoRoot, required))) {
      fail(`${required} is missing; run "pnpm build" before this check`);
    }
  }

  // --- pack and install into a clean project ------------------------------
  const packOutput = run('npm', ['pack', '--json', '--pack-destination', workspace], {
    cwd: repoRoot,
  });
  const [packed] = JSON.parse(packOutput);
  if (!packed) fail('npm pack produced no result');
  const tarball = join(workspace, packed.filename);

  const consumer = join(workspace, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'clean-install-consumer', private: true, version: '1.0.0' }, null, 2)}\n`,
    'utf8',
  );
  run('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: consumer });

  const bin = join(consumer, 'node_modules/.bin/ak-render');
  if (!existsSync(bin)) fail('the installed package exposes no ak-render bin');

  writeFileSync(join(consumer, 'spec.json'), `${JSON.stringify(JSON_SPEC, null, 2)}\n`, 'utf8');
  writeFileSync(join(consumer, 'spec.yaml'), YAML_SPEC, 'utf8');

  // --- compile both input formats with the installed CLI ------------------
  run(bin, ['compile', 'spec.json', '--out', 'out-json.html'], { cwd: consumer });
  run(bin, ['compile', 'spec.yaml', '--out', 'out-yaml.html'], { cwd: consumer });

  const installedJson = readFileSync(join(consumer, 'out-json.html'), 'utf8');
  const installedYaml = readFileSync(join(consumer, 'out-yaml.html'), 'utf8');

  for (const [label, html] of [
    ['JSON', installedJson],
    ['YAML', installedYaml],
  ]) {
    if (!html.startsWith('<!DOCTYPE html>')) fail(`${label} output is not a complete document`);
    for (const marker of EXTERNAL_MARKERS) {
      if (marker.pattern.test(html)) fail(`${label} output contains a ${marker.label} reference`);
    }
  }

  // --- parity: the installed copy must match this checkout ---------------
  const { compile, VERSION } = await import(new URL('../dist/index.js', import.meta.url));
  if (installedJson !== compile(JSON_SPEC).html) fail('installed JSON output differs from local');
  if (installedYaml !== compile(YAML_SPEC).html) fail('installed YAML output differs from local');

  // --- open over file:// and assert zero external requests ---------------
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(`file://${join(consumer, 'out-json.html')}`, { waitUntil: 'load' });
    const external = requests.filter((url) => {
      try {
        return !['file:', 'data:', 'about:', 'blob:'].includes(new URL(url).protocol);
      } catch {
        return true;
      }
    });
    if (external.length > 0) fail(`the artifact requested ${external.join(', ')}`);
    const headings = await page.locator('h1').count();
    if (headings !== 1) fail(`expected exactly one h1, found ${headings}`);
  } finally {
    await browser.close();
  }

  console.log(
    `clean-install-verify OK: @bestagentkits/render@${VERSION} installed from ${packed.filename}; JSON and YAML compiled, byte-identical to local, opened over file:// with 0 external requests`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
