#!/usr/bin/env node
/**
 * Claude plugin smoke test.
 *
 * Exercises `plugins/ak-render` the way an installed plugin runs it: the
 * pinned package from the npm registry, not this checkout. It renders each
 * bundled example twice and requires identical bytes, checks the error paths
 * the skill documents, drives the MCP server over stdio, and, when the
 * `claude` CLI is on PATH, runs the directory profile of
 * `claude plugin validate`. Needs network access for the first npx download.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = join(repoRoot, 'plugins/ak-render');
const examplesDir = join(pluginDir, 'skills/ak-render/examples');
const manifest = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin/plugin.json'), 'utf8'));
const server = manifest.mcpServers['ak-render'];
const pkg = server.args.find((arg) => arg.startsWith('@bestagentkits/render@'));
const MCP_TOOLS = [
  'catalog',
  'describe',
  'recipe',
  'recipes',
  'render',
  'search-catalog',
  'themes',
  'validate',
];

// Thrown so the `finally` below still removes the temporary workspace.
class SmokeFailure extends Error {}
function fail(message) {
  throw new SmokeFailure(message);
}

// npx and claude are .cmd shims on Windows, which spawn only through a shell.
const shell = process.platform === 'win32';

function cli(args, cwd) {
  const result = spawnSync('npx', ['-y', pkg, ...args], {
    cwd,
    encoding: 'utf8',
    shell,
    timeout: 120_000,
  });
  if (result.error) fail(`could not run npx: ${result.error.message}`);
  return result;
}

function parse(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`${what} printed no JSON: ${JSON.stringify(text.slice(0, 200))}`);
  }
}

// Anything the browser would fetch: a script, stylesheet, image, srcset entry
// or CSS url() pointing at http(s). Plain <a href> links are navigation, not
// loads, so they are allowed.
const REMOTE_LOAD =
  /<(?:script|img|source|video|audio|iframe|link)\b[^>]*\s(?:src|href|srcset)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\//iu;
const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const workspace = mkdtempSync(join(tmpdir(), 'ak-render-plugin-smoke-'));
const receipt = [];

try {
  const version = cli(['--version'], workspace);
  if (version.status !== 0 || version.stdout.trim() !== pkg.split('@').at(-1)) {
    fail(`${pkg} --version printed ${JSON.stringify(version.stdout)}`);
  }

  for (const name of ['report', 'dashboard', 'architecture']) {
    const spec = join(examplesDir, `${name}.yaml`);
    const checked = cli(['validate', spec, '--json'], workspace);
    if (checked.status !== 0 || parse(checked.stdout, `validate ${name}`).ok !== true) {
      fail(`${name}.yaml does not validate: ${checked.stdout}`);
    }
    const hashes = [];
    for (const run of ['a', 'b']) {
      const out = join(workspace, `${name}-${run}.html`);
      const rendered = cli([spec, '--out', out, '--json'], workspace);
      if (rendered.status !== 0) fail(`${name}.yaml did not render: ${rendered.stderr}`);
      const summary = parse(rendered.stdout, `render ${name}`);
      if (summary.warnings.length > 0) fail(`${name}.yaml rendered with warnings`);
      const html = readFileSync(out, 'utf8');
      if (!html.includes(`<title>${escapeHtml(summary.title)}</title>`)) {
        fail(`${name}.html lost its title`);
      }
      if (REMOTE_LOAD.test(html)) {
        fail(`${name}.html loads a remote resource`);
      }
      hashes.push(sha256(out));
    }
    if (hashes[0] !== hashes[1]) fail(`${name}.yaml rendered different bytes twice`);
    receipt.push(`${name}.html sha256 ${hashes[0]}`);
  }

  // The error paths the skill tells Claude to report.
  const bad = join(workspace, 'bad.yaml');
  writeFileSync(bad, 'version: 1\nmeta: { title: Bad }\nblocks:\n  - { type: hero, titl: x }\n');
  const invalid = cli(['validate', bad, '--json'], workspace);
  const diagnostics = parse(invalid.stdout, 'validate bad.yaml').diagnostics ?? [];
  if (invalid.status !== 1 || !diagnostics.some((d) => d.path?.startsWith('$.blocks[0]'))) {
    fail(`an invalid spec should exit 1 with a block path, got ${invalid.status}`);
  }
  const refused = cli([bad, '--out', join(workspace, 'bad.html')], workspace);
  if (refused.status !== 1 || existsSync(join(workspace, 'bad.html'))) {
    fail('an invalid spec should exit 1 and write nothing');
  }
  const missing = cli([join(workspace, 'missing.yaml')], workspace);
  if (missing.status !== 2) fail(`a missing spec should exit 2, got ${missing.status}`);
  receipt.push('error paths: invalid exit 1 (no file), missing exit 2');

  // The MCP server exactly as the manifest starts it.
  const out = join(workspace, 'mcp-report.html');
  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'claude-plugin-smoke', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'render',
        arguments: { spec: readFileSync(join(examplesDir, 'report.yaml'), 'utf8'), out },
      },
    },
  ];
  const mcp = spawnSync(server.command, server.args, {
    cwd: workspace,
    encoding: 'utf8',
    input: `${requests.map((r) => JSON.stringify(r)).join('\n')}\n`,
    shell,
    timeout: 120_000,
  });
  if (mcp.error) fail(`the MCP server did not run: ${mcp.error.message}`);
  const replies = new Map(
    mcp.stdout
      .split('\n')
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => parse(line, 'the MCP server'))
      .map((reply) => [reply.id, reply]),
  );
  const tools = replies
    .get(2)
    ?.result?.tools?.map((tool) => tool.name)
    .sort();
  if (JSON.stringify(tools) !== JSON.stringify(MCP_TOOLS)) {
    fail(`MCP tools ${JSON.stringify(tools)} differ from ${JSON.stringify(MCP_TOOLS)}`);
  }
  if (replies.get(3)?.result?.isError || !existsSync(out)) fail('MCP render wrote no file');
  if (sha256(out) !== receipt[0].split(' ').at(-1)) fail('MCP render differs from the CLI');
  receipt.push(`mcp: ${tools.length} tools, render matches the CLI bytes`);

  const claude = spawnSync(
    'claude',
    ['plugin', 'validate', pluginDir, '--profile', 'directory', '--strict'],
    { encoding: 'utf8', shell },
  );
  if (claude.error?.code === 'ENOENT') {
    receipt.push('claude plugin validate: skipped, claude CLI not on PATH');
  } else if (claude.error) {
    fail(`could not run claude plugin validate: ${claude.error.message}`);
  } else if (claude.status !== 0) {
    fail(`claude plugin validate failed:\n${claude.stdout}${claude.stderr}`);
  } else {
    const claudeVersion = execFileSync('claude', ['--version'], { encoding: 'utf8', shell }).trim();
    receipt.push(`claude plugin validate --profile directory --strict: passed (${claudeVersion})`);
  }

  console.log(`claude-plugin-smoke OK (${pkg})`);
  for (const line of receipt) console.log(`  ${line}`);
} catch (error) {
  if (!(error instanceof SmokeFailure)) throw error;
  console.error(`claude-plugin-smoke FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
