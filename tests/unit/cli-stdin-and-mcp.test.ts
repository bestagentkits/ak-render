import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';
import { handleMcpLine, handleMcpMessage, type McpContext } from '../../src/mcp-server.js';
import { describe as describeBlock } from '../../src/registry/registry.js';

const SPEC = `version: 1
meta:
  title: Agent fixture
blocks:
  - type: text
    text: hello
`;

const BAD_SPEC = `version: 1
meta:
  title: Agent fixture
blocks:
  - type: text
    txt: hello
`;

/** Every suggested fix in a reply's diagnostics, in order. */
function withFixes(
  diagnostics: { fixes?: { rule: string; classification: string; patch: { op: string }[] }[] }[],
) {
  return diagnostics.flatMap((diagnostic) => diagnostic.fixes ?? []);
}

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-agent-'));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

function io(stdin?: string) {
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
      ...(stdin === undefined ? {} : { stdin: () => stdin }),
    },
    out: () => stdout,
    err: () => stderr,
  };
}

describe('spec from standard input', () => {
  it('compiles a spec piped to "-"', async () => {
    const out = join(workspace, 'piped.html');
    const c = io(SPEC);
    expect(run(['-', '--out', out, '--json'], c.io)).toBe(0);
    expect(JSON.parse(c.out()).source).toBe('<stdin>');
    expect(readFileSync(out, 'utf8')).toContain('<title>Agent fixture</title>');
  });

  it('validates a piped spec and labels diagnostics with <stdin>', async () => {
    const c = io(BAD_SPEC);
    expect(run(['validate', '-', '--json'], c.io)).toBe(1);
    expect(JSON.parse(c.out()).diagnostics[0].path).toMatch(/^\$\.blocks\[0\]/u);
  });

  it('lists suggested fixes with validate --suggest, and only then', () => {
    const plain = io(BAD_SPEC);
    expect(run(['validate', '-', '--json'], plain.io)).toBe(1);
    expect(plain.out()).not.toContain('"fixes"');

    const suggested = io(BAD_SPEC);
    expect(run(['validate', '-', '--suggest', '--json'], suggested.io)).toBe(1);
    const fix = withFixes(JSON.parse(suggested.out()).diagnostics)[0];
    expect(fix).toMatchObject({ rule: 'property/rename', classification: 'ambiguous' });

    const text = io(BAD_SPEC);
    run(['validate', '-', '--suggest'], text.io);
    expect(text.err()).toContain(
      'fix (ambiguous, property/rename) $.blocks[0].txt: rename /blocks/0/txt to /blocks/0/text',
    );
  });

  it('repairs safe problems in place and leaves guesses to the author', () => {
    const file = join(workspace, 'repair-me.yaml');
    writeFileSync(file, `${SPEC}  - type: badge\n    text: x\n    tone: Info # keep me\n`, 'utf8');
    const c = io();
    expect(run(['repair', file, '--out', file], c.io)).toBe(0);
    expect(c.err()).toContain('repaired: $.blocks[1].tone: enum/case');
    expect(readFileSync(file, 'utf8')).toContain('tone: info # keep me');

    const left = io(BAD_SPEC);
    expect(run(['repair', '-', '--json'], left.io)).toBe(1);
    const report = JSON.parse(left.out());
    expect(report).toMatchObject({ ok: false, changed: false, changes: [] });
    expect(report.text).toBeUndefined();
    expect(withFixes(report.diagnostics)[0]?.classification).toBe('ambiguous');

    const unreadable = io();
    expect(run(['repair', join(workspace, 'missing.yaml')], unreadable.io)).toBe(2);
  });

  it('produces the same bytes from stdin as from the same text on disk', async () => {
    const piped = io(SPEC);
    const again = io(SPEC);
    run(['-'], piped.io);
    run(['-'], again.io);
    expect(piped.out()).toBe(again.out());
  });

  it('reports a missing stdin reader instead of throwing', async () => {
    const c = io();
    expect(run(['-'], c.io)).toBe(2);
    expect(c.err()).toContain('cannot read <stdin>');
  });

  it('documents "-" and the mcp command in help', async () => {
    const c = io();
    run(['--help'], c.io);
    expect(c.out()).toContain('spec.json|-');
    expect(c.out()).toContain('ak-render mcp');
  });
});

