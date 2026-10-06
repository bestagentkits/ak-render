import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { run } from '../../src/cli.js';
import { isRenderError, RenderError } from '../../src/errors.js';
import { recipe, recipes } from '../../src/index.js';
import { handleMcpMessage } from '../../src/mcp-server.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';
import { validate } from '../../src/spec/validate.js';
import { builtinPresetEntries } from '../../src/theme/presets.js';

const RECIPES_DIR = join(import.meta.dirname, '../../src/recipes/page-recipes');
const MAX_SPEC_BYTES = 3000;

const EXPECTED_NAMES = [
  'architecture-review',
  'benchmark-report',
  'case-study',
  'dashboard',
  'decision-memo',
  'implementation-plan',
  'incident-report',
  'product-showcase',
  'release-recap',
  'research-report',
];

const names = recipes().map((entry) => entry.name);

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: (text: string) => {
        stdout += text;
      },
      stderr: (text: string) => {
        stderr += text;
      },
    },
    out: () => stdout,
    err: () => stderr,
  };
}

describe('recipe listing', () => {
  it('lists every recipe once, sorted by name', () => {
    expect(names).toEqual(EXPECTED_NAMES);
    expect([...names].sort()).toEqual(names);
  });

  it('has one embedded recipe per YAML source, with the metadata lines stripped', () => {
    const files = readdirSync(RECIPES_DIR)
      .filter((file) => file.endsWith('.yaml'))
      .sort();
    expect(files.map((file) => file.replace(/\.yaml$/u, ''))).toEqual(names);
    for (const file of files) {
      const source = readFileSync(join(RECIPES_DIR, file), 'utf8');
      const spec = recipe(file.replace(/\.yaml$/u, '')).spec;
      expect(source.endsWith(spec), file).toBe(true);
      expect(spec.startsWith('version: 1\n'), file).toBe(true);
    }
  });

  it('describes each recipe without its spec', () => {
    for (const entry of recipes()) {
      expect(Object.keys(entry).sort()).toEqual(['blocks', 'name', 'summary', 'useCases']);
      expect(entry.summary.length, entry.name).toBeGreaterThan(0);
      expect(entry.useCases.length, entry.name).toBeGreaterThan(0);
    }
  });

  it('hands out copies, so a caller cannot change the embedded data', () => {
    const first = recipe('dashboard');
    first.blocks.push('changed');
    first.useCases.length = 0;
    recipes()[0]?.blocks.push('changed');
    expect(recipe('dashboard').blocks).not.toContain('changed');
    expect(recipe('dashboard').useCases.length).toBeGreaterThan(0);
    expect(recipes()[0]?.blocks).not.toContain('changed');
  });
});

describe.each(EXPECTED_NAMES)('recipe %s', (name) => {
  const entry = recipe(name);

  it('validates with no errors and no warnings', () => {
    const result = validate(entry.spec, { source: `${name}.yaml` });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('compiles to the same bytes every time', () => {
    const hashes = [1, 2, 3].map(() => compile(entry.spec).hash);
    expect(new Set(hashes).size).toBe(1);
  });

  it('stays a compact starter spec', () => {
    expect(Buffer.byteLength(entry.spec, 'utf8')).toBeLessThanOrEqual(MAX_SPEC_BYTES);
  });

  it('lists exactly the block types the compiler sees, at least three of them', () => {
    const types = new Set(normalizeSpec(entry.spec).ir.nodes.map((node) => node.type));
    types.delete('page');
    expect(entry.blocks).toEqual([...types].sort());
    expect(entry.blocks.length).toBeGreaterThanOrEqual(3);
  });

  it('names a built-in preset, marks its placeholders and loads nothing remote', () => {
    const document = parse(entry.spec) as { theme?: { preset?: string } };
    expect(Object.keys(builtinPresetEntries())).toContain(document.theme?.preset);
    expect(entry.spec).toContain('Replace with');
    expect(entry.spec).not.toMatch(/(?:https?:)?\/\//u);
    expect(compile(entry.spec).html).not.toMatch(/\s(?:src|href)="(?:https?:)?\/\//u);
  });
});

describe('unknown recipe', () => {
  it('throws a RenderError that lists the allowed names', () => {
    let thrown: unknown;
    try {
      recipe('newsletter');
    } catch (error) {
      thrown = error;
    }
    expect(isRenderError(thrown)).toBe(true);
    const error = thrown as RenderError;
    expect(error).toBeInstanceOf(RenderError);
    expect(error.code).toBe('SPEC_VALIDATION_ERROR');
    expect(error.path).toBe('name');
    expect(error.message).toContain('unknown recipe "newsletter"');
    for (const allowed of EXPECTED_NAMES) expect(error.message).toContain(allowed);
    expect(error.details).toEqual({ name: 'newsletter', allowed: EXPECTED_NAMES });
  });
});

describe('CLI', () => {
  it('lists recipes as text and as JSON', () => {
    const text = capture();
    expect(run(['recipes'], text.io)).toBe(0);
    const lines = text.out().trimEnd().split('\n');
    expect(lines.map((line) => line.split(/\s+/u)[0])).toEqual(EXPECTED_NAMES);

    const json = capture();
    expect(run(['recipes', '--json'], json.io)).toBe(0);
    expect(JSON.parse(json.out())).toEqual(recipes());
  });

  it('prints a recipe as YAML by default and in full with --json', () => {
    const yaml = capture();
    expect(run(['recipe', 'incident-report'], yaml.io)).toBe(0);
    expect(yaml.out()).toBe(recipe('incident-report').spec);
    expect(validate(yaml.out()).ok).toBe(true);

    const json = capture();
    expect(run(['recipe', 'incident-report', '--json'], json.io)).toBe(0);
    expect(JSON.parse(json.out())).toEqual(recipe('incident-report'));
  });

  it('exits 1 for an unknown recipe and 2 without a name', () => {
    const unknown = capture();
    expect(run(['recipe', 'newsletter'], unknown.io)).toBe(1);
    expect(unknown.err()).toContain('unknown recipe "newsletter"; expected one of: architecture');
    expect(unknown.out()).toBe('');

    const missing = capture();
    expect(run(['recipe'], missing.io)).toBe(2);
    expect(missing.err()).toContain('recipe requires a recipe name');
  });

  it('advertises both commands in help', () => {
    const help = capture();
    run(['--help'], help.io);
    expect(help.out()).toContain('ak-render recipes [--json]');
    expect(help.out()).toContain('ak-render recipe <name> [--json]');
  });
});

describe('MCP', () => {
  const call = (name: string, args: Record<string, unknown> = {}) =>
    handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      { cwd: '/', home: '/' },
    )?.result as { content: { text: string }[]; isError?: boolean };

  it('lists recipes', () => {
    const reply = call('recipes');
    expect(reply.isError).toBeUndefined();
    expect(JSON.parse(reply.content[0]?.text ?? '')).toEqual(recipes());
  });

  it('returns one recipe as its YAML spec', () => {
    const reply = call('recipe', { name: 'dashboard' });
    expect(reply.isError).toBeUndefined();
    expect(reply.content[0]?.text).toBe(recipe('dashboard').spec);
  });

  it('reports an unknown or missing name as a tool error', () => {
    const unknown = call('recipe', { name: 'newsletter' });
    expect(unknown.isError).toBe(true);
    expect(JSON.parse(unknown.content[0]?.text ?? '')).toMatchObject({
      code: 'SPEC_VALIDATION_ERROR',
      path: 'name',
    });
    const missing = call('recipe', {});
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toContain('"name" must be a non-empty string');
  });
});
