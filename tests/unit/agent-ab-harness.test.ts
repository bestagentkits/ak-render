import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  anthropicMessages,
  openAiMessages,
  redact,
  resolveProvider,
  // @ts-expect-error -- plain ESM benchmark module without type declarations
} from '../../benchmarks/agent-ab/model-client.mjs';
import {
  aggregateArm,
  armTools,
  evaluateTargets,
  runMetrics,
  // @ts-expect-error -- plain ESM benchmark module without type declarations
} from '../../benchmarks/agent-ab/run-metrics.mjs';
import {
  bootstrapInterval,
  median,
  medianReduction,
  proportion,
  quantile,
  stddev,
  // @ts-expect-error -- plain ESM benchmark module without type declarations
} from '../../benchmarks/agent-ab/stats.mjs';
// @ts-expect-error -- plain ESM benchmark module without type declarations
import { loadTasks } from '../../benchmarks/agent-ab-harness.mjs';

const HARNESS = fileURLToPath(new URL('../../benchmarks/agent-ab-harness.mjs', import.meta.url));
const TASKS = fileURLToPath(new URL('../../benchmarks/agent-ab/tasks.json', import.meta.url));

const tool = (name: string) => ({ name, description: name, inputSchema: { type: 'object' } });
const USAGE = { input: 1000, output: 200, cost: undefined };

interface Call {
  name: string;
  isError: boolean;
}

function metrics(trace: Call[], overrides: Record<string, unknown> = {}) {
  return runMetrics({
    trace,
    usage: USAGE,
    modelTurns: trace.length + 1,
    wallMs: 5000,
    finished: true,
    page: { text: 'Revenue $40M with 46% margin' },
    facts: ['$40M', '46%'],
    visual: undefined,
    ...overrides,
  });
}

describe('agent A/B statistics', () => {
  it('computes interpolated quantiles, median and sample deviation', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([0, 10], 0.95)).toBeCloseTo(9.5);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(median([])).toBeUndefined();
  });

  it('bootstraps the same interval for the same values', () => {
    const values = [10, 12, 9, 14, 11, 13, 10, 15];
    const first = bootstrapInterval(values, median);
    expect(first).toEqual(bootstrapInterval(values, median));
    expect(first[0]).toBeLessThanOrEqual(median(values));
    expect(first[1]).toBeGreaterThanOrEqual(median(values));
    expect(bootstrapInterval([1], median)).toBeUndefined();
  });

  it('reports a positive reduction when the after arm is lower', () => {
    const result = medianReduction([[100, 110, 90, 105]], [[50, 55, 45, 60]]);
    expect(result.point).toBeCloseTo(1 - 52.5 / 102.5);
    expect(result.ci95[0]).toBeGreaterThan(0);
    expect(medianReduction([[]], [[1]])).toBeUndefined();
  });

  it('compares only tasks measured in both arms', () => {
    const result = medianReduction(
      [
        [100, 100],
        [1000, 1000],
      ],
      [[50, 50], []],
    );
    expect(result.strata).toBe(1);
    expect(result.point).toBeCloseTo(0.5);
  });

  it('keeps a non-degenerate rate interval at 100%', () => {
    const all = proportion([true, true, true, true, true]);
    expect(all.rate).toBe(1);
    expect(all.ci95[1]).toBe(1);
    expect(all.ci95[0]).toBeLessThan(0.7);
    expect(proportion([]).rate).toBeUndefined();
  });
});

describe('agent A/B arms', () => {
  const current = ['catalog', 'describe', 'validate', 'render'].map(tool);

  it('runs the existing arm on a build without compose or repair', () => {
    expect(armTools('existing', current).tools.map((t: { name: string }) => t.name)).toEqual([
      'catalog',
      'describe',
      'validate',
      'render',
    ]);
  });

  it('skips the after arm with a reason when the build lacks the new tools', () => {
    expect(armTools('compose-repair', current).skip).toMatch(/neither compose nor repair/u);
  });

  it('hides compose and repair from the existing arm once they ship', () => {
    const next = [...current, tool('compose'), tool('repair')];
    expect(armTools('existing', next).tools.map((t: { name: string }) => t.name)).not.toContain(
      'compose',
    );
    const after = armTools('compose-repair', next);
    expect(after.tools).toHaveLength(6);
    expect(after.afterTools).toEqual(['compose', 'repair']);
  });
});

