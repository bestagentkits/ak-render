#!/usr/bin/env node
// Summarize per-test durations from the Playwright JSON reporter so slow tests
// show up in the CI job output (and the GitHub step summary) instead of being
// absorbed by a wider timeout.
// Usage: node scripts/playwright-timings.mjs [results.json] [--top N]
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const topIndex = args.indexOf('--top');
const top = topIndex >= 0 ? Number(args[topIndex + 1]) : 20;
const file =
  args.find((a, i) => !a.startsWith('--') && i !== topIndex + 1) ??
  'playwright-report/results.json';

if (!existsSync(file)) {
  console.log(`playwright-timings: ${file} not found, nothing to report`);
  process.exit(0);
}

const report = JSON.parse(readFileSync(file, 'utf8'));
const rows = [];

function walk(suite, titles) {
  const path = suite.title ? [...titles, suite.title] : titles;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const results = test.results ?? [];
      const last = results.at(-1);
      if (!last) continue;
      rows.push({
        title: [...path.slice(1), spec.title].join(' › '),
        file: spec.file,
        project: test.projectName,
        ms: last.duration,
        timeout: test.timeout,
        retries: results.length - 1,
        status: last.status,
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, path);
}
for (const suite of report.suites ?? []) walk(suite, []);

rows.sort((a, b) => b.ms - a.ms);
const byProject = new Map();
for (const r of rows) {
  const p = byProject.get(r.project) ?? { count: 0, ms: 0 };
  p.count += 1;
  p.ms += r.ms;
  byProject.set(r.project, p);
}

const s = (ms) => `${(ms / 1000).toFixed(1)}s`;
const pct = (r) => (r.timeout ? `${Math.round((r.ms / r.timeout) * 100)}%` : '-');
const lines = [
  `### Playwright timings (${rows.length} tests, wall ${s(report.stats?.duration ?? 0)})`,
  '',
  '| Project | Tests | Sum |',
  '| --- | ---: | ---: |',
  ...[...byProject].map(([name, p]) => `| ${name} | ${p.count} | ${s(p.ms)} |`),
  '',
  `Slowest ${Math.min(top, rows.length)} (last attempt; % of the test's timeout):`,
  '',
  '| Time | Budget | Project | Test | Retries | Status |',
  '| ---: | ---: | --- | --- | ---: | --- |',
  ...rows
    .slice(0, top)
    .map(
      (r) =>
        `| ${s(r.ms)} | ${pct(r)} | ${r.project} | ${r.file} › ${r.title.replaceAll('|', '|')} | ${r.retries} | ${r.status} |`,
    ),
];
const out = lines.join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out}\n`);
