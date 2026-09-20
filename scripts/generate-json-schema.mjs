#!/usr/bin/env node
/**
 * Generate the published Page Spec JSON Schema from the built registry.
 *
 * The schema is generated, never hand-edited, so a documented prop and a
 * validated prop cannot disagree. `--check` fails when the committed file is
 * stale, which is what CI runs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const target = new URL('../schema/page-spec.v1.json', import.meta.url).pathname;
const checkMode = process.argv.includes('--check');

let buildPageSpecJsonSchema;
try {
  ({ buildPageSpecJsonSchema } = await import(
    new URL('../dist/registry/registry.js', import.meta.url)
  ));
} catch {
  console.error('generate-json-schema: dist/ is missing; run "pnpm build" first');
  process.exit(1);
}

const generated = `${JSON.stringify(buildPageSpecJsonSchema(), null, 2)}\n`;

if (checkMode) {
  if (!existsSync(target)) {
    console.error(`generate-json-schema: ${relative(repoRoot, target)} does not exist`);
    process.exit(1);
  }
  const committed = readFileSync(target, 'utf8');
  if (committed !== generated) {
    console.error(
      `generate-json-schema: ${relative(repoRoot, target)} is stale; run "pnpm schema:generate"`,
    );
    process.exit(1);
  }
  console.log(`generate-json-schema: ${relative(repoRoot, target)} is up to date`);
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, generated, 'utf8');
console.log(`generate-json-schema: wrote ${relative(repoRoot, target)}`);
