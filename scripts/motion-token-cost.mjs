#!/usr/bin/env node
/**
 * Compare what an agent reads to pick a motion recipe, before and after the
 * motion discovery tools.
 *
 * The task is fixed: "make the tabs switch smoothly". Each workflow is the
 * exact text an agent would receive, taken from the built MCP tools and the
 * committed files, so the numbers move only when those change. Tokens are
 * estimated as characters / 4; the ratio between workflows is what matters,
 * not the absolute count for any one tokenizer.
 *
 * Run `pnpm build` first, then `node scripts/motion-token-cost.mjs`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let MOTIONS_TOOL;
try {
  ({ MOTIONS_TOOL } = await import(
    new URL('../dist/mcp/mcp-tool-definitions.js', import.meta.url)
  ));
} catch {
  console.error('motion-token-cost: dist/ is missing; run "pnpm build" first');
  process.exit(1);
}

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const tool = (args) => MOTIONS_TOOL.run(args, {}).content[0].text;
// The guide's recipe sections, without the discovery section that documents
// the tools themselves.
const guide = read('docs/motion.md');
const discovery = guide.indexOf('\n## Discovery and audit');
const guideBefore = discovery > 0 ? guide.slice(0, discovery) : guide;

const workflows = [
  {
    name: 'Before: read the motion guide',
    steps: ['docs/motion.md'],
    texts: [guideBefore],
  },
  {
    name: 'Before: read the recipe registry source',
    steps: ['src/motion/recipes.ts'],
    texts: [read('src/motion/recipes.ts')],
  },
  {
    name: 'After: search, then compact describe',
    steps: ['motions { query: "smooth tabs" }', 'motions { id: "tabs-slide", compact: true }'],
    texts: [tool({ query: 'smooth tabs' }), tool({ id: 'tabs-slide', compact: true })],
  },
  {
    name: 'After: list every recipe, then compact describe',
    steps: ['motions {}', 'motions { id: "tabs-slide", compact: true }'],
    texts: [tool({}), tool({ id: 'tabs-slide', compact: true })],
  },
];

const tokens = (chars) => Math.ceil(chars / 4);
const rows = workflows.map((workflow) => {
  const chars = workflow.texts.reduce((sum, text) => sum + text.length, 0);
  return { ...workflow, chars, tokens: tokens(chars) };
});
const baseline = rows[0].tokens;

console.log('| Workflow | Reads | Characters | ~Tokens | vs. guide |');
console.log('| --- | --- | ---: | ---: | ---: |');
for (const row of rows) {
  const ratio = `${Math.round((row.tokens / baseline) * 100)}%`;
  const reads = row.steps.map((step) => `\`${step}\``).join(' + ');
  console.log(`| ${row.name} | ${reads} | ${row.chars} | ${row.tokens} | ${ratio} |`);
}
