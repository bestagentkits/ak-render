#!/usr/bin/env node
/**
 * Legacy presentation-context baseline.
 *
 * Measures how much model context the current AgentKit HTML skills spend on
 * presentation guidance (layout, CSS, JS, charts, theming) before AK Render
 * exists. This is the reproducible half of the baseline: it reads the same
 * files a legacy HTML run is instructed to load and reports their size.
 *
 * It cannot measure model output tokens, wall-clock generation time, or retry
 * counts — those require live model runs and are recorded separately as
 * not-yet-measured in the artifact this script feeds.
 *
 * Usage:
 *   node benchmarks/legacy-context-cost.mjs --agentkit <path-to-agentkit-checkout> [--out <file>]
 *
 * Token counts are estimates with a stated method; exact counts require a
 * tokenizer run and are deliberately not claimed here.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Guidance a legacy HTML run must load, grouped by how it is reached. */
const REFERENCE_GROUPS = {
  'shared-contract': [
    'kits/core/skills/ak-preview/references/html-skill-composition.md',
    'kits/core/skills/ak-preview/references/html-mode-workflow.md',
  ],
  'always-loaded': ['kits/core/skills/ak-preview/references/html-design-guidelines.md'],
  'mode-specific': [
    'kits/core/skills/ak-preview/references/html-css-patterns.md',
    'kits/core/skills/ak-preview/references/html-libraries.md',
    'kits/core/skills/ak-preview/references/html-responsive-nav.md',
    'kits/core/skills/ak-preview/references/html-slide-patterns.md',
  ],
  'editorial-alternates': [
    'kits/core/skills/ak-preview/references/html-diagram-design.md',
    'kits/core/skills/ak-preview/references/html-antv-infographic.md',
  ],
  'preview-routing': [
    'kits/core/skills/ak-preview/references/generation-modes.md',
    'kits/core/skills/ak-preview/references/view-mode.md',
    'kits/core/skills/ak-preview/references/visual-explanation-routing.md',
  ],
  'diagram-engine': ['kits/engineer/skills/ak-diagram/references/typed-ir.md'],
  'project-blocks': [
    'kits/engineer/skills/ak-page-builder/references/block-contract.md',
    'kits/engineer/skills/ak-page-builder/references/widget-sizing.md',
    'kits/engineer/skills/ak-page-builder/references/agent-interfaces.md',
  ],
};

const CONTRACT = REFERENCE_GROUPS['shared-contract'];
const ALWAYS = REFERENCE_GROUPS['always-loaded'];
const MODE = REFERENCE_GROUPS['mode-specific'];
const EDITORIAL = REFERENCE_GROUPS['editorial-alternates'];
const ROUTING = REFERENCE_GROUPS['preview-routing'];
const DIAGRAM = REFERENCE_GROUPS['diagram-engine'];

