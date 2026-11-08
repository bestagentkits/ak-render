#!/usr/bin/env node
// Decide which CI lanes a change needs (its blast radius). Lint, typecheck and
// unit tests always run; this only gates the expensive lanes. It fails open: an
// unreadable diff, a push to a protected branch or any path not on a known-safe
// list runs every lane.
//
// Usage: node scripts/ci-scope.mjs [--base <ref>] [--files <path>...]
// Prints `lane=true|false` lines, and appends them to $GITHUB_OUTPUT when set.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// Paths no browser, package or cross-platform check reads. docs/artifacts holds
// browser baselines, so it is not safe for the browser lane.
const DOCS = [/\.md$/, /^docs\/(?!artifacts\/)/, /^plans\//, /^LICENSE$/, /^llms\.txt$/];
const NON_CI_WORKFLOWS = [/^\.github\/(?!workflows\/ci\.yml$)/];
const CLOUD = [/^apps\/cloud\//];

export const LANES = {
  // Chromium suite: imports src, fixtures and docs/artifacts baselines.
  browser: [...DOCS, ...NON_CI_WORKFLOWS, ...CLOUD, /^tests\/unit\//],
  // macOS and Windows unit runs: path and line-ending bugs live in src/scripts.
  crossPlatform: [...DOCS, ...NON_CI_WORKFLOWS, /^tests\/browser\//],
  // Pack, install and clean-install smoke.
  package: [...DOCS, ...NON_CI_WORKFLOWS, ...CLOUD, /^tests\//],
};

export function scope(files) {
  const out = {};
  for (const [lane, safe] of Object.entries(LANES)) {
    out[lane] = files.length === 0 || files.some((f) => !safe.some((re) => re.test(f)));
  }
  return out;
}

function changedFiles(base) {
  const diff = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  return diff.split('\n').filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  const all = () => Object.fromEntries(Object.keys(LANES).map((k) => [k, true]));
  let result;
  let reason;
  const filesAt = args.indexOf('--files');
  const baseAt = args.indexOf('--base');
  if (filesAt >= 0) {
    result = scope(args.slice(filesAt + 1));
    reason = 'explicit files';
  } else if (baseAt < 0 || !args[baseAt + 1]) {
    result = all();
    reason = 'no base ref (push): full run';
  } else {
    try {
      const files = changedFiles(args[baseAt + 1]);
      result = scope(files);
      reason = `${files.length} changed files`;
    } catch (error) {
      result = all();
      reason = `diff failed, running everything: ${error.message.split('\n')[0]}`;
    }
  }
  const lines = Object.entries(result).map(([k, v]) => `${k}=${v}`);
  console.log(`ci-scope: ${reason}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

if (process.argv[1]?.endsWith('ci-scope.mjs')) main();
