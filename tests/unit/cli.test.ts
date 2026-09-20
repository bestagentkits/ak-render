import { describe, expect, it } from 'vitest';
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

describe('ak-render CLI', () => {
  it('prints help on --help and exits 0', () => {
    const c = capture();
    expect(run(['--help'], c.io)).toBe(0);
    expect(c.out()).toContain('ak-render');
    expect(c.out()).toContain('Usage:');
  });

  it('prints the version on --version and exits 0', () => {
    const c = capture();
    expect(run(['--version'], c.io)).toBe(0);
    expect(c.out().trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('uses exit code 2 for a bare invocation and for unknown commands', () => {
    const bare = capture();
    expect(run([], bare.io)).toBe(2);
    expect(bare.out()).toContain('Usage:');

    const unknown = capture();
    expect(run(['frobnicate'], unknown.io)).toBe(2);
    expect(unknown.err()).toContain('unknown command "frobnicate"');
  });

  it('does not advertise unimplemented compiler commands as available', () => {
    const c = capture();
    run(['--help'], c.io);
    expect(c.out()).not.toMatch(/^\s+ak-render \S+\.ya?ml/m);
  });
});
