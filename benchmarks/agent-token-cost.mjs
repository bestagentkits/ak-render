#!/usr/bin/env node
/**
 * Agent token cost: hand-written HTML against a compiled Page Spec.
 *
 * The legacy baseline (`legacy-context-cost.mjs`) measures the guidance an
 * agent reads before writing HTML. This script adds the other half: what the
 * agent writes, and what comes back into its context.
 *
 * Measured:
 *   - a corpus of real HTML artifacts written by agents (passed with
 *     --legacy-html; recorded by anonymous label, never by path or content):
 *     total characters and the share that is visible text;
 *   - every fixture in fixtures/pages: spec characters, visible text in the
 *     compiled page, compiled characters, and the CLI's --json summary;
 *   - the discovery an agent reads on this path: the agent skill, `catalog`,
 *     and `describe <type> --json` for each block type the fixture uses; and,
 *     reported separately, the compact workflow that reads
 *     `describe <types...> --compact` instead (batches of 12).
 *
 * Estimated (labelled as such in the artifact):
 *   - tokens, at 4 characters per token, matching the legacy baseline;
 *   - the spec an agent would write for a legacy page: its visible text times
 *     the median spec-to-text ratio of the fixtures.
 *
 * Not measured: live model runs, repairs, wall time. Those need the A/B
 * harness and are listed in `notMeasured`.
 *
 * Usage:
 *   pnpm build
 *   node benchmarks/agent-token-cost.mjs --legacy-html a.html b.html ... [--out-dir docs/artifacts]
 *   node benchmarks/agent-token-cost.mjs --legacy-from docs/artifacts/agent-token-cost.json
 *
 * The legacy corpus is private, so `--legacy-from` reuses the anonymous legacy
 * rows recorded in an earlier artifact and re-measures everything else. Use it
 * to refresh the artifact after a compiler or catalog change.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specBlockTypes } from './spec-block-types.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLI = join(REPO_ROOT, 'dist/cli.js');
const CHARS_PER_TOKEN = 4;
/** The CLI's describe-many limit. */
const DESCRIBE_BATCH = 12;
const tokens = (chars) => Math.round(chars / CHARS_PER_TOKEN);

function parseArgs(argv) {
  const options = { legacy: [], legacyFrom: undefined, outDir: join(REPO_ROOT, 'docs/artifacts') };
  let mode;
  for (const arg of argv) {
    if (arg === '--legacy-html') mode = 'legacy';
    else if (arg === '--out-dir') mode = 'out';
    else if (arg === '--legacy-from') mode = 'from';
    else if (mode === 'legacy') options.legacy.push(resolve(arg));
    else if (mode === 'out' || mode === 'from') {
      if (mode === 'out') options.outDir = resolve(arg);
      else options.legacyFrom = resolve(arg);
      mode = undefined;
    } else throw new Error(`unexpected argument: ${arg}`);
  }
  if ((options.legacy.length === 0) === (options.legacyFrom === undefined)) {
    throw new Error('pass either files with --legacy-html or one artifact with --legacy-from');
  }
  return options;
}

/** Legacy rows recorded in an earlier artifact, checked for the expected shape. */
function recordedLegacy(file) {
  const rows = JSON.parse(readFileSync(file, 'utf8'))?.legacy?.artifacts;
  const fields = ['chars', 'textChars', 'cssChars', 'jsChars', 'textShare'];
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    !rows.every(
      (row) =>
        typeof row?.label === 'string' &&
        fields.every((field) => typeof row[field] === 'number' && Number.isFinite(row[field])),
    )
  ) {
    throw new Error(`${file} has no recorded legacy artifacts`);
  }
  return rows.map((row) => ({
    label: row.label,
    ...Object.fromEntries(fields.map((field) => [field, row[field]])),
  }));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Visible text: everything outside tags, styles and scripts, whitespace-collapsed. */
function visibleText(html) {
  return html
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity) => {
      if (entity.startsWith('#x'))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/gu, ' ')
    .trim();
}

function blockSize(html, tag) {
  let size = 0;
  for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'giu'))) {
    size += match[0].length;
  }
  return size;
}

function measureLegacy(files) {
  return files.map((file, index) => {
    const html = readFileSync(file, 'utf8');
    const text = visibleText(html).length;
    return {
      label: `legacy-${String(index + 1).padStart(2, '0')}`,
      chars: html.length,
      textChars: text,
      cssChars: blockSize(html, 'style'),
      jsChars: blockSize(html, 'script'),
      textShare: text / html.length,
    };
  });
}

const cli = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