describe('agent A/B run metrics', () => {
  it('counts repairs as failed submissions before the first valid one', () => {
    const result = metrics([
      { name: 'catalog', isError: false },
      { name: 'validate', isError: true },
      { name: 'validate', isError: true },
      { name: 'validate', isError: false },
      { name: 'render', isError: false },
    ]);
    expect(result).toMatchObject({
      totalTokens: 1200,
      toolCalls: 5,
      orchestrationCalls: 4,
      discoveryCalls: 1,
      firstPassValid: false,
      repairs: 2,
      completed: true,
      correct: true,
    });
  });

  it('marks a run with no submission as not first-pass valid', () => {
    const result = metrics([{ name: 'catalog', isError: false }], { page: undefined });
    expect(result).toMatchObject({ firstPassValid: false, completed: false, correct: false });
  });

  it('matches facts regardless of case and whitespace and lists the missing ones', () => {
    const result = metrics([{ name: 'render', isError: false }], {
      page: { text: 'Median first response 38   MIN' },
      facts: ['38 min', 'billing'],
    });
    expect(result.correct).toBe(false);
    expect(result.missingFacts).toEqual(['billing']);
  });

  it('leaves tokens out instead of counting zero when usage is missing', () => {
    const result = metrics([{ name: 'render', isError: false }], {
      usage: { input: 0, output: 0, cost: undefined, missing: true },
    });
    expect(result.usageMissing).toBe(true);
    expect(result.totalTokens).toBeUndefined();
  });

  it('subtracts provider back-off from wall time', () => {
    const result = metrics([{ name: 'render', isError: false }], { retryMs: 1500 });
    expect(result).toMatchObject({ wallMs: 3500, retryMs: 1500 });
  });

  it('counts errored runs as failures in rates but not in medians', () => {
    const ok = { task: 't', metrics: metrics([{ name: 'render', isError: false }]) };
    const failed = {
      task: 't',
      error: 'boom',
      metrics: metrics([{ name: 'render', isError: false }], {
        usage: { input: 10, output: 0, cost: undefined },
      }),
    };
    const summary = aggregateArm([ok, failed]);
    expect(summary).toMatchObject({ runs: 2, errors: 1 });
    expect(summary.completed.rate).toBe(0.5);
    expect(summary.totalTokens.median).toBe(1200);
  });
});

describe('agent A/B targets', () => {
  const run = (arm: string, totalTokens: number) => ({
    arm,
    task: 'only',
    metrics: metrics([{ name: 'render', isError: false }], {
      usage: { input: totalTokens, output: 0, cost: undefined },
    }),
  });

  it('never reports a target as met without the after arm', () => {
    const runsByArm = { existing: [run('existing', 1000), run('existing', 1200)] };
    const targets = evaluateTargets({ existing: aggregateArm(runsByArm.existing) }, runsByArm, [
      'only',
    ]);
    expect(targets.map((target: { status: string }) => target.status)).toEqual(
      Array(5).fill('not measured'),
    );
  });

  it('evaluates the token reduction from measured runs of both arms', () => {
    const runsByArm = {
      existing: [run('existing', 1000), run('existing', 1100)],
      'compose-repair': [run('compose-repair', 500), run('compose-repair', 600)],
    };
    const byArm = {
      existing: aggregateArm(runsByArm.existing),
      'compose-repair': aggregateArm(runsByArm['compose-repair']),
    };
    const tokens = evaluateTargets(byArm, runsByArm, ['only']).find(
      (target: { id: string }) => target.id === 'total-token-reduction',
    );
    expect(tokens.status).toBe('met');
    expect(tokens.point).toBeCloseTo(1 - 550 / 1050);
  });
});

describe('agent A/B provider wire format', () => {
  const conversation = [
    { role: 'user', text: 'build it' },
    { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'validate', args: { a: 1 } }] },
    { role: 'tool', results: [{ id: 'c1', text: 'bad', isError: true }] },
  ];

  it('pairs tool calls and results for Anthropic Messages', () => {
    const wire = anthropicMessages(conversation);
    expect(wire[1].content).toEqual([
      { type: 'tool_use', id: 'c1', name: 'validate', input: { a: 1 } },
    ]);
    expect(wire[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'bad', is_error: true }],
    });
  });

  it('pairs tool calls and results for OpenAI-compatible chat', () => {
    const wire = openAiMessages('sys', conversation);
    expect(wire[0]).toEqual({ role: 'system', content: 'sys' });
    expect(wire[2].tool_calls[0].function).toEqual({ name: 'validate', arguments: '{"a":1}' });
    expect(wire[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'bad' });
  });

  it('masks key-shaped strings in provider error bodies', () => {
    expect(redact('invalid key sk-or-v1-abcdef123456 given')).toBe('invalid key [redacted] given');
  });
});

describe('agent A/B harness entry', () => {
  it('loads the committed task set with unique ids and facts', () => {
    const { tasks } = loadTasks(TASKS);
    expect(tasks.length).toBeGreaterThanOrEqual(4);
    expect(() => loadTasks(TASKS, ['no-such-task'])).toThrow(/unknown task/u);
  });

  it('picks the first provider with a key and explains a skip without one', () => {
    expect(resolveProvider(undefined, { OPENROUTER_API_KEY: 'k' })).toEqual({
      name: 'openrouter',
      apiKey: 'k',
    });
    expect(resolveProvider(undefined, {}).skip).toMatch(/no model API key/u);
  });

  it('skips honestly and exits 0 without a model API key', () => {
    const output = execFileSync(process.execPath, [HARNESS, '--model', 'any'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });
    expect(output).toMatch(/skipped, no model API key.*no report was written/u);
  });
});
