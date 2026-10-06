import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  it('compiles a spec piped to "-"', () => {
    const out = join(workspace, 'piped.html');
    const c = io(SPEC);
    expect(run(['-', '--out', out, '--json'], c.io)).toBe(0);
    expect(JSON.parse(c.out()).source).toBe('<stdin>');
    expect(readFileSync(out, 'utf8')).toContain('<title>Agent fixture</title>');
  });

  it('validates a piped spec and labels diagnostics with <stdin>', () => {
    const c = io(BAD_SPEC);
    expect(run(['validate', '-', '--json'], c.io)).toBe(1);
    expect(JSON.parse(c.out()).diagnostics[0].path).toMatch(/^\$\.blocks\[0\]/u);
  });

  it('produces the same bytes from stdin as from the same text on disk', () => {
    const piped = io(SPEC);
    const again = io(SPEC);
    run(['-'], piped.io);
    run(['-'], again.io);
    expect(piped.out()).toBe(again.out());
  });

  it('reports a missing stdin reader instead of throwing', () => {
    const c = io();
    expect(run(['-'], c.io)).toBe(2);
    expect(c.err()).toContain('cannot read <stdin>');
  });

  it('documents "-" and the mcp command in help', () => {
    const c = io();
    run(['--help'], c.io);
    expect(c.out()).toContain('spec.json|-');
    expect(c.out()).toContain('ak-render mcp');
  });
});

