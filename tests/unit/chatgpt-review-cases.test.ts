import { describe, expect, it } from 'vitest';
import { REMOTE_TOOLS } from '../../apps/cloud/src/remote-mcp-endpoint.js';
// @ts-expect-error -- plain ESM script without type declarations
import { CASES, INVALID_SPEC, reviewSpec } from '../../scripts/chatgpt-review-cases.mjs';
import { compile, validate } from '../../src/index.js';

interface ReviewCase {
  id: string;
  kind: 'positive' | 'negative';
  prompt: string;
  tools: string[];
  expected: string;
}

const cases = CASES as ReviewCase[];

describe('ChatGPT review cases', () => {
  it('has exactly five positive and three negative cases with unique ids', () => {
    expect(cases.filter((entry) => entry.kind === 'positive')).toHaveLength(5);
    expect(cases.filter((entry) => entry.kind === 'negative')).toHaveLength(3);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    for (const entry of cases) {
      expect(entry.prompt.length).toBeGreaterThan(0);
      expect(entry.expected.length).toBeGreaterThan(0);
    }
  });

  it('names only tools the remote server serves', () => {
    const served = new Set(REMOTE_TOOLS.map((tool) => tool.name));
    for (const entry of cases) {
      for (const tool of entry.tools) expect(served.has(tool), `${entry.id}: ${tool}`).toBe(true);
    }
  });

  it.each(['report', 'dashboard', 'comparison'])(
    'the %s reviewer spec is synthetic, valid and compiles offline',
    (name) => {
      const spec = reviewSpec(name) as string;
      expect(spec).toContain('Synthetic demo data');
      expect(validate(spec).diagnostics).toEqual([]);
      const { html } = compile(spec);
      expect(html).not.toMatch(/(?:src|href)="https?:/u);
    },
  );

  it('keeps the invalid spec invalid at the paths the negative case checks', () => {
    const unknown = validate(INVALID_SPEC).diagnostics.find(
      (diagnostic) => diagnostic.code === 'SPEC_UNKNOWN_BLOCK',
    );
    expect(unknown?.path).toBe('$.blocks[1].type');
  });
});
