import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';

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

  it('prints the version on --version and exits 0', () => {
    const c = capture();
    expect(run(['--version'], c.io)).toBe(0);
    expect(c.out().trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('uses exit code 2 for a bare invocation and for unknown commands', () => {
    const bare = capture();
    expect(run([], bare.io)).toBe(2);

    const unknown = capture();
    expect(run(['frobnicate'], unknown.io)).toBe(2);
    expect(unknown.err()).toContain('unknown command "frobnicate"');
  });

  it('only advertises commands it implements', () => {
    const c = capture();
    run(['--help'], c.io);
    expect(c.out()).toContain('catalog');
    expect(c.out()).toContain('describe');
    // Compile arrives with the compiler milestone; help must not promise it yet.
    expect(c.out()).not.toContain('--out');
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

  it('lists the catalog', () => {
    const c = capture();
    expect(run(['catalog'], c.io)).toBe(0);
    expect(c.out()).toContain('carousel');

    const json = capture();
    expect(run(['catalog', '--json'], json.io)).toBe(0);
    const payload = JSON.parse(json.out()) as { blockCount: number };
    expect(payload.blockCount).toBeGreaterThan(30);
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