/** Representative legacy HTML tasks: 18 document tasks plus a project-block task. */
const TASKS = [
  {
    id: 'explain-html',
    skill: 'ak:explain',
    mode: '--html',
    references: [...CONTRACT, ...ALWAYS, ...MODE],
  },
  {
    id: 'explain-diagram',
    skill: 'ak:explain',
    mode: '--diagram',
    references: [...CONTRACT, ...ALWAYS, ...MODE, ...DIAGRAM],
  },
  {
    id: 'explain-slides',
    skill: 'ak:explain',
    mode: '--slides',
    references: [...CONTRACT, ...ALWAYS, ...MODE],
  },
  {
    id: 'brainstorm-html',
    skill: 'ak:brainstorm',
    mode: '--html',
    references: [...CONTRACT, ...ALWAYS, ...MODE],
  },
  {
    id: 'plan-review-engineer',
    skill: 'ak:plan (Engineer)',
    mode: '--html',
    references: [...CONTRACT, ...ALWAYS, ...MODE],
  },
  {
    id: 'plan-review-marketing',
    skill: 'ak:plan (Marketing)',
    mode: '--html',
    references: [...CONTRACT, ...ALWAYS, ...MODE],
  },
  {
    id: 'plan-html-diagram-panel',
    skill: 'ak:plan (Engineer)',
    mode: '--html + diagram',
    references: [...CONTRACT, ...ALWAYS, ...MODE, ...DIAGRAM],
  },
  {
    id: 'plan-html-kpi-panel',
    skill: 'ak:plan (Engineer)',
    mode: '--html + KPI panel',
    references: [...CONTRACT, ...ALWAYS, ...MODE, ...EDITORIAL],
  },
  {
    id: 'preview-diff',
    skill: 'ak:preview',
    mode: '--diff',
    references: [...CONTRACT, ...ALWAYS, ...MODE, ...ROUTING],
  },
  {
    id: 'preview-plan-review',
    skill: 'ak:preview',
    mode: '--plan-review',
    references: [...CONTRACT, ...ALWAYS, ...MODE, ...ROUTING],
  },
  {
    id: 'preview-recap',
    skill: 'ak:preview',
    mode: '--recap',
    references: [...CONTRACT, ...ALWAYS, ...MODE, ...ROUTING],
  },
  {
    id: 'preview-diagram',
    skill: 'ak:preview',
    mode: '--diagram',
    references: [...CONTRACT, ...ALWAYS, ...MODE, ...ROUTING, ...DIAGRAM],
  },
  {
    id: 'preview-slides',
    skill: 'ak:preview',
    mode: '--slides',
    references: [...CONTRACT, ...ALWAYS, ...MODE, ...ROUTING],
  },
  {
    id: 'preview-editorial-architecture',
    skill: 'ak:preview',
    mode: '--diagram + editorial',
    references: [...CONTRACT, ...ALWAYS, ...MODE, ...ROUTING, ...EDITORIAL],
  },
  {
    id: 'show-off',
    skill: 'ak:show-off',
    mode: 'always HTML',
    references: [...CONTRACT, ...ALWAYS, ...MODE],
  },
  {
    id: 'retro-html',
    skill: 'ak:retro',
    mode: '--format html',
    references: [...CONTRACT, ...ALWAYS, ...MODE],
  },
  {
    id: 'advise-html',
    skill: 'ak:advise',
    mode: '--html',
    references: [...CONTRACT, ...ALWAYS, ...MODE],
  },
  {
    id: 'cti-html',
    skill: 'ak:cti-expert',
    mode: '--format html',
    references: [...CONTRACT, ...ALWAYS, ...MODE],
  },
  {
    id: 'issue-to-plan-html',
    skill: 'ak:issue-to-plan',
    mode: 'delegates ak:plan --html',
    references: [...CONTRACT, ...ALWAYS, ...MODE],
  },
  {
    id: 'page-builder-blocks',
    skill: 'ak:page-builder',
    mode: 'project block integration',
    references: REFERENCE_GROUPS['project-blocks'],
  },
];

/** Estimated tokens for a char count, with the spread implied by chars-per-token 3.5–4.5. */
function estimateTokens(chars) {
  return {
    low: Math.ceil(chars / 4.5),
    point: Math.ceil(chars / 4),
    high: Math.ceil(chars / 3.5),
  };
}

function parseArgs(argv) {
  const options = { agentkit: process.env.AGENTKIT_REPO ?? null, out: null, revision: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    const hasValue = value !== undefined;
    if (arg === '--agentkit' && hasValue) {
      options.agentkit = value;
      index += 1;
    } else if (arg === '--out' && hasValue) {
      options.out = value;
      index += 1;
    } else if (arg === '--revision' && hasValue) {
      options.revision = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node benchmarks/legacy-context-cost.mjs --agentkit <path> [--out <file>] [--revision <sha>]',
      );
      process.exit(0);
    } else {
      console.error(`legacy-context-cost: unknown argument "${arg}"`);
      process.exit(2);
    }
  }
  if (!options.agentkit) {
    console.error(
      'legacy-context-cost: an AgentKit checkout is required. Pass --agentkit <path> or set AGENTKIT_REPO.',
    );
    process.exit(2);
  }
  options.agentkit = resolve(options.agentkit);
  return options;
}

