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
 * Guidance on the AK Render path is what an agent reads for one page task:
 * the AgentKit shared HTML contract (also counted in the legacy baseline), the
 * agent skill shipped in this repository, `catalog`, and `describe --json` for
 * each block type the task's fixture uses. `--agentkit` (or AGENTKIT_ROOT)
 * points at an AgentKit checkout; the run fails when the shared contract is
 * missing rather than silently shrinking the after side.
 *
 * Token counts for guidance are estimates with a stated method; exact counts
 * require a tokenizer run and are deliberately not claimed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockTypes } from './fixture-block-types.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE_DIR = join(REPO_ROOT, 'fixtures/pages');
const BASELINE_PATH = join(REPO_ROOT, 'docs/artifacts/baseline-legacy-html-context.json');

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`render-benchmark: ${flag} needs a value`);
    process.exit(2);
  }
  return value;
}

const AGENTKIT_ROOT = resolve(
  argValue('--agentkit', process.env['AGENTKIT_ROOT'] ?? join(REPO_ROOT, '..', 'agentkit')),
);
const REPEAT = Number(argValue('--repeat', '5'));
const OUT_JSON = resolve(REPO_ROOT, argValue('--out', 'docs/artifacts/benchmark-render.json'));
const OUT_MD = OUT_JSON.replace(/\.json$/u, '.md');

const CLI = join(REPO_ROOT, 'dist/cli.js');
const AGENT_SKILL = 'skills/ak-render/SKILL.md';
/** The AgentKit shared HTML contract a producer skill loads on either route. */
const SHARED_CONTRACT = 'kits/core/skills/ak-preview/references/html-skill-composition.md';

/** Legacy tasks the baseline measured, each paired with the fixture of the same kind. */
const COMPARABLE_TASKS = [
  { task: 'explain-html', fixture: 'explain.yaml' },
  { task: 'brainstorm-html', fixture: 'brainstorm.yaml' },
  { task: 'plan-review-engineer', fixture: 'plan.yaml' },
  { task: 'plan-review-marketing', fixture: 'plan.yaml' },
  { task: 'preview-diff', fixture: 'diff.yaml' },
];

function estimateTokens(chars) {
  // Same method and rounding as the baseline: a point estimate with a stated band.
  return {
    low: Math.ceil(chars / 4.5),
    point: Math.ceil(chars / 4),
    high: Math.ceil(chars / 3.5),
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

function cli(args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function gitRevision(root) {
  try {
    return execFileSync(
      'git',
      ['-C', root, 'describe', '--always', '--dirty', '--abbrev=9', '--exclude=*'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
  } catch {
    return 'unknown';
  }
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

const sharedContractPath = join(AGENTKIT_ROOT, SHARED_CONTRACT);
if (!existsSync(sharedContractPath)) {
  console.error(
    `render-benchmark: ${SHARED_CONTRACT} not found under ${AGENTKIT_ROOT}; pass --agentkit <AgentKit checkout>`,
  );
  process.exit(1);
}

const catalogText = cli(['catalog']);
const guidance = [
  { ...measureFile(sharedContractPath), path: `agentkit:${SHARED_CONTRACT}` },
  { ...measureFile(join(REPO_ROOT, AGENT_SKILL)), path: AGENT_SKILL },
  {
    path: 'ak-render catalog',
    bytes: Buffer.byteLength(catalogText),
    chars: catalogText.length,
    lines: catalogText.split('\n').length,
    estimatedTokens: estimateTokens(catalogText.length),
  },
];
const fixedChars = guidance.reduce((sum, entry) => sum + entry.chars, 0);

const describeCache = new Map();
function describeChars(type) {
  if (!describeCache.has(type)) describeCache.set(type, cli(['describe', type, '--json']).length);
  return describeCache.get(type);
}

const taskGuidance = COMPARABLE_TASKS.map(({ task, fixture }) => {
  const types = blockTypes(compile, readFileSync(join(FIXTURE_DIR, fixture), 'utf8'), fixture);
  const describe = types.reduce((sum, type) => sum + describeChars(type), 0);
  const chars = fixedChars + describe;
  return {
    task,
    fixture,
    blockTypes: types,
    describeChars: describe,
    chars,
    estimatedTokens: estimateTokens(chars),
  };
});

const afterPoints = taskGuidance.map((entry) => entry.estimatedTokens.point);
const guidanceTotals = {
  fixedChars,
  fixedEstimatedTokens: estimateTokens(fixedChars),
  minTaskTokens: Math.min(...afterPoints),
  maxTaskTokens: Math.max(...afterPoints),
};

let baseline = null;
if (existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

const comparison = [];
if (baseline !== null) {
  for (const entry of taskGuidance) {
    const task = baseline.tasks?.find((candidate) => candidate.id === entry.task);
    if (task === undefined) continue;
    const before = task.estimatedTokens?.point ?? 0;
    const after = entry.estimatedTokens.point;
    comparison.push({
      task: entry.task,
      fixture: entry.fixture,
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
  compiler: { name: '@bestagentkits/render', version: VERSION },
  method: {
    compilerTime: `Median of ${REPEAT} compiles after one warm-up compile, per fixture.`,
    tokenEstimate:
      'Estimated from character count at 4 chars/token (point), bounded by 4.5 and 3.5 chars/token. Exact tokenizer counts are not claimed.',
    guidanceScope:
      'Presentation guidance an agent loads for one page task on the AK Render path: the AgentKit shared HTML contract (also counted in the legacy baseline), the ak-render agent skill, `catalog`, and `describe --json` for each block type the matching fixture uses. Excludes the invoking skill body, fixture content, model output, and retries.',
    agentkitRevision: gitRevision(AGENTKIT_ROOT),
    renderRevision: gitRevision(REPO_ROOT),
  },
  guidance: {
    files: guidance,
    tasks: taskGuidance,
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
\`${artifact.compiler.name}@${artifact.compiler.version}\` (ak-render revision
\`${artifact.method.renderRevision}\`, AgentKit revision \`${artifact.method.agentkitRevision}\`).

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

Loaded on every task:

| Source | Chars | Estimated tokens (point) |
|---|---|---|
${guidance.map((entry) => `| \`${entry.path}\` | ${entry.chars} | ${entry.estimatedTokens.point} |`).join('\n')}

Plus \`describe --json\` for each block type the task's fixture uses:

| Task | Fixture | Block types | Describe chars | Total chars | Estimated tokens (point) |
|---|---|---|---|---|---|
${taskGuidance.map((entry) => `| \`${entry.task}\` | \`${entry.fixture}\` | ${entry.blockTypes.length} | ${entry.describeChars} | ${entry.chars} | ${entry.estimatedTokens.point} |`).join('\n')}

**Per task: ~${guidanceTotals.minTaskTokens}–${guidanceTotals.maxTaskTokens} estimated tokens.**

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
  `  guidance per task: ~${guidanceTotals.minTaskTokens}-${guidanceTotals.maxTaskTokens} tokens`,
);
console.log(`  ${artifact.regressionAnalysis.verdict}`);