function measureFixtures() {
  const directory = join(REPO_ROOT, 'fixtures/pages');
  const skill = readFileSync(join(REPO_ROOT, 'skills/ak-render/SKILL.md'), 'utf8').length;
  const catalog = cli(['catalog']).length;
  const describeCache = new Map();
  const describe = (type) => {
    if (!describeCache.has(type)) describeCache.set(type, cli(['describe', type, '--json']).length);
    return describeCache.get(type);
  };
  // The compact workflow reads every contract in one describe call per batch.
  const describeCompact = (types) => {
    let chars = 0;
    for (let start = 0; start < types.length; start += DESCRIBE_BATCH) {
      chars += cli(['describe', ...types.slice(start, start + DESCRIBE_BATCH), '--compact']).length;
    }
    return chars;
  };
  const scratch = mkdtempSync(join(tmpdir(), 'ak-render-token-cost-'));
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith('.yaml'))
      .sort()
      .map((name) => {
        const path = join(directory, name);
        const spec = readFileSync(path, 'utf8');
        const out = join(scratch, name.replace(/\.yaml$/u, '.html'));
        const summary = cli([path, '--out', out, '--json']).length;
        const html = readFileSync(out, 'utf8');
        const types = specBlockTypes(spec);
        const discovery = skill + catalog + types.reduce((sum, type) => sum + describe(type), 0);
        const text = visibleText(html).length;
        return {
          fixture: name,
          specChars: spec.length,
          pageChars: html.length,
          textChars: text,
          specToText: spec.length / text,
          summaryChars: summary,
          blockTypes: types.length,
          discoveryChars: discovery,
          compactDiscoveryChars: skill + catalog + describeCompact(types),
        };
      });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function build(options) {
  const baseline = JSON.parse(
    readFileSync(join(REPO_ROOT, 'docs/artifacts/baseline-legacy-html-context.json'), 'utf8'),
  );
  const legacy =
    options.legacyFrom === undefined
      ? measureLegacy(options.legacy)
      : recordedLegacy(options.legacyFrom);
  const fixtures = measureFixtures();
  const ratio = median(fixtures.map((row) => row.specToText));

  const projected = legacy.map((row) => {
    const specChars = row.textChars * ratio;
    return {
      label: row.label,
      legacyOutputTokens: tokens(row.chars),
      specTokens: tokens(specChars),
      outputReduction: 1 - specChars / row.chars,
    };
  });

  const guidanceBefore = baseline.totals.meanTaskTokens;
  const guidanceAfter = tokens(median(fixtures.map((row) => row.discoveryChars)));
  const outputBefore = tokens(median(legacy.map((row) => row.chars)));
  const outputAfter = tokens(median(legacy.map((row) => row.textChars)) * ratio);
  const returned = tokens(median(fixtures.map((row) => row.summaryChars)));
  const before = guidanceBefore + outputBefore;
  const after = guidanceAfter + outputAfter + returned;
  const guidanceCompact = tokens(median(fixtures.map((row) => row.compactDiscoveryChars)));
  const afterCompact = guidanceCompact + outputAfter + returned;

  return {
    artifact: 'agent-token-cost',
    producer: 'benchmarks/agent-token-cost.mjs',
    compiler: cli(['--version']).trim(),
    method: {
      tokens: `estimated at ${CHARS_PER_TOKEN} characters per token, as in the legacy baseline`,
      visibleText: 'characters outside tags, <style> and <script>, whitespace collapsed',
      projectedSpec: 'legacy visible text times the median fixture spec-to-text ratio',
      legacyCorpus: 'agent-written HTML artifacts from real projects, recorded by anonymous label',
    },
    legacy: {
      artifacts: legacy,
      medianChars: median(legacy.map((row) => row.chars)),
      medianTextShare: median(legacy.map((row) => row.textShare)),
    },
    fixtures: {
      rows: fixtures,
      medianSpecToText: ratio,
      medianPageToSpec: median(fixtures.map((row) => row.pageChars / row.specChars)),
    },
    projected: {
      artifacts: projected,
      medianOutputReduction: median(projected.map((row) => row.outputReduction)),
    },
    typicalTask: {
      before: { guidance: guidanceBefore, output: outputBefore, total: before },
      after: { guidance: guidanceAfter, output: outputAfter, returned, total: after },
      reduction: 1 - after / before,
      excludes: 'task context and narrative reasoning (equal on both paths), repairs and retries',
      describe: 'describe <type> --json for each block type (full contracts)',
    },
    typicalTaskCompact: {
      describe: 'describe <types...> --compact (batches of 12), as the agent guide recommends',
      after: { guidance: guidanceCompact, output: outputAfter, returned, total: afterCompact },
      reduction: 1 - afterCompact / before,
    },
    contextReduction: {
      source: 'docs/artifacts/benchmark-render.md',
      note: 'presentation guidance only, benchmarked against AgentKit with its ak-render skill',
    },
    notMeasured: [
      'live model input and output tokens per task (needs the A/B harness)',
      'repair loops and retries per task',
      'wall-clock time per task',
      'rendered quality of legacy against compiled output on the same content',
    ],
  };
}