function readReference(root, relativePath) {
  const absolute = join(root, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(`missing legacy reference: ${relativePath} (looked in ${root})`);
  }
  const text = readFileSync(absolute, 'utf8');
  const bytes = statSync(absolute).size;
  const words = text.split(/\s+/u).filter((word) => word.length > 0).length;
  return {
    path: relativePath,
    bytes,
    chars: text.length,
    words,
    lines: text.split('\n').length,
    estimatedTokens: estimateTokens(text.length),
  };
}

const options = parseArgs(process.argv.slice(2));
const root = options.agentkit;

const references = [];
const byPath = new Map();
for (const [group, paths] of Object.entries(REFERENCE_GROUPS)) {
  for (const relativePath of paths) {
    if (byPath.has(relativePath)) continue;
    const measured = { group, ...readReference(root, relativePath) };
    byPath.set(relativePath, measured);
    references.push(measured);
  }
}

const tasks = TASKS.map((task) => {
  const unique = [...new Set(task.references)];
  const chars = unique.reduce((sum, path) => sum + (byPath.get(path)?.chars ?? 0), 0);
  return {
    id: task.id,
    skill: task.skill,
    mode: task.mode,
    referenceCount: unique.length,
    chars,
    estimatedTokens: estimateTokens(chars),
  };
});

const totalChars = references.reduce((sum, reference) => sum + reference.chars, 0);
const taskTokenPoints = tasks.map((task) => task.estimatedTokens.point);

const artifact = {
  artifact: 'baseline-legacy-html-context',
  producer: 'benchmarks/legacy-context-cost.mjs',
  method: {
    tokenEstimate:
      'Estimated from character count at 4 chars/token (point), bounded by 4.5 and 3.5 chars/token. Exact tokenizer counts are not claimed.',
    scope:
      'Presentation guidance the legacy shared HTML contract instructs a run to load. Does not include skill bodies, fixture content, model output, or retries.',
    agentkitRoot: root,
    agentkitRevision: options.revision,
  },
  totals: {
    referenceFiles: references.length,
    chars: totalChars,
    estimatedTokens: estimateTokens(totalChars),
    largestTaskTokens: taskTokenPoints.length > 0 ? Math.max(...taskTokenPoints) : 0,
    smallestTaskTokens: taskTokenPoints.length > 0 ? Math.min(...taskTokenPoints) : 0,
    meanTaskTokens: Math.round(
      taskTokenPoints.reduce((sum, value) => sum + value, 0) / taskTokenPoints.length,
    ),
  },
  references,
  tasks,
  notMeasured: [
    'model output tokens for HTML-producing tasks (requires live model runs)',
    'wall-clock generation time (requires live model runs)',
    'retries and repair count (requires live model runs)',
    'emitted HTML bytes for legacy tasks (no committed legacy artifact corpus in AgentKit; capture during A/B fixtures)',
    'browser console errors, network requests, a11y failures, and viewport overflow for legacy output (requires the A/B fixture harness)',
  ],
};

const outFile = options.out
  ? resolve(options.out)
  : join(REPO_ROOT, 'docs/artifacts/baseline-legacy-html-context.json');
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

const { totals } = artifact;
console.log(`Wrote ${outFile}`);
console.log(
  `Legacy presentation guidance: ${totals.referenceFiles} files, ${totals.chars} chars, ~${totals.estimatedTokens.point} tokens (${totals.estimatedTokens.low}-${totals.estimatedTokens.high})`,
);
console.log(
  `Per-task context: ${totals.smallestTaskTokens}-${totals.largestTaskTokens} tokens, mean ~${totals.meanTaskTokens} across ${tasks.length} tasks`,
);