describe('MCP server', () => {
  const context: McpContext = { cwd: workspace, home: workspace };
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (
      await handleMcpMessage(
        { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
        context,
      )
    )?.result as { content: { text: string }[]; isError?: boolean };

  it('negotiates the requested protocol revision and announces tools', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      context,
    );
    const result = response?.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect((result.serverInfo as { name: string }).name).toBe('@bestagentkits/render');
  });

  it('answers an unknown revision with the newest it supports', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      context,
    );
    const result = response?.result as { protocolVersion: string } | undefined;
    expect(result?.protocolVersion).toBe('2025-11-25');
  });

  it('lists the tools in loop order, each described in at most 200 characters', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      context,
    );
    const result = response?.result as
      | { tools: { name: string; description: string }[] }
      | undefined;
    for (const tool of result?.tools ?? []) {
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(200);
    }
    expect(result?.tools.map((tool) => tool.name)).toEqual([
      'catalog',
      'search-catalog',
      'describe',
      'search-icons',
      'describe-icon',
      'icon-packs',
      'motions',
      'recipes',
      'recipe',
      'validate',
      'repair',
      'patch',
      'audit-motion',
      'audit-ui',
      'compose',
      'render',
      'themes',
    ]);
  });

  it('serves icon discovery with limited, SVG-free replies', async () => {
    const hits = JSON.parse(
      (await call('search-icons', { query: 'bieu do', limit: 3 })).content[0]?.text ?? '',
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(3);
    const described = (await call('describe-icon', { icon: 'gauge' })).content[0]?.text ?? '';
    expect(JSON.parse(described).icon).toBe('gauge');
    expect(described).not.toContain('<path');
    const packs = JSON.parse((await call('icon-packs')).content[0]?.text ?? '');
    expect(packs.map((pack: { pack: string }) => pack.pack)).toContain('codicons');
    const unknown = await call('describe-icon', { icon: 'gaugee' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toContain('UNKNOWN_ICON');
    expect((await call('search-icons', { query: 'x', pack: 'nope' })).isError).toBe(true);
    expect((await call('search-icons', { query: 'x', limit: 0 })).isError).toBe(true);
    expect((await call('search-icons', { query: 'x', limit: 21 })).isError).toBe(true);
    expect((await call('search-icons', { query: 'x'.repeat(201) })).isError).toBe(true);
  });

  it('serves catalog and describe', async () => {
    expect(JSON.parse((await call('catalog')).content[0]?.text ?? '').blockCount).toBeGreaterThan(
      40,
    );
    expect(JSON.parse((await call('describe', { type: 'cta' })).content[0]?.text ?? '').type).toBe(
      'cta',
    );
    expect((await call('describe', { type: 'nope' })).isError).toBe(true);
  });

  it('keeps describe with one type byte-identical to the full contract', async () => {
    for (const type of ['tabs', 'cta']) {
      const expected = JSON.stringify(describeBlock(type), null, 2);
      expect((await call('describe', { type })).content[0]?.text).toBe(expected);
      expect((await call('describe', { type, compact: false })).content[0]?.text).toBe(expected);
    }
  });

  it('filters the catalog by category', async () => {
    const listing = JSON.parse(
      (await call('catalog', { category: 'media' })).content[0]?.text ?? '',
    ) as {
      category: string;
      blocks: { category: string }[];
    };
    expect(listing.category).toBe('media');
    expect(listing.blocks.every((entry) => entry.category === 'media')).toBe(true);
    expect(
      JSON.parse((await call('catalog', { category: '' })).content[0]?.text ?? '').category,
    ).toBe(undefined);
    const unknown = await call('catalog', { category: 'widgets' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toContain('expected one of: layout');
    expect((await call('catalog', { category: 3 })).isError).toBe(true);
  });

  it('searches the catalog', async () => {
    const hits = JSON.parse(
      (await call('search-catalog', { query: 'architecture diagram' })).content[0]?.text ?? '',
    ) as { type: string }[];
    expect(hits[0]?.type).toBe('diagram-panel');
    expect((await call('search-catalog', {})).isError).toBe(true);
    expect((await call('search-catalog', { query: 'x'.repeat(201) })).isError).toBe(true);
  });

  it('describes several types, optionally compact, with exactly one of type and types', async () => {
    const many = JSON.parse(
      (await call('describe', { types: ['kpi', 'tabs', 'kpi'], compact: true })).content[0]?.text ??
        '',
    ) as { type: string; props: string[] }[];
    expect(many.map((entry) => entry.type)).toEqual(['kpi', 'tabs']);
    expect(many[0]?.props).toContain('items: list<object>, required');

    const one = JSON.parse(
      (await call('describe', { type: 'kpi', compact: true })).content[0]?.text ?? '',
    );
    expect(one.type).toBe('kpi');
    expect(Array.isArray(one.props)).toBe(true);

    const both = await call('describe', { type: 'kpi', types: ['tabs'] });
    expect(both.isError).toBe(true);
    expect(both.content[0]?.text).toContain('either "type" or "types"');
    expect((await call('describe', {})).content[0]?.text).toContain(
      '"type" must be a non-empty string',
    );
    expect((await call('describe', { types: [] })).isError).toBe(true);
    expect(
      (await call('describe', { types: Array.from({ length: 13 }, () => 'kpi') })).isError,
    ).toBe(true);
    expect((await call('describe', { type: 'kpi', compact: 'yes' })).isError).toBe(true);
    const unknown = await call('describe', { types: ['diagram-chart'] });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toContain('closest: ');
  });

  it('suggests fixes on request and repairs only what is safe', async () => {
    const plain = await call('validate', { spec: BAD_SPEC });
    expect(plain.content[0]?.text).not.toContain('"fixes"');
    const suggested = JSON.parse(
      (await call('validate', { spec: BAD_SPEC, suggest: true })).content[0]?.text ?? '',
    );
    expect(withFixes(suggested.diagnostics)[0]?.patch[0]?.op).toBe('test');
    expect((await call('validate', { spec: SPEC, suggest: 'yes' })).isError).toBe(true);

    const fixed = await call('repair', {
      spec: `${SPEC}  - type: badge\n    text: x\n    tone: Info\n`,
    });
    expect(fixed.isError).toBeUndefined();
    const reply = JSON.parse(fixed.content[0]?.text ?? '');
    expect(reply.changes.map((change: { rule: string }) => change.rule)).toEqual(['enum/case']);
    expect(reply.spec).toContain('tone: info');

    const unchanged = await call('repair', { spec: BAD_SPEC });
    expect(unchanged.isError).toBe(true);
    expect(JSON.parse(unchanged.content[0]?.text ?? '').spec).toBeUndefined();
    expect((await call('repair', { spec: SPEC, mode: 'aggressive' })).isError).toBe(true);
  });

  it('flags an invalid spec with paths to fix', async () => {
    const result = await call('validate', { spec: BAD_SPEC });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('$.blocks[0]');
    expect((await call('validate', { spec: SPEC })).isError).toBeUndefined();
  });

  it('renders to a file and returns a summary, not the HTML', async () => {
    const result = await call('render', { spec: SPEC, out: 'nested/page.html' });
    const summary = JSON.parse(result.content[0]?.text ?? '');
    expect(summary.out).toBe(join(workspace, 'nested/page.html'));
    expect(result.content[0]?.text).not.toContain('<html');
    expect(readFileSync(summary.out, 'utf8')).toContain('<title>Agent fixture</title>');
  });

  it('accepts a parsed spec object', async () => {
    const spec = { version: 1, meta: { title: 'Object' }, blocks: [{ type: 'text', text: 'x' }] };
    expect((await call('render', { spec, out: 'object.html' })).isError).toBeUndefined();
  });

  it('returns render diagnostics as a tool error', async () => {
    const result = await call('render', { spec: BAD_SPEC, out: 'bad.html' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '').code).toBe('SPEC_VALIDATION_ERROR');
  });

  it('lists presets and reports a preset file that failed to load', async () => {
    const listed = JSON.parse((await call('themes')).content[0]?.text ?? '') as {
      presets: { name: string }[];
      problems: unknown[];
    };
    expect(listed.presets.map((preset) => preset.name)).toContain('editorial');
    expect(listed.problems).toEqual([]);

    const broken = mkdtempSync(join(tmpdir(), 'ak-render-mcp-themes-'));
    mkdirSync(join(broken, '.ak-render/themes'), { recursive: true });
    writeFileSync(
      join(broken, '.ak-render/themes/bad.yaml'),
      'name: bad\nextends: editorial\ncss: "body{}"\n',
      'utf8',
    );
    const result = (
      await handleMcpMessage(
        { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'themes' } },
        { cwd: broken, home: join(broken, 'home') },
      )
    )?.result as { content: { text: string }[] };
    const withProblem = JSON.parse(result.content[0]?.text ?? '') as {
      problems: { path: string; message: string }[];
    };
    expect(withProblem.problems).toHaveLength(1);
    expect(withProblem.problems[0]?.path).toContain('bad.yaml');
    expect(withProblem.problems[0]?.message).toContain('css');
    rmSync(broken, { recursive: true, force: true });
  });

  it('only writes HTML files', async () => {
    const result = await call('render', { spec: SPEC, out: 'notes.txt' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('.html');
    expect(existsSync(join(workspace, 'notes.txt'))).toBe(false);
  });

  it('rejects an unknown tool and a null id as protocol errors', async () => {
    const unknown = await handleMcpMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } },
      context,
    );
    expect(unknown?.error?.code).toBe(-32602);
    const nullId = await handleMcpMessage({ jsonrpc: '2.0', id: null, method: 'ping' }, context);
    expect(nullId?.error?.code).toBe(-32600);
  });

  it('answers each member of a batch', async () => {
    const line = JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    const responses = JSON.parse((await handleMcpLine(line, context)) ?? '') as { id: number }[];
    expect(responses.map((response) => response.id)).toEqual([1, 2]);
    expect(JSON.parse((await handleMcpLine('[]', context)) ?? '').error.code).toBe(-32600);
  });

  it('stays silent for notifications and replies to unknown methods', async () => {
    expect(
      await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, context),
    ).toBeUndefined();
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 3, method: 'resources/list' },
      context,
    );
    expect(response?.error?.code).toBe(-32601);
  });

  it('reports a parse error on a malformed line', async () => {
    expect(JSON.parse((await handleMcpLine('{nope', context)) ?? '').error.code).toBe(-32700);
    expect(await handleMcpLine('   ', context)).toBeUndefined();
  });
});