describe('MCP server', () => {
  const context: McpContext = { cwd: workspace, home: workspace };
  const call = (name: string, args: Record<string, unknown> = {}) =>
    handleMcpMessage(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
      context,
    )?.result as { content: { text: string }[]; isError?: boolean };

  it('negotiates the requested protocol revision and announces tools', () => {
    const response = handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      context,
    );
    const result = response?.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect((result.serverInfo as { name: string }).name).toBe('@bestagentkits/render');
  });

  it('answers an unknown revision with the newest it supports', () => {
    const response = handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      context,
    );
    const result = response?.result as { protocolVersion: string } | undefined;
    expect(result?.protocolVersion).toBe('2025-11-25');
  });

  it('lists the six tools in loop order, each described in at most 200 characters', () => {
    const response = handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, context);
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
      'validate',
      'render',
      'themes',
    ]);
  });

  it('serves catalog and describe', () => {
    expect(JSON.parse(call('catalog').content[0]?.text ?? '').blockCount).toBeGreaterThan(40);
    expect(JSON.parse(call('describe', { type: 'cta' }).content[0]?.text ?? '').type).toBe('cta');
    expect(call('describe', { type: 'nope' }).isError).toBe(true);
  });

  it('keeps describe with one type byte-identical to the full contract', () => {
    for (const type of ['tabs', 'cta']) {
      const expected = JSON.stringify(describeBlock(type), null, 2);
      expect(call('describe', { type }).content[0]?.text).toBe(expected);
      expect(call('describe', { type, compact: false }).content[0]?.text).toBe(expected);
    }
  });

  it('filters the catalog by category', () => {
    const listing = JSON.parse(call('catalog', { category: 'media' }).content[0]?.text ?? '') as {
      category: string;
      blocks: { category: string }[];
    };
    expect(listing.category).toBe('media');
    expect(listing.blocks.every((entry) => entry.category === 'media')).toBe(true);
    expect(JSON.parse(call('catalog', { category: '' }).content[0]?.text ?? '').category).toBe(
      undefined,
    );
    const unknown = call('catalog', { category: 'widgets' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toContain('expected one of: layout');
    expect(call('catalog', { category: 3 }).isError).toBe(true);
  });

  it('searches the catalog', () => {
    const hits = JSON.parse(
      call('search-catalog', { query: 'architecture diagram' }).content[0]?.text ?? '',
    ) as { type: string }[];
    expect(hits[0]?.type).toBe('diagram-panel');
    expect(call('search-catalog', {}).isError).toBe(true);
    expect(call('search-catalog', { query: 'x'.repeat(201) }).isError).toBe(true);
  });

  it('describes several types, optionally compact, with exactly one of type and types', () => {
    const many = JSON.parse(
      call('describe', { types: ['kpi', 'tabs', 'kpi'], compact: true }).content[0]?.text ?? '',
    ) as { type: string; props: string[] }[];
    expect(many.map((entry) => entry.type)).toEqual(['kpi', 'tabs']);
    expect(many[0]?.props).toContain('items: list<object>, required');

    const one = JSON.parse(call('describe', { type: 'kpi', compact: true }).content[0]?.text ?? '');
    expect(one.type).toBe('kpi');
    expect(Array.isArray(one.props)).toBe(true);

    const both = call('describe', { type: 'kpi', types: ['tabs'] });
    expect(both.isError).toBe(true);
    expect(both.content[0]?.text).toContain('either "type" or "types"');
    expect(call('describe', {}).content[0]?.text).toContain('"type" must be a non-empty string');
    expect(call('describe', { types: [] }).isError).toBe(true);
    expect(call('describe', { types: Array.from({ length: 13 }, () => 'kpi') }).isError).toBe(true);
    expect(call('describe', { type: 'kpi', compact: 'yes' }).isError).toBe(true);
    const unknown = call('describe', { types: ['diagram-chart'] });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toContain('closest: ');
  });

  it('flags an invalid spec with paths to fix', () => {
    const result = call('validate', { spec: BAD_SPEC });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('$.blocks[0]');
    expect(call('validate', { spec: SPEC }).isError).toBeUndefined();
  });

  it('renders to a file and returns a summary, not the HTML', () => {
    const result = call('render', { spec: SPEC, out: 'nested/page.html' });
    const summary = JSON.parse(result.content[0]?.text ?? '');
    expect(summary.out).toBe(join(workspace, 'nested/page.html'));
    expect(result.content[0]?.text).not.toContain('<html');
    expect(readFileSync(summary.out, 'utf8')).toContain('<title>Agent fixture</title>');
  });

  it('accepts a parsed spec object', () => {
    const spec = { version: 1, meta: { title: 'Object' }, blocks: [{ type: 'text', text: 'x' }] };
    expect(call('render', { spec, out: 'object.html' }).isError).toBeUndefined();
  });

  it('returns render diagnostics as a tool error', () => {
    const result = call('render', { spec: BAD_SPEC, out: 'bad.html' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '').code).toBe('SPEC_VALIDATION_ERROR');
  });

  it('lists presets and reports a preset file that failed to load', () => {
    const listed = JSON.parse(call('themes').content[0]?.text ?? '') as {
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
    const result = handleMcpMessage(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'themes' } },
      { cwd: broken, home: join(broken, 'home') },
    )?.result as { content: { text: string }[] };
    const withProblem = JSON.parse(result.content[0]?.text ?? '') as {
      problems: { path: string; message: string }[];
    };
    expect(withProblem.problems).toHaveLength(1);
    expect(withProblem.problems[0]?.path).toContain('bad.yaml');
    expect(withProblem.problems[0]?.message).toContain('css');
    rmSync(broken, { recursive: true, force: true });
  });

  it('only writes HTML files', () => {
    const result = call('render', { spec: SPEC, out: 'notes.txt' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('.html');
    expect(existsSync(join(workspace, 'notes.txt'))).toBe(false);
  });

  it('rejects an unknown tool and a null id as protocol errors', () => {
    const unknown = handleMcpMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } },
      context,
    );
    expect(unknown?.error?.code).toBe(-32602);
    const nullId = handleMcpMessage({ jsonrpc: '2.0', id: null, method: 'ping' }, context);
    expect(nullId?.error?.code).toBe(-32600);
  });

  it('answers each member of a batch', () => {
    const line = JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    const responses = JSON.parse(handleMcpLine(line, context) ?? '') as { id: number }[];
    expect(responses.map((response) => response.id)).toEqual([1, 2]);
    expect(JSON.parse(handleMcpLine('[]', context) ?? '').error.code).toBe(-32600);
  });

  it('stays silent for notifications and replies to unknown methods', () => {
    expect(
      handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, context),
    ).toBeUndefined();
    const response = handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, context);
    expect(response?.error?.code).toBe(-32601);
  });

  it('reports a parse error on a malformed line', () => {
    expect(JSON.parse(handleMcpLine('{nope', context) ?? '').error.code).toBe(-32700);
    expect(handleMcpLine('   ', context)).toBeUndefined();
  });
});
