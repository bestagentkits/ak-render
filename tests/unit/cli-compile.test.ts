import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-compile-'));

writeFileSync(
  join(workspace, 'page.yaml'),
  `version: 1
meta:
  title: CLI fixture
blocks:
  - type: text
    text: hello
`,
);

writeFileSync(
  join(workspace, 'bad.yaml'),
  `version: 1
meta:
  title: CLI fixture
blocks:
  - type: text
    rawHtml: '<b>x</b>'
`,
);

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

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

const SOURCE = join(workspace, 'page.yaml');
const OUTPUT = join(workspace, 'page.html');

describe('ak-render compile', () => {
  it('compiles to stdout with the artifact on stdout and the summary on stderr', () => {
    const c = capture();
    expect(run([SOURCE], c.io)).toBe(0);
    expect(c.out()).toContain('<!DOCTYPE html>');
    expect(c.out()).toContain('Content-Security-Policy');
    expect(c.err()).toContain('runtime features');
    expect(c.err()).toContain('hash');
  });

  it('writes the artifact with --out and reports a content hash', () => {
    const c = capture();
    expect(run([SOURCE, '--out', OUTPUT], c.io)).toBe(0);
    expect(existsSync(OUTPUT)).toBe(true);
    const written = readFileSync(OUTPUT, 'utf8');
    expect(written).toContain('<!DOCTYPE html>');
    expect(c.out()).toContain('wrote');

    // Recompiling produces identical bytes: determinism is observable from the CLI.
    const again = capture();
    expect(run([SOURCE, '--out', `${OUTPUT}.again`], again.io)).toBe(0);
    expect(readFileSync(`${OUTPUT}.again`, 'utf8')).toBe(written);
  });

  it('emits a JSON summary with --json', () => {
    const c = capture();
    expect(run([SOURCE, '--out', OUTPUT, '--json'], c.io)).toBe(0);
    const summary = JSON.parse(c.out()) as {
      bytes: number;
      hash: string;
      title: string;
      theme: string;
      features: string[];
      nodes: number;
    };
    expect(summary.title).toBe('CLI fixture');
    expect(summary.bytes).toBeGreaterThan(200);
    expect(summary.hash).toMatch(/^[a-z0-9]+$/u);
    expect(summary.features).toContain('theme');
    expect(summary.nodes).toBeGreaterThan(1);
  });

  it('honours --theme', () => {
    const blueprint = capture();
    expect(run([SOURCE, '--out', OUTPUT, '--theme', 'blueprint', '--json'], blueprint.io)).toBe(0);
    const first = JSON.parse(blueprint.out()) as { theme: string; hash: string };
    expect(first.theme).toBe('blueprint');

    const editorial = capture();
    expect(run([SOURCE, '--out', OUTPUT, '--theme', 'editorial', '--json'], editorial.io)).toBe(0);
    const second = JSON.parse(editorial.out()) as { hash: string };
    expect(second.hash).not.toBe(first.hash);
  });

  it('rejects an unknown theme with exit code 1', () => {
    const c = capture();
    expect(run([SOURCE, '--out', OUTPUT, '--theme', 'no-such-preset'], c.io)).toBe(1);
    expect(c.err()).toContain('unknown theme preset');
  });

  it('reports a spec error with its path and exit code 1', () => {
    const c = capture();
    expect(run([join(workspace, 'bad.yaml'), '--out', join(workspace, 'bad.html')], c.io)).toBe(1);
    expect(c.err()).toContain('$.blocks[0].rawHtml');
  });

  it('lists the built-in themes', () => {
    const c = capture();
    expect(run(['themes'], c.io)).toBe(0);
    for (const name of [
      'blueprint',
      'editorial',
      'paper-ink',
      'terminal-mono',
      'swiss-clean',
      'warm-signal',
    ]) {
      expect(c.out()).toContain(name);
    }
  });
});
