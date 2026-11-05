/**
 * Every YAML example in the 3D docs compiles with no errors and no warnings,
 * and every 3D family member has at least one. A fence that starts with
 * `version:` is a whole Page Spec; any other fence is a block list.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createModelResolver } from '../../src/assets/model-assets.js';
import { createPointCloudResolver } from '../../src/assets/point-cloud-assets.js';
import { catalog } from '../../src/registry/registry.js';
import { compile } from '../../src/render/render.js';

const docsDir = fileURLToPath(new URL('../../docs/', import.meta.url));
// Examples name assets the way the 3D fixtures lay them out.
const assetDir = fileURLToPath(new URL('../../fixtures/3d/', import.meta.url));

interface Example {
  where: string;
  spec: Record<string, unknown>;
}

function examples(): Example[] {
  const found: Example[] = [];
  for (const file of readdirSync(docsDir).filter((name) => /^3d.*\.md$/u.test(name))) {
    const text = readFileSync(join(docsDir, file), 'utf8').replace(/\r\n/gu, '\n');
    for (const match of text.matchAll(/^```yaml\n([\s\S]*?)^```/gmu)) {
      const line = text.slice(0, match.index).split('\n').length;
      const body = match[1] ?? '';
      const data = parse(body) as unknown;
      const spec = /^version:/mu.test(body)
        ? (data as Record<string, unknown>)
        : { version: 1, meta: { title: 'Example' }, blocks: data };
      found.push({ where: `${file}:${line}`, spec });
    }
  }
  return found;
}

const all = examples();

describe('3D docs examples', () => {
  it.each(all.map((example) => [example.where, example.spec] as const))(
    '%s compiles cleanly',
    (_where, spec) => {
      const result = compile(spec, {
        modelResolver: createModelResolver(assetDir),
        pointCloudResolver: createPointCloudResolver(assetDir),
      });
      expect(result.warnings.map((warning) => warning.message)).toEqual([]);
    },
    20_000,
  );

  it('covers every 3D block type', () => {
    const types = catalog().families.find((family) => family.name === '3d')?.types ?? [];
    expect(types.length).toBeGreaterThan(0);
    const used = new Set(
      all.flatMap(({ spec }) => (spec.blocks as { type: string }[]).map((block) => block.type)),
    );
    expect(types.filter((type) => !used.has(type))).toEqual([]);
  }, 20_000);
});
