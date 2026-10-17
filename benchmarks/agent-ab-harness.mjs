#!/usr/bin/env node
/**
 * Live-model A/B harness: agent task cost of the existing flow against the
 * compose/repair flow, on identical tasks and the same model.
 *
 * Each run starts a fresh `ak-render mcp` server over stdio in its own scratch
 * directory and gives a live model the task prompt, the server's own
 * instructions and the arm's tools. The run ends when the model stops calling
 * tools or hits the turn limit.
 *
 * Measured per run: provider-reported input and output tokens (and billed cost
 * where the provider reports it), model turns, tool calls split into
 * orchestration (validate, render, compose, repair) and discovery, whether the
 * first spec submission was valid, repairs before the first valid submission,
 * wall time, completion, correctness (every task fact in the rendered page's
 * visible text) and, with --visual, horizontal overflow at 375 and 1440 px in
 * light and dark plus attempted network requests.
 *
 * Arms: `existing` sees every server tool except compose/repair;
 * `compose-repair` sees all of them and is skipped, with the reason recorded,
 * on a build that does not expose either tool. Without a model API key the
 * harness prints why it skipped and exits 0 without writing anything: it never
 * fills a report with projected numbers.
 *
 * Usage:
 *   pnpm build
 *   node benchmarks/agent-ab-harness.mjs --check
 *   OPENROUTER_API_KEY=... node benchmarks/agent-ab-harness.mjs \
 *     --model anthropic/claude-haiku-4.5 --reps 3 --visual [--out-dir docs/artifacts]
 *
 * Options:
 *   --provider anthropic|openrouter|openai  default: the first whose key is set
 *   --model <id>               required for a live run
 *   --base-url <url>           provider endpoint override
 *   --arms existing,compose-repair
 *   --tasks <file>             default benchmarks/agent-ab/tasks.json
 *   --task <id>                repeatable; default every task
 *   --reps <n>                 repetitions per task and arm (default 3)
 *   --max-turns <n>            model turns per run (default 16)
 *   --max-tokens <n>           output tokens per model turn (default 16000)
 *   --temperature <t>          omitted by default (provider default)
 *   --concurrency <n>          runs in flight (default 2)
 *   --visual                   run the browser check on each rendered page
 *   --out-dir <dir>            default docs/artifacts
 *   --name <base>              report file base name (default agent-ab-baseline)
 *   --check                    list each arm's tools and validate the task set; no model call
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultText, startMcpServer } from './agent-ab/mcp-stdio-client.mjs';
import {
  createModelClient,
  PROVIDER_NAMES,
  redact,
  resolveProvider,
} from './agent-ab/model-client.mjs';
import { markdownReport } from './agent-ab/report.mjs';
import {
  AFTER_FLOW_TOOLS,
  ARMS,
  aggregateArm,
  armTools,
  evaluateTargets,
  runMetrics,
  SUBMIT_TOOLS,
} from './agent-ab/run-metrics.mjs';
import { visibleText } from './visible-text.mjs';

export const HARNESS_VERSION = 1;
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLI = join(REPO_ROOT, 'dist/cli.js');

const TASK_RULES = `Task rules: work only through the tools. Render the finished page to the file "page.html" (a relative path). When the page is rendered, reply with one short line and stop calling tools.`;

function parseArgs(argv) {
  const options = {
    provider: undefined,
    model: undefined,
    baseUrl: undefined,
    arms: [...ARMS],
    tasks: join(REPO_ROOT, 'benchmarks/agent-ab/tasks.json'),
    taskIds: [],
    reps: 3,
    maxTurns: 16,
    maxTokens: 16000,
    temperature: undefined,
    concurrency: 2,
    visual: false,
    outDir: join(REPO_ROOT, 'docs/artifacts'),
    name: 'agent-ab-baseline',
    check: false,
  };
  const integer = (flag, value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1)
      throw new Error(`${flag} needs a positive integer`);
    return number;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      index += 1;
      if (argv[index] === undefined) throw new Error(`${flag} needs a value`);
      return argv[index];
    };
    if (flag === '--provider') {
      options.provider = value();
      if (!PROVIDER_NAMES.includes(options.provider)) {
        throw new Error(`--provider must be one of ${PROVIDER_NAMES.join(', ')}`);
      }
    } else if (flag === '--model') options.model = value();
    else if (flag === '--base-url') options.baseUrl = value();
    else if (flag === '--arms') {
      options.arms = value().split(',');
      for (const arm of options.arms)
        if (!ARMS.includes(arm)) throw new Error(`unknown arm: ${arm}`);
    } else if (flag === '--tasks') options.tasks = resolve(value());
    else if (flag === '--task') options.taskIds.push(value());
    else if (flag === '--reps') options.reps = integer(flag, value());
    else if (flag === '--max-turns') options.maxTurns = integer(flag, value());
    else if (flag === '--max-tokens') options.maxTokens = integer(flag, value());
    else if (flag === '--temperature') {
      options.temperature = Number(value());
      if (!Number.isFinite(options.temperature)) throw new Error('--temperature needs a number');
    } else if (flag === '--concurrency') options.concurrency = integer(flag, value());
    else if (flag === '--visual') options.visual = true;
    else if (flag === '--out-dir') options.outDir = resolve(value());
    else if (flag === '--name') options.name = value();
    else if (flag === '--check') options.check = true;
    else throw new Error(`unexpected argument: ${flag}`);
  }
  return options;
}

export function loadTasks(path, ids = []) {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(file.tasks) || file.tasks.length === 0)
    throw new Error(`${path} has no tasks`);
  const seen = new Set();
  for (const task of file.tasks) {
    if (typeof task.id !== 'string' || seen.has(task.id))
      throw new Error(`bad or duplicate task id: ${task.id}`);
    seen.add(task.id);
    if (typeof task.prompt !== 'string' || task.prompt.trim() === '')
      throw new Error(`${task.id}: no prompt`);
    if (!Array.isArray(task.facts) || task.facts.some((fact) => typeof fact !== 'string')) {
      throw new Error(`${task.id}: facts must be strings`);
    }
  }
  const unknown = ids.filter((id) => !seen.has(id));
  if (unknown.length > 0) throw new Error(`unknown task: ${unknown.join(', ')}`);
  const tasks = ids.length === 0 ? file.tasks : file.tasks.filter((task) => ids.includes(task.id));
  return { version: file.version, tasks };
}

/** The server's environment: no inherited keys, and a scratch home so user presets never leak in. */
const serverEnv = (home) => ({ PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home });