describe('MCP motion tools', () => {
  const context: McpContext = { cwd: workspace, home: workspace };
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (
      await handleMcpMessage(
        { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name, arguments: args } },
        context,
      )
    )?.result as { content: { text: string }[]; isError?: boolean };
  const payload = (result: { content: { text: string }[] }) =>
    JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;

  const MOTION_SPEC = {
    version: 1,
    meta: { title: 'Motion MCP' },
    blocks: [{ type: 'card', id: 'ghost', title: 'Ghost', text: 'Body.', motion: 'spin-forever' }],
  };
  const CLEAN_MOTION_SPEC = {
    version: 1,
    meta: { title: 'Clean motion' },
    blocks: [{ type: 'card', id: 'solo', title: 'Solo', text: 'Body.', motion: 'reveal-soft' }],
  };

  it('lists the recipe catalog with no arguments', async () => {
    const listing = payload(await call('motions'));
    expect(listing['recipeCount']).toBe(7);
    expect(Array.isArray(listing['recipes'])).toBe(true);
  });

  it('ranks recipes for a query and returns at most the default hit count', async () => {
    const hits = JSON.parse(
      (await call('motions', { query: 'smooth tabs' })).content[0]?.text ?? '',
    ) as {
      id: string;
    }[];
    expect(hits[0]?.id).toBe('tabs-slide');
    expect(hits.length).toBeLessThanOrEqual(5);
  });

  it('describes one recipe, with the full descriptor by default and compact on request', async () => {
    const full = payload(await call('motions', { id: 'tabs-slide' }));
    expect(full['version']).toBe(1);
    const compact = payload(await call('motions', { id: 'tabs-slide', compact: true }));
    expect(compact['id']).toBe('tabs-slide');
    expect(compact).not.toHaveProperty('version');
    expect(JSON.stringify(compact)).not.toContain('@keyframes');
  });

  it('rejects a query together with an id', async () => {
    const result = await call('motions', { query: 'tabs', id: 'tabs-slide' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('either "query" or "id", not both');
  });

  it('rejects a non-boolean compact flag', async () => {
    const result = await call('motions', { id: 'tabs-slide', compact: 'yes' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"compact" must be a boolean');
  });

  it('rejects an id longer than 64 characters', async () => {
    const result = await call('motions', { id: 'x'.repeat(65) });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('longer than 64 characters');
  });

  it('answers an unknown id as a tool error that names the id', async () => {
    const result = await call('motions', { id: 'tabs-sloe' });
    expect(result.isError).toBe(true);
    const error = payload(result);
    expect(error['code']).toBe('SPEC_VALIDATION_ERROR');
    expect(error['path']).toBe('id');
    expect(String(error['message'])).toContain('unknown motion recipe');
  });

  it('audits a spec and returns the report, with a motion error as a finding', async () => {
    const clean = payload(await call('audit-motion', { spec: CLEAN_MOTION_SPEC }));
    expect(clean['mode']).toBe('spec');
    expect(clean['findings']).toEqual([]);

    const flagged = payload(await call('audit-motion', { spec: MOTION_SPEC }));
    expect((flagged['findings'] as { rule: string }[]).map((finding) => finding.rule)).toContain(
      'motion/unknown-recipe',
    );
  });

  it('audits a compiled page as HTML', async () => {
    const html = readFileSync(
      fileURLToPath(new URL('../../docs/gallery/motion-recipes.html', import.meta.url)),
      'utf8',
    );
    const report = payload(await call('audit-motion', { html }));
    expect(report['mode']).toBe('html');
    expect(report['trusted']).toBe(true);
  });

  it('requires exactly one of spec and html', async () => {
    const neither = await call('audit-motion', {});
    expect(neither.isError).toBe(true);
    expect(neither.content[0]?.text).toContain('pass exactly one of "spec" or "html"');
    const both = await call('audit-motion', { spec: CLEAN_MOTION_SPEC, html: '<p>x</p>' });
    expect(both.isError).toBe(true);
    expect(both.content[0]?.text).toContain('pass exactly one of "spec" or "html"');
  });

  it('refuses an html argument over the length limit', async () => {
    const result = await call('audit-motion', { html: 'x'.repeat(8_000_001) });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('longer than 8000000 characters');
  });

  it('refuses an html argument that is not a string', async () => {
    const result = await call('audit-motion', { html: 3 });
    expect(result.isError).toBe(true);
  });
});
