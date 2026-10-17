import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvImport from 'ajv';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { run } from '../../src/cli.js';
import {
  COMPOSE_INTENTS,
  compile,
  compose,
  composeInputJsonSchema,
  composeIntents,
  composeSpec,
} from '../../src/index.js';
import { handleMcpMessage } from '../../src/mcp-server.js';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../fixtures/compose/${name}`, import.meta.url)), 'utf8');

const INPUT_TEXT = fixture('investment-report.input.yaml');
const SPEC_TEXT = fixture('investment-report.spec.yaml');
const INPUT = parse(INPUT_TEXT) as { intent: string; content: Record<string, unknown> };

const minimal = (content: Record<string, unknown> = {}) => ({
  intent: 'investment-report',
  content: { title: 'Acme seed', thesis: { summary: 'Small bet, large market.' }, ...content },
});

// ajv's default export is typed as a namespace under NodeNext resolution.
const Ajv = AjvImport as unknown as new (
  options?: Record<string, unknown>,
) => { compile(schema: object): (data: unknown) => boolean };

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-compose-'));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe('compose: investment-report', () => {
  it('expands to the checked-in explicit spec', () => {
    const composed = composeSpec(INPUT_TEXT);
    expect(composed.diagnostics).toEqual([]);
    expect(composed.ok).toBe(true);
    expect(composed.spec).toEqual(parse(SPEC_TEXT));
  });

  it('compiles byte-identically to the equivalent explicit spec', () => {
    const composed = compose(INPUT);
    const explicit = compile(SPEC_TEXT);
    expect(composed.result?.html).toBe(explicit.html);
    expect(composed.result?.hash).toBe(explicit.hash);
  });

  it('is deterministic across runs and input forms', () => {
    const a = compose(INPUT_TEXT).result;
    const b = compose(structuredClone(INPUT)).result;
    expect(a?.hash).toBe(b?.hash);
  });

  it('compiles the smallest valid input with the intent default theme', () => {
    const composed = compose(minimal());
    expect(composed.ok).toBe(true);
    expect(composed.result?.theme.name).toBe('executive-report');
    expect(composed.result?.html).toContain('Acme seed');
    expect(composed.spec?.datasets).toBeUndefined();
  });

  it('honours an explicit theme', () => {
    expect(compose({ ...minimal(), theme: 'paper-ink' }).result?.theme.name).toBe('paper-ink');
  });

  it('skips compiling on a dry run but still returns the validated spec', () => {
    const composed = compose(INPUT, { dryRun: true });
    expect(composed.ok).toBe(true);
    expect(composed.result).toBeUndefined();
    expect(composed.spec).toEqual(parse(SPEC_TEXT));
  });

  it('feeds the chart and the summary table from one shared dataset', () => {
    const spec = composeSpec(INPUT).spec as { datasets: Record<string, unknown[]> };
    expect(spec.datasets.scenarios).toHaveLength(12);
    expect(spec.datasets['scenario-summary']).toEqual([
      { scenario: 'Bear', probability: 25, final: 38000000, note: 'Europe slips a year' },
      { scenario: 'Base', probability: 50, final: 78000000, note: '' },
      {
        scenario: 'Bull',
        probability: 25,
        final: 120000000,
        note: 'Second 3PL rollout lands early',
      },
    ]);
  });
});

describe('compose: diagnostics point into the compose input', () => {
  const paths = (input: unknown) => composeSpec(input).diagnostics.map((item) => item.path);

  it('reports an unknown intent with the allowed names', () => {
    const result = composeSpec({ intent: 'pitch-deck', content: {} });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      path: 'intent',
      details: { allowed: [...COMPOSE_INTENTS] },
    });
  });

  it('reports malformed YAML as a parse error', () => {
    const result = composeSpec('intent: [unclosed');
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('SPEC_PARSE_ERROR');
  });

  it('rejects a non-object input and unknown top-level fields', () => {
    expect(paths([1, 2])).toEqual(['$']);
    expect(paths({ ...minimal(), blocks: [] })).toEqual(['blocks']);
  });

  it('reports missing, unknown and mistyped slots by path, never dropping them', () => {
    expect(paths({ intent: 'investment-report', content: { thesis: {} } })).toEqual([
      'content.title',
      'content.thesis.summary',
    ]);
    expect(paths(minimal({ thesys: 'typo' }))).toEqual(['content.thesys']);
    expect(
      paths(minimal({ risks: [{ area: 'Supply', impact: 'huge', likelihood: 'low' }] })),
    ).toEqual(['content.risks[0].impact']);
  });

  it('enforces item caps', () => {
    const metrics = Array.from({ length: 9 }, (_, index) => ({ label: `M${index}`, value: '1' }));
    expect(paths(minimal({ metrics }))).toEqual(['content.metrics']);
  });

  it('needs one scenario value per period and distinct names', () => {
    const scenarios = {
      periods: ['2026', '2027', '2028'],
      items: [
        { name: 'Base', values: [1, 2] },
        { name: 'Base', values: [1, 2, 3] },
      ],
    };
    expect(paths(minimal({ scenarios }))).toEqual([
      'content.scenarios.items[0].values',
      'content.scenarios.items[1].name',
    ]);
  });

  it('warns, without failing, when probabilities do not add up to 1', () => {
    const scenarios = {
      periods: ['2026', '2027'],
      items: [
        { name: 'Bear', probability: 0.5, values: [1, 2] },
        { name: 'Bull', probability: 0.6, values: [1, 3] },
      ],
    };
    const result = compose(minimal({ scenarios }));
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toMatchObject([
      { severity: 'warning', path: 'content.scenarios.items' },
    ]);
  });
});

interface JsonSchemaNode {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  enum?: string[];
  maxLength?: number;
  maximum?: number;
}

/** A value at the schema's upper bound: longest strings, most permissive numbers. */
function atMaximum(schema: JsonSchemaNode): unknown {
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, child]) => [key, atMaximum(child)]),
      );
    case 'array':
      return [atMaximum(schema.items ?? {})];
    case 'string':
      return schema.enum?.[0] ?? 'x'.repeat(schema.maxLength ?? 1);
    default:
      return schema.maximum ?? 1;
  }
}

interface MaximalContent {
  scenarios: { periods: string[]; items: Record<string, unknown>[] };
  sources: Record<string, unknown>[];
}

describe('compose: slot caps match the blocks they fill', () => {
  it('expands every slot at its advertised maximum without a spec diagnostic', () => {
    const [intent] = composeIntents();
    if (intent === undefined) throw new Error('no intent');
    const content = atMaximum(intent.content as JsonSchemaNode) as MaximalContent;
    const longest = content.scenarios.periods[0]?.length ?? 1;
    content.scenarios.periods = ['a'.padEnd(longest, 'x'), 'b'.padEnd(longest, 'x')];
    content.scenarios.items = [
      { ...content.scenarios.items[0], values: [1e15, -1e15], probability: 1 },
    ];
    content.sources = [{ ...content.sources[0], href: 'https://example.com/a' }];
    const result = composeSpec({ intent: intent.intent, content });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reports an over-long slot at its content path, before expansion', () => {
    const result = composeSpec(minimal({ metrics: [{ label: 'ARR', value: 'x'.repeat(41) }] }));
    expect(result.diagnostics.map((item) => item.path)).toEqual(['content.metrics[0].value']);
  });

  it('never accepts inherited property names as slots', () => {
    const result = composeSpec(minimal({ constructor: 'x', toString: 1 }));
    expect(result.diagnostics.map((item) => item.path)).toEqual([
      'content.constructor',
      'content.toString',
    ]);
  });

  it('requires a whole-number year and bounded scenario values', () => {
    const scenarios = {
      periods: ['2026', '2027'],
      items: [{ name: 'Base', values: [1, 1e16] }],
    };
    expect(
      composeSpec(
        minimal({ sources: [{ title: 'Memo', year: 2000.5 }], scenarios }),
      ).diagnostics.map((item) => item.path),
    ).toEqual(['content.scenarios.items[0].values[1]', 'content.sources[0].year']);
  });

  it('rejects a repeated period', () => {
    const scenarios = { periods: ['2026', '2026'], items: [{ name: 'Base', values: [1, 2] }] };
    expect(composeSpec(minimal({ scenarios })).diagnostics.map((item) => item.path)).toEqual([
      'content.scenarios.periods[1]',
    ]);
  });

  it('reports an unknown theme on a dry run too, and lets an override replace it', () => {
    const unknown = composeSpec({ ...minimal(), theme: 'nope' });
    expect(unknown.ok).toBe(false);
    expect(unknown.diagnostics[0]).toMatchObject({ path: 'theme' });
    expect(compose({ ...minimal(), theme: 'nope' }).ok).toBe(false);
    const replaced = composeSpec({ ...minimal(), theme: 'nope' }, { theme: 'editorial' });
    expect(replaced.ok).toBe(true);
    expect(replaced.spec?.theme).toEqual({ preset: 'editorial' });
  });
});

describe('compose: one schema for discovery and validation', () => {
  const ajv = new Ajv({ strict: false, allErrors: true });
  const check = ajv.compile(composeInputJsonSchema());

  it('accepts the fixture input and lists every intent', () => {
    expect(check(INPUT)).toBe(true);
    expect(composeIntents().map((entry) => entry.intent)).toEqual([...COMPOSE_INTENTS]);
  });

  it('rejects what the validator rejects', () => {
    for (const bad of [
      minimal({ thesys: 'typo' }),
      minimal({ risks: [{ area: 'x', impact: 'huge', likelihood: 'low' }] }),
      { intent: 'investment-report', content: { thesis: { summary: 'x' } } },
    ]) {
      expect(check(bad)).toBe(false);
      expect(composeSpec(bad).ok).toBe(false);
    }
  });
});

function io() {
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
      stdin: () => INPUT_TEXT,
    },
    out: () => stdout,
    err: () => stderr,
  };
}

describe('compose: CLI', () => {
  it('writes the page and the editable spec, reporting a summary', () => {
    const out = join(workspace, 'report.html');
    const specOut = join(workspace, 'report.yaml');
    const c = io();
    expect(run(['compose', '-', '--out', out, '--spec-out', specOut, '--json'], c.io)).toBe(0);
    const summary = JSON.parse(c.out());
    expect(summary).toMatchObject({ ok: true, out, specOut, hash: compile(SPEC_TEXT).hash });
    expect(readFileSync(out, 'utf8')).toBe(compile(SPEC_TEXT).html);
    expect(parse(readFileSync(specOut, 'utf8'))).toEqual(parse(SPEC_TEXT));
  });

  it('prints the spec on a dry run', () => {
    const c = io();
    expect(run(['compose', '-', '--dry-run'], c.io)).toBe(0);
    expect(parse(c.out())).toEqual(parse(SPEC_TEXT));
  });

  it('applies --theme and reports no out on a dry run', () => {
    const themed = io();
    expect(run(['compose', '-', '--theme', 'editorial', '--json'], themed.io)).toBe(0);
    expect(JSON.parse(themed.out())).toMatchObject({ ok: true, theme: 'editorial' });

    const dry = io();
    const out = join(workspace, 'never.html');
    expect(run(['compose', '-', '--dry-run', '--out', out, '--json'], dry.io)).toBe(0);
    expect(JSON.parse(dry.out())).toMatchObject({ ok: true, out: null });
    expect(dry.err()).toContain('--out is ignored');
  });

  it('lists intents and fails on bad input with path diagnostics', () => {
    const listing = io();
    expect(run(['compose', 'intents'], listing.io)).toBe(0);
    expect(listing.out()).toContain('investment-report');

    const bad = join(workspace, 'bad.yaml');
    const c = io();
    rmSync(bad, { force: true });
    expect(run(['compose', bad], c.io)).toBe(2);
    expect(c.err()).toContain('cannot read');
  });
});

describe('compose: local MCP tool', () => {
  const context = { cwd: workspace, home: workspace };
  const call = async (args: Record<string, unknown>) => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compose', arguments: args } },
      context,
    );
    return response?.result as { isError?: boolean; content: { text: string }[] };
  };

  it('writes the HTML and answers with a summary, never the HTML', async () => {
    const reply = await call({ ...INPUT, out: 'mcp.html' });
    expect(reply.isError).toBeUndefined();
    const text = reply.content[0]?.text ?? '';
    expect(text).not.toContain('<html');
    expect(JSON.parse(text)).toMatchObject({ ok: true, hash: compile(SPEC_TEXT).hash });
    expect(readFileSync(join(workspace, 'mcp.html'), 'utf8')).toBe(compile(SPEC_TEXT).html);
  });

  it('returns the spec as YAML on a dry run without writing', async () => {
    const payload = JSON.parse((await call({ ...INPUT, dryRun: true })).content[0]?.text ?? '');
    expect(parse(payload.spec)).toEqual(parse(SPEC_TEXT));
  });

  it('returns every diagnostic as a tool error', async () => {
    const reply = await call({
      intent: 'investment-report',
      content: { title: 'x' },
      out: 'x.html',
    });
    expect(reply.isError).toBe(true);
    expect(JSON.parse(reply.content[0]?.text ?? '').diagnostics[0].path).toBe('content.thesis');
  });
});
