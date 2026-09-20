#!/usr/bin/env node
/**
 * Package smoke test.
 *
 * Packs the real tarball, installs it into a throwaway consumer project, and
 * verifies the two promised surfaces: the library import and the CLI bin.
 * This is what proves `pnpm publish` would ship something usable rather than
 * something that merely builds.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function fail(message) {
  console.error(`package-smoke FAILED: ${message}`);
  process.exit(1);
}

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-smoke-'));

try {
  for (const required of ['dist/index.js', 'dist/cli.js', 'dist/index.d.ts']) {
    if (!existsSync(join(repoRoot, required))) {
      fail(`${required} is missing; run "pnpm build" before the package smoke test`);
    }
  }

  const packOutput = run('npm', ['pack', '--json', '--pack-destination', workspace], {
    cwd: repoRoot,
  });
  const [packed] = JSON.parse(packOutput);
  if (!packed) fail('npm pack produced no result');

  const shipped = new Set(packed.files.map((entry) => entry.path));
  for (const required of [
    'package.json',
    'dist/index.js',
    'dist/cli.js',
    'dist/index.d.ts',
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
  ]) {
    if (!shipped.has(required)) fail(`tarball is missing ${required}`);
  }
  for (const leaked of ['src/index.ts', 'tests/unit/cli.test.ts']) {
    if (shipped.has(leaked)) fail(`tarball leaks source file ${leaked}`);
  }

  const tarball = join(workspace, packed.filename);
  const consumer = join(workspace, 'consumer');
  writeFileSync(join(workspace, 'npm-init-placeholder'), '');
  run('mkdir', ['-p', consumer]);
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'ak-render-smoke-consumer', private: true, version: '0.0.0' }, null, 2)}\n`,
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', tarball], { cwd: consumer });

  const imported = run(
    'node',
    [
      '--input-type=module',
      '--eval',
      "const m = await import('@agentkit/render'); process.stdout.write(JSON.stringify({ name: m.PACKAGE_NAME, version: m.VERSION, hasError: typeof m.RenderError === 'function' }));",
    ],
    { cwd: consumer },
  );
  const api = JSON.parse(imported);
  if (api.name !== '@agentkit/render') fail(`library import resolved to "${api.name}"`);
  if (!/^\d+\.\d+\.\d+/.test(api.version)) fail(`library version "${api.version}" is not semver`);
  if (!api.hasError) fail('library import did not expose RenderError');

  const binDir = join(consumer, 'node_modules', '.bin');
  const versionOutput = run(join(binDir, 'ak-render'), ['--version'], { cwd: consumer }).trim();
  if (versionOutput !== api.version) {
    fail(`CLI version "${versionOutput}" does not match library version "${api.version}"`);
  }
  const helpOutput = run(join(binDir, 'ak-render'), ['--help'], { cwd: consumer });
  if (!helpOutput.includes('Usage:')) fail('CLI help output is missing a Usage section');

  const manifest = JSON.parse(
    readFileSync(join(consumer, 'node_modules/@agentkit/render/package.json'), 'utf8'),
  );
  if (manifest.license !== 'MIT') fail(`installed license is "${manifest.license}"`);

  console.log(
    `package-smoke OK: ${packed.filename} (${packed.size} bytes, ${packed.files.length} files) installs, imports and runs ak-render@${versionOutput}`,
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
