/**
 * Arms, per-run metrics and the report targets for the live-model A/B harness.
 *
 * Pure functions only: the harness feeds them the trace of one agent run (or
 * all runs) and they never touch the model, the server or the filesystem.
 */

import { describe, medianReduction, proportion } from './stats.mjs';

/** Tools that make up the compose/repair flow. Absent from a build until they ship. */
export const AFTER_FLOW_TOOLS = ['compose', 'repair'];

/**
 * The two arms. Both see every tool the server lists except that the existing
 * arm never sees the compose/repair tools, so the only difference between the
 * arms is the new flow.
 */
export const ARMS = ['existing', 'compose-repair'];

/**
 * Tools an arm may use, from the server's `tools/list`, or a `skip` reason
 * when this build cannot run the arm.
 */
export function armTools(arm, serverTools) {
  const names = new Set(serverTools.map((tool) => tool.name));
  if (arm === 'existing') {
    const tools = serverTools.filter((tool) => !AFTER_FLOW_TOOLS.includes(tool.name));
    const missing = ['validate', 'render'].filter((name) => !names.has(name));
    return missing.length === 0 ? { tools } : { skip: `server lacks ${missing.join(', ')}` };
  }
  if (arm === 'compose-repair') {
    const present = AFTER_FLOW_TOOLS.filter((name) => names.has(name));
    if (present.length === 0) {
      return {
        skip: `this build exposes neither ${AFTER_FLOW_TOOLS.join(' nor ')}; the after arm needs the compose/repair tools`,
      };
    }
    return { tools: serverTools, afterTools: present };
  }
  throw new Error(`unknown arm: ${arm}`);
}

/** Calls that submit a whole spec or intent and can fail validation. */
export const SUBMIT_TOOLS = new Set(['validate', 'render', 'compose']);
/** Calls that orchestrate the page rather than discover the catalog. */
const ORCHESTRATION_TOOLS = new Set([...SUBMIT_TOOLS, 'repair']);

/** Case and whitespace do not decide whether a fact made it onto the page. */
const squash = (text) => text.toLowerCase().replace(/\s+/gu, '');

/**
 * Metrics for one run.
 *
 * `trace` is the run's tool calls in order: `{ name, isError }`. `usage` sums
 * the provider-reported tokens over every model turn; `usage.missing` marks a
 * run where a turn came back without a usage report, whose token counts are
 * then left out rather than recorded as zero. `retryMs` is time spent backing
 * off from provider errors, which is not part of the task's wall time.
 */
export function runMetrics({
  trace,
  usage,
  modelTurns,
  wallMs,
  retryMs = 0,
  finished,
  page,
  facts,
  visual,
}) {
  const submissions = trace.filter((call) => SUBMIT_TOOLS.has(call.name));
  const firstValid = submissions.findIndex((call) => !call.isError);
  const text = squash(page?.text ?? '');
  const missingFacts = facts.filter((fact) => !text.includes(squash(fact)));
  const tokens = usage.missing === true ? undefined : usage;
  return {
    inputTokens: tokens?.input,
    outputTokens: tokens?.output,
    totalTokens: tokens === undefined ? undefined : tokens.input + tokens.output,
    usageMissing: usage.missing === true,
    costUsd: usage.cost,
    modelTurns,
    toolCalls: trace.length,
    orchestrationCalls: trace.filter((call) => ORCHESTRATION_TOOLS.has(call.name)).length,
    discoveryCalls: trace.filter((call) => !ORCHESTRATION_TOOLS.has(call.name)).length,
    submissions: submissions.length,
    firstPassValid: submissions.length > 0 && !submissions[0].isError,
    // Failed submissions before the first valid one: the repair iterations.
    repairs: firstValid === -1 ? submissions.length : firstValid,
    repairToolCalls: trace.filter((call) => call.name === 'repair').length,
    wallMs: wallMs - retryMs,
    retryMs,
    completed: finished && page !== undefined,
    correct: page !== undefined && missingFacts.length === 0,
    missingFacts,
    criticalMobileOverflow: visual?.criticalMobileOverflow,
    visual,
  };
}

