/** Markdown for an A/B harness report. Every number in it comes from the JSON companion. */

const ROWS = [
  ['totalTokens', 'Total tokens (input + output)', 'count'],
  ['inputTokens', 'Input tokens', 'count'],
  ['outputTokens', 'Output tokens', 'count'],
  ['modelTurns', 'Model turns', 'count'],
  ['toolCalls', 'Tool calls', 'count'],
  ['orchestrationCalls', 'Orchestration calls', 'count'],
  ['discoveryCalls', 'Discovery calls', 'count'],
  ['repairs', 'Repairs before first valid submission', 'count'],
  ['repairToolCalls', '`repair` tool calls', 'count'],
  ['wallMs', 'Wall time (s)', 'ms'],
  ['costUsd', 'Billed cost (USD)', 'usd'],
];
const RATES = [
  ['firstPassValid', 'First submission valid'],
  ['completed', 'Completed (page rendered, model stopped)'],
  ['correct', 'Correct (every task fact on the page)'],
];

const format = (value, unit) => {
  if (value === undefined || value === null || Number.isNaN(value)) return 'n/a';
  if (unit === 'ms') return (value / 1000).toFixed(1);
  if (unit === 'usd') return value.toFixed(4);
  if (unit === 'pct') return `${Math.round(value * 100)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};
const interval = (ci, unit) =>
  ci === undefined ? 'n/a' : `${format(ci[0], unit)} to ${format(ci[1], unit)}`;

const sumRuns = (report, arm, key) =>
  report.runs.filter((run) => run.arm === arm).reduce((total, run) => total + (run[key] ?? 0), 0);

function armTable(report) {
  const arms = Object.keys(report.byArm);
  const lines = [
    `| Metric | ${arms.map((arm) => `\`${arm}\` median (95% CI) · mean ± sd · p95`).join(' | ')} |`,
    `| --- | ${arms.map(() => '---').join(' | ')} |`,
  ];
  for (const [key, label, unit] of ROWS) {
    const cells = arms.map((arm) => {
      const stat = report.byArm[arm][key];
      if (stat === undefined || stat.n === 0) return 'n/a';
      return `${format(stat.median, unit)} (${interval(stat.medianCi95, unit)}) · ${format(stat.mean, unit)} ± ${format(stat.stddev, unit)} · ${format(stat.p95, unit)}`;
    });
    lines.push(`| ${label} | ${cells.join(' | ')} |`);
  }
  for (const [key, label] of RATES) {
    const cells = arms.map((arm) => {
      const stat = report.byArm[arm][key];
      return stat.n === 0
        ? 'n/a'
        : `${format(stat.rate, 'pct')} (${interval(stat.ci95, 'pct')}), n=${stat.n}`;
    });
    lines.push(`| ${label} | ${cells.join(' | ')} |`);
  }
  lines.push(
    `| Critical mobile overflow | ${arms
      .map((arm) => {
        const stat = report.byArm[arm];
        return stat.visualAudited === 0
          ? 'not checked'
          : `${stat.criticalMobileOverflowRuns} of ${stat.visualAudited} runs`;
      })
      .join(' | ')} |`,
    `| Runs (errored) | ${arms.map((arm) => `${report.byArm[arm].runs} (${report.byArm[arm].errors})`).join(' | ')} |`,
    `| Runs without a usage report | ${arms.map((arm) => report.byArm[arm].usageMissingRuns ?? 0).join(' | ')} |`,
    `| Model turns cut at the token limit | ${arms.map((arm) => sumRuns(report, arm, 'truncatedTurns')).join(' | ')} |`,
    `| Provider retries | ${arms.map((arm) => sumRuns(report, arm, 'retries')).join(' | ')} |`,
  );
  return lines.join('\n');
}

function taskTable(report) {
  const arms = Object.keys(report.byArm);
  const lines = [
    `| Task | ${arms.map((arm) => `\`${arm}\` tokens · calls · repairs · correct`).join(' | ')} |`,
    `| --- | ${arms.map(() => '---').join(' | ')} |`,
  ];
  for (const [task, perArm] of Object.entries(report.byTask)) {
    const cells = arms.map((arm) => {
      const stat = perArm[arm];
      if (stat.totalTokens.n === 0) return 'n/a';
      return `${format(stat.totalTokens.median)} · ${format(stat.toolCalls.median)} · ${format(stat.repairs.median)} · ${format(stat.correct.rate, 'pct')}`;
    });
    lines.push(`| \`${task}\` | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function targetTable(report) {
  const lines = ['| Target | Status | Measured | 95% CI |', '| --- | --- | ---: | --- |'];
  for (const target of report.targets) {
    const unit =
      target.id.endsWith('reduction') || target.id === 'first-pass-valid' ? 'pct' : 'count';
    const measured = target.point === undefined ? 'n/a' : format(target.point, unit);
    const status = target.status === 'not measured' ? `not measured: ${target.why}` : target.status;
    lines.push(`| ${target.target} | ${status} | ${measured} | ${interval(target.ci95, unit)} |`);
  }
  return lines.join('\n');
}

/** First repetition of each task, the tool sequence per arm, side by side. */
function traceTable(report) {
  const arms = Object.keys(report.byArm);
  const lines = [
    `| Task | ${arms.map((arm) => `\`${arm}\``).join(' | ')} |`,
    `| --- | ${arms.map(() => '---').join(' | ')} |`,
  ];
  for (const task of report.tasks) {
    const cells = arms.map((arm) => {
      const run = report.runs.find(
        (entry) => entry.task === task && entry.arm === arm && entry.rep === 1,
      );
      if (run === undefined) return 'n/a';
      if (run.error !== undefined) return `error: ${run.error.slice(0, 80)}`;
      return (
        run.trace.map((call) => (call.isError ? `${call.name}✗` : call.name)).join(' → ') ||
        '(no tool call)'
      );
    });
    lines.push(`| \`${task}\` | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

export function markdownReport(report, name) {
  const skipped = Object.entries(report.skippedArms);
  return `# Agent task cost: live-model A/B

Generated by \`benchmarks/agent-ab-harness.mjs\` (harness v${report.harnessVersion}, task set v${report.taskSetVersion}) against \`ak-render ${report.compilerVersion}\`${report.gitSha === undefined ? '' : ` at \`${report.gitSha.slice(0, 12)}\`${report.gitDirty ? ' with uncommitted changes' : ''}`}. Machine-readable companion with every run and its tool trace: [\`${name}.json\`](./${name}.json).

Every number here is **measured** from live model runs: tokens are the provider's own usage report, not an estimate. Targets are what the harness tests, not claims; a target is \`not measured\` unless both arms ran.

- Provider \`${report.provider}\`, model \`${report.model}\`, temperature ${report.settings.temperature}.
- ${report.tasks.length} tasks × ${report.settings.reps} repetitions per arm, at most ${report.settings.maxTurns} model turns per run, ${report.settings.concurrency} runs in flight.
- Run from ${report.startedAt} to ${report.finishedAt}.
${(report.caveats ?? []).map((caveat) => `- Caveat: ${caveat}.`).join('\n')}
${skipped.length === 0 ? '' : `\n**Skipped arms:** ${skipped.map(([arm, why]) => `\`${arm}\`: ${why}.`).join(' ')}\n`}
## Per arm

Orchestration calls are \`validate\`, \`render\`, \`compose\` and \`repair\`; every other tool call is discovery. A submission is a \`validate\`, \`render\` or \`compose\` call; repairs count the failed submissions before the first valid one. Rates count every run, an errored run as a failure; medians come from the runs that did not error. Wall time excludes provider back-off.

${armTable(report)}

## Targets

${targetTable(report)}

## Per task (medians)

${taskTable(report)}

## Traces (first repetition)

✗ marks a call that returned an error.

${traceTable(report)}

## Not measured

${report.notMeasured.map((item) => `- ${item}`).join('\n')}
`;
}