const pct = (value) => `${Math.round(value * 100)}%`;
const k = (value) => `${(value / 1000).toFixed(1)}k`;

function markdown(result) {
  const { typicalTask: task, typicalTaskCompact: compact } = result;
  const lines = [
    '# Agent token cost: hand-written HTML against a Page Spec',
    '',
    `Generated by \`${result.producer}\` with \`ak-render ${result.compiler}\`. Machine-readable`,
    'companion: [`agent-token-cost.json`](./agent-token-cost.json).',
    '',
    'The legacy baseline measures what an agent reads before writing HTML. This',
    'artifact adds what it writes and what comes back into its context. Character',
    'counts are measured; tokens are estimated at 4 characters per token, as in the',
    'baseline. No tokenizer or live model run is involved.',
    '',
    '## Typical task (estimate built from measured parts)',
    '',
    '| Part | Hand-written HTML | AK Render |',
    '| --- | ---: | ---: |',
    `| Presentation guidance read | ${k(task.before.guidance)} (baseline mean) | ${k(task.after.guidance)} (skill, catalog, describe --json) |`,
    `| Written by the agent | ${k(task.before.output)} (median legacy page) | ${k(task.after.output)} (projected spec) |`,
    `| Returned into context | written page stays in context | ${k(task.after.returned)} (render summary) |`,
    `| **Total** | **${k(task.before.total)}** | **${k(task.after.total)}** |`,
    '',
    `Estimated reduction: **${pct(task.reduction)}**. Excludes ${task.excludes}.`,
    '',
    'With the compact workflow (`describe <types...> --compact`, which the agent',
    `guide recommends) the guidance read is ${k(compact.after.guidance)}, the total ${k(compact.after.total)}, and the`,
    `estimated reduction **${pct(compact.reduction)}**. Output and returned context are the same on both rows.`,
    '',
    '## Legacy corpus (measured)',
    '',
    `${result.legacy.artifacts.length} agent-written HTML artifacts. Median size`,
    `${k(result.legacy.medianChars)} characters; median visible-text share`,
    `${pct(result.legacy.medianTextShare)}. The rest is markup, CSS and JS the agent wrote.`,
    '',
    '| Artifact | Chars | Visible text | CSS | JS | Projected spec saving |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...result.legacy.artifacts.map((row, index) => {
      const saving = result.projected.artifacts[index].outputReduction;
      return `| ${row.label} | ${row.chars} | ${pct(row.textShare)} | ${row.cssChars} | ${row.jsChars} | ${pct(saving)} |`;
    }),
    '',
    `Median projected output saving: **${pct(result.projected.medianOutputReduction)}**. A page that is`,
    'mostly prose saves little or nothing on output; the saving comes from',
    'presentation code the agent no longer writes.',
    '',
    '## Fixtures (measured)',
    '',
    '| Fixture | Spec | Visible text | Spec / text | Page | Summary | Discovery | Compact discovery |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...result.fixtures.rows.map(
      (row) =>
        `| \`${row.fixture}\` | ${row.specChars} | ${row.textChars} | ${row.specToText.toFixed(2)} | ${row.pageChars} | ${row.summaryChars} | ${row.discoveryChars} | ${row.compactDiscoveryChars} |`,
    ),
    '',
    `Median spec-to-text ratio ${result.fixtures.medianSpecToText.toFixed(2)}; a compiled page is a median`,
    `${Math.round(result.fixtures.medianPageToSpec)}× its spec, and none of it enters the agent's context.`,
    '',
    '## Not measured',
    '',
    ...result.notMeasured.map((item) => `- ${item}`),
    '',
  ];
  return lines.join('\n');
}

const options = parseArgs(process.argv.slice(2));
const result = build(options);
writeFileSync(
  join(options.outDir, 'agent-token-cost.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);
writeFileSync(join(options.outDir, 'agent-token-cost.md'), markdown(result));
console.log(
  `agent-token-cost: typical ${k(result.typicalTask.before.total)} -> ${k(result.typicalTask.after.total)} tokens (${pct(result.typicalTask.reduction)}; compact describe ${k(result.typicalTaskCompact.after.total)}, ${pct(result.typicalTaskCompact.reduction)}), median output saving ${pct(result.projected.medianOutputReduction)}`,
);