const NUMERIC = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'costUsd',
  'modelTurns',
  'toolCalls',
  'orchestrationCalls',
  'discoveryCalls',
  'repairs',
  'repairToolCalls',
  'wallMs',
];
const RATES = ['firstPassValid', 'completed', 'correct'];

/**
 * Per-arm aggregates over its runs (every task and repetition).
 *
 * Rates count every run, so a run that errored counts as not completed, not
 * first-pass valid and not correct instead of vanishing from the denominator.
 * Medians come from the runs that did not error: an errored run's partial
 * tokens and time would understate the cost of finishing the task.
 */
export function aggregateArm(runs, options) {
  const summary = { runs: runs.length, errors: runs.filter((run) => run.error).length };
  const clean = runs
    .filter((run) => !run.error && run.metrics !== undefined)
    .map((run) => run.metrics);
  for (const key of NUMERIC)
    summary[key] = describe(
      clean.map((m) => m[key]),
      options,
    );
  for (const key of RATES)
    summary[key] = proportion(runs.map((run) => !run.error && run.metrics?.[key] === true));
  summary.usageMissingRuns = clean.filter((m) => m.usageMissing).length;
  const audited = clean.filter((m) => m.criticalMobileOverflow !== undefined);
  summary.visualAudited = audited.length;
  summary.criticalMobileOverflowRuns = audited.filter((m) => m.criticalMobileOverflow).length;
  return summary;
}

/**
 * The issue's targets, evaluated only from measured data. A target is never
 * reported from an estimate or from an empty sample: without measured runs of
 * the arms it needs, it is `not measured`.
 *
 * `tasks` orders the strata of the reductions, which compare the arms task by
 * task.
 */
export function evaluateTargets(byArm, runsByArm, tasks, options) {
  const before = byArm.existing;
  const after = byArm['compose-repair'];
  const notMeasured = (why) => ({ status: 'not measured', why });
  const afterRuns = after === undefined ? 0 : after.runs;
  const strata = (arm, key) =>
    tasks.map((task) =>
      (runsByArm[arm] ?? [])
        .filter((run) => run.task === task && !run.error)
        .map((run) => run.metrics?.[key])
        .filter((value) => Number.isFinite(value)),
    );
  const reduction = (key, threshold) => {
    if (before === undefined || afterRuns === 0) return notMeasured('needs both arms');
    const result = medianReduction(strata('existing', key), strata('compose-repair', key), options);
    if (result === undefined) return notMeasured('no task measured in both arms');
    return { status: result.point >= threshold ? 'met' : 'not met', ...result };
  };
  const onAfter = (stat, evaluate) => {
    if (afterRuns === 0) return notMeasured('compose-repair arm not run');
    if (stat().n === 0) return notMeasured('no compose-repair run measured it');
    return evaluate();
  };
  return [
    {
      id: 'first-pass-valid',
      target: '>= 95% first-pass valid (compose-repair arm)',
      ...onAfter(
        () => after.firstPassValid,
        () => ({
          status: after.firstPassValid.rate >= 0.95 ? 'met' : 'not met',
          point: after.firstPassValid.rate,
          ci95: after.firstPassValid.ci95,
        }),
      ),
    },
    {
      id: 'median-orchestration-calls',
      target: '<= 2 median orchestration calls (compose-repair arm)',
      ...onAfter(
        () => after.orchestrationCalls,
        () => ({
          status: after.orchestrationCalls.median <= 2 ? 'met' : 'not met',
          point: after.orchestrationCalls.median,
          ci95: after.orchestrationCalls.medianCi95,
        }),
      ),
    },
    {
      id: 'total-token-reduction',
      target: '>= 30% lower median total tokens',
      ...reduction('totalTokens', 0.3),
    },
    {
      id: 'wall-time-reduction',
      target: '>= 40% lower median wall time',
      ...reduction('wallMs', 0.4),
    },
    {
      id: 'critical-mobile-overflow',
      target: '0 critical mobile overflow (compose-repair arm)',
      ...onAfter(
        () => ({ n: after.visualAudited }),
        () => ({
          status: after.criticalMobileOverflowRuns === 0 ? 'met' : 'not met',
          point: after.criticalMobileOverflowRuns,
        }),
      ),
    },
  ];
}
