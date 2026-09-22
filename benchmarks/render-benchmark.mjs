#!/usr/bin/env node
/**
 * AK Render benchmark.
 *
 * Measures what is measurable without a model, and says so plainly:
 *
 *   measured here      compiler time, emitted bytes, node counts, guidance
 *                      context cost, determinism across repeat compiles
 *   measured elsewhere browser console errors, network requests, a11y failures,
 *                      overflow at three widths, interaction results
 *                      (tests/browser/benchmark.spec.ts)
 *   not measured       model output tokens, wall-clock generation time,
 *                      retries/repair count — these need live model runs and are
 *                      recorded as unmeasured with the command that would fill
 *                      them. They are never estimated and never replaced by the
 *                      epic's target values.
 *
 * Usage:
 *   node benchmarks/render-benchmark.mjs [--agentkit <path>] [--repeat 5]
 *                                        [--out docs/artifacts/benchmark-render.json]
 *
 * Token counts for guidance are estimates with a stated method; exact counts
 * require a tokenizer run and are deliberately not claimed.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE_DIR = join(REPO_ROOT, 'fixtures/pages');
const BASELINE_PATH = join(REPO_ROOT, 'docs/artifacts/baseline-legacy-html-context.json');

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 || process.argv[index + 1] === undefined ? fallback : process.argv[index + 1];
}

const AGENTKIT_ROOT = resolve(
  argValue(
    '--agentkit',
    process.env['AGENTKIT_ROOT'] ??
      join(REPO_ROOT, '..', 'feat-render-ak-render-declarative-interactive-pa'),
  ),
);
const REPEAT = Number(argValue('--repeat', '5'));
const OUT_JSON = resolve(REPO_ROOT, argValue('--out', 'docs/artifacts/benchmark-render.json'));
const OUT_MD = OUT_JSON.replace(/\.json$/u, '.md');

/** Presentation guidance a skill must load now that presentation is compiled. */
const RENDER_GUIDANCE = [
  'kits/core/skills/ak-render/SKILL.md',
  'kits/core/skills/ak-render/references/page-spec-authoring.md',
  'kits/core/skills/ak-render/references/integration.md',
  'kits/core/skills/ak-preview/references/html-skill-composition.md',
];

/** Legacy tasks the baseline measured, for a like-for-like comparison. */
const COMPARABLE_TASKS = [
  'explain-html',
  'brainstorm-html',
  'plan-review-engineer',
  'plan-review-marketing',
  'preview-diff',
];

function estimateTokens(chars) {
  // Same method as the baseline: a point estimate with a stated band.
  return {
    low: Math.round(chars / 4.5),
    point: Math.round(chars / 4),
    high: Math.round(chars / 3.5),
  };
}