/** The commit the harness ran from, and whether uncommitted changes mean it does not reproduce it. */
function gitProvenance() {
  const git = (args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  try {
    return { gitSha: git(['rev-parse', 'HEAD']), gitDirty: git(['status', '--porcelain']) !== '' };
  } catch {
    return { gitSha: undefined, gitDirty: undefined };
  }
}

/** True when `path` resolves inside `dir`; the model must not write pages elsewhere. */
const insideDir = (dir, path) => {
  const target = resolve(dir, path);
  return target === dir || target.startsWith(`${dir}${sep}`);
};

/**
 * The page a run produced: the last `out` a successful render wrote, else a
 * top-level HTML file, but only when some submission succeeded, so a page
 * never counts for a run whose every submission failed.
 */
function findPage(dir, trace) {
  const outs = trace
    .filter((call) => call.out !== undefined && !call.isError)
    .map((call) => resolve(dir, call.out))
    .reverse();
  const anyValid = trace.some((call) => SUBMIT_TOOLS.has(call.name) && !call.isError);
  const fallback = anyValid
    ? readdirSync(dir)
        .filter((name) => /\.html?$/iu.test(name))
        .map((name) => join(dir, name))
    : [];
  return [...outs, ...fallback].find((path) => existsSync(path));
}

/** One tool call, refused when it names a tool outside the arm or an `out` outside the run. */
async function callTool(server, allowed, dir, call) {
  if (!allowed.has(call.name)) return { text: `unknown tool: ${call.name}`, isError: true };
  if (typeof call.args?.out === 'string' && !insideDir(dir, call.args.out)) {
    return { text: '"out" must be a path inside the working directory', isError: true };
  }
  try {
    const result = await server.callTool(call.name, call.args);
    return { text: resultText(result), isError: result.isError === true };
  } catch (error) {
    return { text: error.message, isError: true };
  }
}

/**
 * One agent run. It never throws: a provider or server failure ends the run
 * with `error` set and keeps whatever trace, usage and time it had, so the
 * aggregate can count it as a failed run instead of losing it.
 */
async function runOne({ task, arm, rep, provider, options, visual, scratch }) {
  const dir = join(scratch, `${task.id}-${arm}-${rep}`);
  mkdirSync(dir, { recursive: true });
  const trace = [];
  const usage = { input: 0, output: 0, cost: 0, costTurns: 0, missing: false };
  let modelTurns = 0;
  let truncatedTurns = 0;
  let retries = 0;
  let retryMs = 0;
  let finished = false;
  let error;
  const started = performance.now();
  let server;
  try {
    server = await startMcpServer({ cli: CLI, cwd: dir, env: serverEnv(dir) });
    const selection = armTools(arm, server.tools);
    if (selection.skip !== undefined) throw new Error(selection.skip);
    const turn = createModelClient({
      provider: provider.name,
      apiKey: provider.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      system: `${server.instructions}\n\n${TASK_RULES}`,
      tools: selection.tools,
    });
    const allowed = new Set(selection.tools.map((tool) => tool.name));
    const messages = [{ role: 'user', text: task.prompt }];
    while (modelTurns < options.maxTurns) {
      const reply = await turn(messages);
      modelTurns += 1;
      retries += reply.retries;
      retryMs += reply.retryMs;
      if (reply.truncated) truncatedTurns += 1;
      usage.input += reply.usage.input;
      usage.output += reply.usage.output;
      if (reply.usage.missing) usage.missing = true;
      if (reply.usage.cost !== undefined) {
        usage.cost += reply.usage.cost;
        usage.costTurns += 1;
      }
      messages.push({ role: 'assistant', text: reply.text, toolCalls: reply.toolCalls });
      if (reply.toolCalls.length === 0) {
        finished = true;
        break;
      }
      const results = [];
      for (const call of reply.toolCalls) {
        const callStarted = performance.now();
        const result = await callTool(server, allowed, dir, call);
        trace.push({
          turn: modelTurns,
          name: call.name,
          isError: result.isError,
          argsChars: JSON.stringify(call.args).length,
          resultChars: result.text.length,
          ms: Math.round(performance.now() - callStarted),
          ...(typeof call.args?.out === 'string' ? { out: call.args.out } : {}),
        });
        results.push({ id: call.id, name: call.name, text: result.text, isError: result.isError });
      }
      messages.push({ role: 'tool', results });
    }
  } catch (caught) {
    error = redact(caught instanceof Error ? caught.message : String(caught));
  } finally {
    await server?.close();
  }
  const wallMs = Math.round(performance.now() - started);
  const pagePath = findPage(dir, trace);
  const page =
    pagePath === undefined ? undefined : { text: visibleText(readFileSync(pagePath, 'utf8')) };
  let audit;
  if (visual !== undefined && pagePath !== undefined) {
    try {
      audit = await visual.check(visual.browser, pagePath);
    } catch (caught) {
      error ??= `visual check: ${caught instanceof Error ? caught.message : String(caught)}`;
    }
  }
  return {
    task: task.id,
    arm,
    rep,
    ...(error === undefined ? {} : { error }),
    retries,
    truncatedTurns,
    metrics: runMetrics({
      trace,
      usage: {
        input: usage.input,
        output: usage.output,
        missing: usage.missing,
        // A cost is reported only when every turn reported one; a partial sum would understate it.
        cost: usage.costTurns === modelTurns && modelTurns > 0 ? usage.cost : undefined,
      },
      modelTurns,
      wallMs,
      retryMs,
      finished: finished && error === undefined,
      page,
      facts: task.facts,
      visual: audit,
    }),
    trace: trace.map(({ out, ...call }) => call),
  };
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

async function inspectArms(options) {
  const scratch = mkdtempSync(join(tmpdir(), 'ak-render-agent-ab-check-'));
  try {
    const server = await startMcpServer({ cli: CLI, cwd: scratch, env: serverEnv(scratch) });
    try {
      return {
        serverVersion: server.serverVersion,
        instructionsMentionAfterTools: AFTER_FLOW_TOOLS.some((name) =>
          new RegExp(`\\b${name}\\b`, 'u').test(server.instructions),
        ),
        arms: Object.fromEntries(
          options.arms.map((arm) => {
            const selection = armTools(arm, server.tools);
            return [
              arm,
              selection.skip === undefined
                ? {
                    tools: selection.tools.map((tool) => tool.name),
                    afterTools: selection.afterTools,
                  }
                : { skip: selection.skip },
            ];
          }),
        ),
      };
    } finally {
      await server.close();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const taskSet = loadTasks(options.tasks, options.taskIds);
  if (options.check) {
    if (!existsSync(CLI)) throw new Error('dist/cli.js is missing: run pnpm build first');
    const inspection = await inspectArms(options);
    console.log(
      JSON.stringify({ tasks: taskSet.tasks.map((task) => task.id), ...inspection }, null, 2),
    );
    return;
  }
  const provider = resolveProvider(options.provider);
  if (provider.skip !== undefined) {
    console.log(
      `agent-ab: skipped, ${provider.skip}. Nothing was measured and no report was written.`,
    );
    return;
  }
  if (options.model === undefined) throw new Error('--model is required for a live run');
  if (!existsSync(CLI)) throw new Error('dist/cli.js is missing: run pnpm build first');

  const inspection = await inspectArms(options);
  const liveArms = options.arms.filter((arm) => inspection.arms[arm].skip === undefined);
  const skippedArms = Object.fromEntries(
    options.arms
      .filter((arm) => !liveArms.includes(arm))
      .map((arm) => [arm, inspection.arms[arm].skip]),
  );
  for (const [arm, why] of Object.entries(skippedArms))
    console.log(`agent-ab: arm ${arm} skipped, ${why}`);
  if (liveArms.length === 0) {
    console.log(
      'agent-ab: no arm can run on this build. Nothing was measured and no report was written.',
    );
    return;
  }

  // Interleave arms inside each repetition so drift in provider latency or
  // load over the run affects both arms alike.
  const units = [];
  for (let rep = 1; rep <= options.reps; rep += 1) {
    for (const task of taskSet.tasks) for (const arm of liveArms) units.push({ task, arm, rep });
  }

  let visual;
  if (options.visual) {
    const { openBrowser, visualCheck } = await import('./agent-ab/visual-check.mjs');
    visual = { browser: await openBrowser(), check: visualCheck };
  }
  const scratch = mkdtempSync(join(tmpdir(), 'ak-render-agent-ab-'));
  const startedAt = new Date().toISOString();
  let runs;
  try {
    runs = await pool(units, options.concurrency, async (unit, index) => {
      const run = await runOne({ ...unit, provider, options, visual, scratch });
      const m = run.metrics;
      const label = `agent-ab: [${index + 1}/${units.length}] ${unit.task.id} ${unit.arm} #${unit.rep}`;
      console.log(
        run.error === undefined
          ? `${label}: ${m.totalTokens ?? 'unreported'} tokens, ${m.toolCalls} calls, ${m.repairs} repairs, ${m.wallMs} ms, ${m.correct ? 'correct' : 'INCORRECT'}`
          : `${label}: error ${run.error}`,
      );
      return run;
    });
  } finally {
    await visual?.browser.close();
    rmSync(scratch, { recursive: true, force: true });
  }

  if (runs.every((run) => run.error !== undefined)) {
    // Never replace a baseline with a report that measured nothing.
    console.log('agent-ab: every run errored. Nothing was measured and no report was written.');
    process.exitCode = 1;
    return;
  }

  const runsByArm = Object.fromEntries(
    liveArms.map((arm) => [arm, runs.filter((run) => run.arm === arm)]),
  );
  const byArm = Object.fromEntries(liveArms.map((arm) => [arm, aggregateArm(runsByArm[arm])]));
  const byTask = Object.fromEntries(
    taskSet.tasks.map((task) => [
      task.id,
      Object.fromEntries(
        liveArms.map((arm) => [
          arm,
          aggregateArm(runsByArm[arm].filter((run) => run.task === task.id)),
        ]),
      ),
    ]),
  );
  const report = {
    harnessVersion: HARNESS_VERSION,
    taskSetVersion: taskSet.version,
    compilerVersion: inspection.serverVersion,
    ...gitProvenance(),
    startedAt,
    finishedAt: new Date().toISOString(),
    provider: provider.name,
    model: options.model,
    settings: {
      reps: options.reps,
      maxTurns: options.maxTurns,
      maxTokens: options.maxTokens,
      temperature: options.temperature ?? 'provider default',
      concurrency: options.concurrency,
      visual: options.visual,
    },
    arms: inspection.arms,
    skippedArms,
    tasks: taskSet.tasks.map((task) => task.id),
    byArm,
    byTask,
    targets: evaluateTargets(
      byArm,
      runsByArm,
      taskSet.tasks.map((task) => task.id),
    ),
    caveats: [
      ...(inspection.instructionsMentionAfterTools
        ? [
            'the server instructions mention compose/repair, and the existing arm receives them although it cannot call those tools',
          ]
        : []),
      ...(Object.values(byArm).some((arm) => arm.usageMissingRuns > 0)
        ? ['some runs had a turn without a usage report; their tokens are left out of the medians']
        : []),
    ],
    notMeasured: [
      'human-rated page quality',
      ...(options.visual ? [] : ['visual check (run with --visual)']),
      ...(provider.name === 'openrouter'
        ? []
        : ['infra cost (only OpenRouter reports billed cost)']),
      ...Object.keys(skippedArms).map((arm) => `${arm} arm: ${skippedArms[arm]}`),
    ],
    runs,
  };
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(
    join(options.outDir, `${options.name}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(join(options.outDir, `${options.name}.md`), markdownReport(report, options.name));
  console.log(`agent-ab: wrote ${join(options.outDir, `${options.name}.{json,md}`)}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
