import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';
import { describe as describeBlock } from '../../src/registry/registry.js';

function capture(): {
  io: { stdout: (text: string) => void; stderr: (text: string) => void };
  out: () => string;
  err: () => string;
} {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
    out: () => stdout,
    err: () => stderr,
  };
}

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-cli-'));

const VALID_SPEC = `version: 1
meta:
  title: CLI fixture
blocks:
  - type: text
    text: hello
`;

const INVALID_SPEC = `version: 1
meta:
  title: CLI fixture
blocks:
  - type: text
    rawHtml: '<b>x</b>'
`;

writeFileSync(join(workspace, 'page.yaml'), VALID_SPEC);
writeFileSync(join(workspace, 'bad.yaml'), INVALID_SPEC);

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('ak-render CLI', () => {
  it('prints help on --help and exits 0', () => {
    const c = capture();
    expect(run(['--help'], c.io)).toBe(0);
    expect(c.out()).toContain('Usage:');
    expect(c.out()).toContain('validate');
  });

  it('prints one command usage on <command> --help instead of reading a file', () => {
    for (const command of ['compile', 'validate', 'describe', 'search-catalog', 'themes']) {
      const c = capture();
      expect(run([command, '--help'], c.io), command).toBe(0);
      expect(c.out()).toContain(`Usage:\n  ak-render`);
      expect(c.err()).toBe('');
    }
  });

  it('treats --help after a spec path as compile help', () => {
    const c = capture();
    expect(run([join(workspace, 'page.yaml'), '--help'], c.io)).toBe(0);
    expect(c.out()).toContain('Usage:\n  ak-render');
    expect(c.out()).not.toContain('<html');
  });

  it('creates the output folder and exits 2 when the file cannot be written', () => {
    const nested = join(workspace, 'made', 'page.html');
    expect(run([join(workspace, 'page.yaml'), '--out', nested], capture().io)).toBe(0);
    expect(existsSync(nested)).toBe(true);

    const c = capture();
    expect(run([join(workspace, 'page.yaml'), '--out', workspace], c.io)).toBe(2);
    expect(c.err()).toContain(`cannot write ${workspace}`);
  });

  it('prints the version on --version and exits 0', () => {
    const c = capture();
    expect(run(['--version'], c.io)).toBe(0);
    expect(c.out().trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('treats an unknown first argument as a spec path it cannot read', () => {
    const bare = capture();
    expect(run([], bare.io)).toBe(2);

    const unknown = capture();
    expect(run(['frobnicate'], unknown.io)).toBe(2);
    expect(unknown.err()).toContain('cannot read frobnicate');
  });

  it('advertises the compile surface it implements', () => {
    const c = capture();
    run(['--help'], c.io);
    expect(c.out()).toContain('catalog');
    expect(c.out()).toContain('describe');
    expect(c.out()).toContain('--out');
    expect(c.out()).toContain('themes');
    expect(c.out()).toContain('ak-render search-catalog <terms...>');
    expect(c.out()).toContain('ak-render describe <type...> [--compact] [--json]');
    expect(c.out()).toContain('ak-render catalog [--category <layout|content|');
  });

  it('validates a good spec with exit code 0', () => {
    const c = capture();
    expect(run(['validate', join(workspace, 'page.yaml')], c.io)).toBe(0);
    expect(c.out()).toContain('ok:');
    expect(c.out()).toContain('title: CLI fixture');
  });

  it('reports a bad spec on stderr with exit code 1', () => {
    const c = capture();
    expect(run(['validate', join(workspace, 'bad.yaml')], c.io)).toBe(1);
    expect(c.err()).toContain('$.blocks[0].rawHtml');
    expect(c.out()).toBe('');
  });

  it('emits JSON diagnostics with --json', () => {
    const c = capture();
    expect(run(['validate', join(workspace, 'bad.yaml'), '--json'], c.io)).toBe(1);
    const payload = JSON.parse(c.out()) as {
      ok: boolean;
      diagnostics: { code: string; path: string }[];
    };
    expect(payload.ok).toBe(false);
    expect(payload.diagnostics[0]).toMatchObject({ code: 'POLICY_VIOLATION' });
  });

  it('reports a missing file instead of crashing', () => {
    const c = capture();
    expect(run(['validate', join(workspace, 'nope.yaml')], c.io)).toBe(2);
    expect(c.err()).toContain('cannot read');
  });

  it('lists the catalog grouped by category', () => {
    const c = capture();
    expect(run(['catalog'], c.io)).toBe(0);
    expect(c.out()).toContain('\n## interaction\n');
    expect(c.out()).toContain(
      '\ncarousel — Carousel: prev/next, keyboard, and swipe across slides.\n',
    );
    expect(c.out().indexOf('## layout')).toBeLessThan(c.out().indexOf('## content'));
    expect(c.out()).toMatch(/\nActions: copy, /u);

    const json = capture();
    expect(run(['catalog', '--json'], json.io)).toBe(0);
    const payload = JSON.parse(json.out()) as { blockCount: number };
    expect(payload.blockCount).toBeGreaterThan(30);
  });

  it('lists one category and rejects an unknown one', () => {
    const c = capture();
    expect(run(['catalog', '--category', 'media'], c.io)).toBe(0);
    expect(c.out()).toContain('## media\n');
    expect(c.out()).not.toContain('## layout');

    const json = capture();
    expect(run(['catalog', '--category', 'media', '--json'], json.io)).toBe(0);
    const payload = JSON.parse(json.out()) as { category: string; blocks: { category: string }[] };
    expect(payload.category).toBe('media');
    expect(payload.blocks.every((entry) => entry.category === 'media')).toBe(true);

    const unknown = capture();
    expect(run(['catalog', '--category', 'widgets'], unknown.io)).toBe(1);
    expect(unknown.err()).toContain('unknown category "widgets"; expected one of: layout');

    const missing = capture();
    expect(run(['catalog', '--category'], missing.io)).toBe(2);
    expect(missing.err()).toContain('--category requires a value');
  });

  it('searches the catalog by intent', () => {
    const c = capture();
    expect(run(['search-catalog', 'architecture', 'diagram'], c.io)).toBe(0);
    expect(c.out().split('\n')[0]).toMatch(/^diagram-panel \(engineering\) — /u);

    const json = capture();
    expect(run(['search-catalog', 'keyboard shortcut', '--json'], json.io)).toBe(0);
    const hits = JSON.parse(json.out()) as { type: string; score: number }[];
    expect(hits[0]?.type).toBe('kbd');

    const none = capture();
    expect(run(['search-catalog', 'zzzqqq'], none.io)).toBe(0);
    expect(none.out()).toBe('no blocks match "zzzqqq"\n');

    const empty = capture();
    expect(run(['search-catalog'], empty.io)).toBe(2);
    expect(empty.err()).toContain('requires search terms');
  });

  it('describes several blocks, in full or compact form', () => {
    const many = capture();
    expect(run(['describe', 'tabs', 'kpi', '--json'], many.io)).toBe(0);
    const contracts = JSON.parse(many.out()) as { type: string; purpose: string }[];
    expect(contracts.map((contract) => contract.type)).toEqual(['tabs', 'kpi']);
    expect(contracts[0]?.purpose.length).toBeGreaterThan(10);

    const text = capture();
    expect(run(['describe', 'tabs', 'kpi'], text.io)).toBe(0);
    expect(text.out()).toContain('tabs (primitive, v1)\n');
    expect(text.out()).toContain('\n\nkpi (semantic, v1)\n');

    const compact = capture();
    expect(run(['describe', 'kpi', '--compact', '--json'], compact.io)).toBe(0);
    const one = JSON.parse(compact.out()) as { type: string; props: string[] };
    expect(one.type).toBe('kpi');
    expect(one.props).toContain('items: list<object>, required');

    const compactText = capture();
    expect(run(['describe', 'kpi', 'card', '--compact'], compactText.io)).toBe(0);
    expect(compactText.out()).toContain('kpi (semantic, data, v1) — KPI:');
    expect(compactText.out()).toContain('\n    items[].trend: string, enum up|down|flat\n');
    expect(compactText.out()).toContain('\n  slots:\n');

    const unknown = capture();
    expect(run(['describe', 'kpi', 'diagram-chart'], unknown.io)).toBe(1);
    expect(unknown.err()).toContain('unknown block type "diagram-chart"; closest: ');
  });

  it('keeps the single-type describe JSON byte-identical to the full contract', () => {
    for (const type of ['tabs', 'chart', 'kpi']) {
      const c = capture();
      expect(run(['describe', type, '--json'], c.io)).toBe(0);
      expect(c.out()).toBe(`${JSON.stringify(describeBlock(type), null, 2)}\n`);
    }
  });

  it('describes a block and fails cleanly for an unknown one', () => {
    const c = capture();
    expect(run(['describe', 'chart'], c.io)).toBe(0);
    expect(c.out()).toContain('bar, line, area');

    const json = capture();
    expect(run(['describe', 'chart', '--json'], json.io)).toBe(0);
    const contract = JSON.parse(json.out()) as { type: string; props: Record<string, unknown> };
    expect(contract.type).toBe('chart');
    expect(contract.props.kind).toBeDefined();

    const missing = capture();
    expect(run(['describe', 'nope'], missing.io)).toBe(1);
    expect(missing.err()).toContain('unknown block type');
  });
});