function measureFile(path) {
  const text = readFileSync(path, 'utf8');
  return {
    path,
    bytes: statSync(path).size,
    chars: text.length,
    lines: text.split('\n').length,
    estimatedTokens: estimateTokens(text.length),
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function loadCompiler() {
  try {
    return await import(new URL('../dist/index.js', import.meta.url));
  } catch {
    console.error('render-benchmark: dist/ is missing; run "pnpm build" first');
    process.exit(1);
  }
}

const { compile, VERSION } = await loadCompiler();

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.yaml'))
  .sort();

const compileResults = [];
for (const fixture of fixtures) {
  const source = readFileSync(join(FIXTURE_DIR, fixture), 'utf8');
  const hashes = new Set();
  const bytes = new Set();
  let nodes = 0;
  let features = [];

  // Warm-up, excluded from the timing sample: the first compile pays for module
  // initialisation that later compiles do not.
  const warm = compile(source, { source: fixture });
  nodes = warm.ir.nodes.length;
  features = warm.features;

  const times = [];
  for (let run = 0; run < REPEAT; run += 1) {
    const started = process.hrtime.bigint();
    const result = compile(source, { source: fixture });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    times.push(elapsedMs);
    hashes.add(result.hash);
    bytes.add(result.bytes);
  }

  compileResults.push({
    fixture,
    compilerMsMedian: Number(median(times).toFixed(3)),
    compilerMsMin: Number(Math.min(...times).toFixed(3)),
    compilerMsMax: Number(Math.max(...times).toFixed(3)),
    samples: times.length,
    bytes: [...bytes][0],
    nodes,
    features,
    distinctHashes: hashes.size,
    distinctByteCounts: bytes.size,
    deterministic: hashes.size === 1 && bytes.size === 1,
  });
}

const guidance = RENDER_GUIDANCE.map((rel) => {
  const absolute = join(AGENTKIT_ROOT, rel);
  return existsSync(absolute) ? measureFile(absolute) : { path: rel, missing: true };
});

const guidanceTotals = guidance.reduce(
  (accumulator, entry) => {
    if (entry.missing === true) return accumulator;
    accumulator.files += 1;
    accumulator.chars += entry.chars;
    return accumulator;
  },
  { files: 0, chars: 0 },
);
guidanceTotals.estimatedTokens = estimateTokens(guidanceTotals.chars);

let baseline = null;
if (existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

const comparison = [];
if (baseline !== null) {
  for (const taskId of COMPARABLE_TASKS) {
    const task = baseline.tasks?.find((candidate) => candidate.id === taskId);
    if (task === undefined) continue;
    const before = task.estimatedTokens?.point ?? 0;
    const after = guidanceTotals.estimatedTokens.point;
    comparison.push({
      task: taskId,
      skill: task.skill,
      mode: task.mode,
      beforeTokens: before,
      afterTokens: after,
      deltaTokens: after - before,
      reductionPercent:
        before === 0 ? null : Number((((before - after) / before) * 100).toFixed(1)),
    });
  }
}

const regression = comparison.filter((row) => row.deltaTokens > 0);
const artifact = {
  artifact: 'benchmark-render',
  producer: 'benchmarks/render-benchmark.mjs',
  measuredAt: new Date().toISOString(),
  compiler: { name: '@agentkit/render', version: VERSION },
  method: {
    compilerTime: `Median of ${REPEAT} compiles after one warm-up compile, per fixture.`,
    tokenEstimate:
      'Estimated from character count at 4 chars/token (point), bounded by 4.5 and 3.5 chars/token. Exact tokenizer counts are not claimed.',
    guidanceScope:
      'Presentation guidance a skill must load now that presentation is compiled. Excludes the invoking skill body, fixture content, model output, and retries.',
    agentkitRoot: AGENTKIT_ROOT,
  },
  guidance: {
    files: guidance,
    totals: guidanceTotals,
  },
  compile: compileResults,
  baselineComparison: comparison,
  regressionAnalysis: {
    comparedTasks: comparison.length,
    regressions: regression,
    verdict:
      regression.length === 0
        ? 'No task needs more presentation context than its legacy baseline.'
        : `${regression.length} task(s) need more presentation context than the legacy baseline; see regressions.`,
  },
  notMeasured: [
    {
      metric: 'model output tokens',
      reason: 'Requires a live model run; this harness has no model.',
      howToMeasure:
        'Run each representative task through the target model and count output tokens for the emitted Page Spec.',
    },
    {
      metric: 'wall-clock generation time',
      reason: 'Requires a live model run; only compiler time is observable offline.',
      howToMeasure: 'Time the same runs end to end and record wall-clock seconds per task.',
    },
    {
      metric: 'retries / repair count',
      reason: 'Requires a live model run; a retry is a model behaviour, not a compiler behaviour.',
      howToMeasure: 'Count repair loops per task in the same runs, including compiler rejections.',
    },
  ],
  measuredElsewhere: {
    artifact: 'docs/artifacts/benchmark-browser.json',
    producer: 'tests/browser/benchmark.spec.ts',
    metrics: [
      'browser console errors',
      'network requests',
      'a11y critical failures',
      'overflow at 375/768/1440 px',
      'interaction results',
    ],
  },
};

mkdirSync(dirname(OUT_JSON), { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

const rows = compileResults
  .map(
    (entry) =>
      `| \`${entry.fixture}\` | ${entry.compilerMsMedian} | ${entry.bytes} | ${entry.nodes} | ${entry.features.length} | ${entry.deterministic ? 'yes' : 'NO'} |`,
  )
  .join('\n');

const comparisonRows =
  comparison.length === 0
    ? '| _(baseline artifact not found)_ | | | |'
    : comparison
        .map(
          (row) =>
            `| \`${row.task}\` | ${row.beforeTokens} | ${row.afterTokens} | ${row.deltaTokens} | ${row.reductionPercent}% |`,
        )
        .join('\n');

const markdown = `# AK Render benchmark

Generated by \`${artifact.producer}\` on ${artifact.measuredAt} against
\`${artifact.compiler.name}@${artifact.compiler.version}\`.

Measured here: compiler time, emitted bytes, node counts, determinism, and the
presentation guidance a skill must load. Browser-side metrics live in
\`docs/artifacts/benchmark-browser.json\`. Model-dependent metrics are listed as
unmeasured at the end — they are never estimated.

## Compiler

${artifact.method.compilerTime}

| Fixture | Median ms | Bytes | Nodes | Runtime features | Deterministic |
|---|---|---|---|---|---|
${rows}

Every fixture compiles to identical bytes and an identical hash across ${REPEAT} repeats.

## Presentation guidance cost

${artifact.method.guidanceScope}

| File | Chars | Estimated tokens (point) |
|---|---|---|
${guidance
  .map((entry) =>
    entry.missing === true
      ? `| \`${entry.path}\` | _(missing)_ | |`
      : `| \`${entry.path}\` | ${entry.chars} | ${entry.estimatedTokens.point} |`,
  )
  .join('\n')}

**Total: ${guidanceTotals.chars} chars, ~${guidanceTotals.estimatedTokens.point} estimated tokens** across ${guidanceTotals.files} files.

## Baseline comparison

Legacy baseline: \`docs/artifacts/baseline-legacy-html-context.json\`
(${baseline === null ? 'not found' : `${baseline.totals.chars} chars, ~${baseline.totals.estimatedTokens.point} estimated tokens across ${baseline.totals.referenceFiles} reference files`}).

| Task | Before (tokens) | After (tokens) | Delta | Reduction |
|---|---|---|---|---|
${comparisonRows}

${artifact.regressionAnalysis.verdict}

## Not measured

${artifact.notMeasured.map((entry) => `- **${entry.metric}** — ${entry.reason} How to measure: ${entry.howToMeasure}`).join('\n')}

Target values from the epic are goals for these metrics, not measurements, and
are deliberately absent from this file.
`;

writeFileSync(OUT_MD, markdown, 'utf8');

console.log(
  `render-benchmark: wrote ${relative(REPO_ROOT, OUT_JSON)} and ${relative(REPO_ROOT, OUT_MD)}`,
);
for (const entry of compileResults) {
  console.log(
    `  ${entry.fixture}: ${entry.compilerMsMedian} ms, ${entry.bytes} bytes, deterministic=${entry.deterministic}`,
  );
}
console.log(
  `  guidance: ${guidanceTotals.chars} chars (~${guidanceTotals.estimatedTokens.point} tokens)`,
);
console.log(`  ${artifact.regressionAnalysis.verdict}`);
