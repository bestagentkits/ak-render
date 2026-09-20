import { describe, expect, it } from 'vitest';
import { isRenderError, type RenderError } from '../../src/index.js';
import { normalize, normalizeSpec } from '../../src/spec/normalize.js';

const MINIMAL = 'version: 1\nmeta:\n  title: Minimal\nblocks:\n  - type: text\n    text: hello\n';

function errorFrom(input: unknown): RenderError {
  try {
    normalize(input);
  } catch (error) {
    if (isRenderError(error)) return error;
    throw error;
  }
  throw new Error('expected normalize to throw');
}

describe('normalizer', () => {
  it('produces a flat IR with a synthesized root', () => {
    const ir = normalize(MINIMAL);
    expect(ir.rootId).toBe('page');
    expect(ir.nodes[0]?.type).toBe('page');
    expect(ir.nodes).toHaveLength(2);
    const text = ir.nodes[1];
    expect(text?.type).toBe('text');
    expect(text?.parentId).toBe('page');
    expect(text?.path).toBe('$.blocks[0]');
    expect(ir.nodes[0]?.children).toEqual([text?.id]);
  });

  it('applies envelope defaults for theme, policy, locale, and state', () => {
    const ir = normalize(MINIMAL);
    expect(ir.theme.preset).toBe('editorial');
    expect(ir.policy.network).toBe('deny');
    expect(ir.meta.locale).toBe('en');
    expect(ir.state).toEqual({});
  });

  it('derives stable node IDs from content identity, not from a counter or clock', () => {
    const first = normalize(MINIMAL);
    const second = normalize(MINIMAL);
    expect(first.nodes.map((node) => node.id)).toEqual(second.nodes.map((node) => node.id));
    expect(first.nodes[1]?.id).toMatch(/^n-[a-z0-9]{10}$/);
  });

  it('changes a derived ID when the node moves, and keeps an authored ID fixed', () => {
    const moved = normalize(
      'version: 1\nmeta:\n  title: M\nblocks:\n  - type: text\n    text: a\n  - type: text\n    text: b\n',
    );
    const authored = normalize(
      'version: 1\nmeta:\n  title: M\nblocks:\n  - type: text\n    id: pinned\n    text: a\n  - type: text\n    text: b\n',
    );
    expect(moved.nodes[1]?.id).not.toBe(authored.nodes[1]?.id);
    expect(authored.nodes[1]?.id).toBe('pinned');
  });

  it('builds nested nodes and records the child order', () => {
    const ir = normalize(
      [
        'version: 1',
        'meta: {title: Nested}',
        'blocks:',
        '  - type: section',
        '    title: One',
        '    blocks:',
        '      - type: text',
        '        text: inner',
        '      - type: heading',
        '        level: 2',
        '        text: Second',
        '',
      ].join('\n'),
    );
    const section = ir.nodes.find((node) => node.type === 'section');
    expect(section?.children).toHaveLength(2);
    expect(ir.nodes.find((node) => node.type === 'heading')?.depth).toBe(2);
    expect(ir.nodes.find((node) => node.type === 'text')?.path).toBe('$.blocks[0].blocks[0]');
  });

  it('rejects child blocks on a block with no children slot', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'text', text: 'hi', blocks: [{ type: 'text', text: 'y' }] }],
    });
    expect(error.path).toBe('$.blocks[0].blocks');
  });

  it('rejects an unknown block type with the type and the known list', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'carusel', items: [] }],
    });
    expect(error.code).toBe('SPEC_UNKNOWN_BLOCK');
    expect(error.path).toBe('$.blocks[0].type');
    expect(JSON.stringify(error.details?.known)).toContain('carousel');
  });

  it('rejects an unknown property instead of silently ignoring it', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'text', text: 'hi', ttext: 'typo' }],
    });
    expect(error.code).toBe('SPEC_VALIDATION_ERROR');
    expect(error.path).toBe('$.blocks[0].ttext');
    expect(error.details?.allowed).toEqual(['variant', 'text', 'id']);
  });

  it('rejects a duplicate authored node ID', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X' },
      blocks: [
        { type: 'text', id: 'same', text: 'a' },
        { type: 'text', id: 'same', text: 'b' },
      ],
    });
    expect(error.message).toContain('duplicate node id');
    expect(error.path).toBe('$.blocks[1].id');
  });

  it('rejects an invalid authored ID', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'text', id: 'Not Valid', text: 'a' }],
    });
    expect(error.path).toBe('$.blocks[0].id');
  });

  it('reports a bounded, ordered diagnostic list on the thrown error', () => {
    const error = errorFrom({
      version: 1,
      meta: {},
      blocks: [{ type: 'text' }, { type: 'nope' }],
    });
    const diagnostics = error.details?.diagnostics as { path: string }[];
    expect(diagnostics.length).toBeGreaterThan(1);
    expect(diagnostics.map((item) => item.path)).toEqual([
      '$.meta.title',
      '$.blocks[0].text',
      '$.blocks[1].type',
    ]);
  });

  it('normalizes action bindings into typed records and drops the raw map', () => {
    const ir = normalize(
      [
        'version: 1',
        'meta: {title: Actions}',
        'state: {mode: basic}',
        'blocks:',
        '  - type: button',
        '    id: go',
        '    label: Go',
        '    on:',
        '      click:',
        '        action: set-value',
        '        path: state.mode',
        '        value: advanced',
        '',
      ].join('\n'),
    );
    const button = ir.nodes.find((node) => node.type === 'button');
    expect(button?.props.on).toBeUndefined();
    expect(button?.bindings.click?.[0]).toEqual({
      action: 'set-value',
      path: 'state.mode',
      value: 'advanced',
    });
  });

  it('validates bindings nested inside prop objects', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X' },
      blocks: [
        {
          type: 'toolbar',
          items: [{ type: 'button', label: 'Bad', on: { click: { action: 'eval', code: 'x' } } }],
        },
      ],
    });
    expect(error.code).toBe('SPEC_VALIDATION_ERROR');
    expect(error.details?.allowed).toContain('copy');
  });

  it('rejects an unknown event name', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'button', label: 'B', on: { swoosh: { action: 'toggle' } } }],
    });
    expect(error.details?.allowed).toContain('click');
  });

  it('rejects a state path that is not a plain dotted key path', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X' },
      blocks: [
        {
          type: 'button',
          label: 'B',
          on: { click: { action: 'set-value', path: 'state.a;alert(1)' } },
        },
      ],
    });
    expect(error.code).toBe('POLICY_VIOLATION');
    expect(error.path).toBe('$.blocks[0].on.click.path');
  });

  it('warns when a table row width disagrees with the column count', () => {
    const result = normalizeSpec({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'table', columns: ['a', 'b'], rows: [['1', '2'], ['only-one']] }],
    });
    const warning = result.diagnostics.find((item) => item.path === '$.blocks[0].rows[1]');
    expect(warning?.severity).toBe('warning');
    expect(result.diagnostics.some((item) => item.severity === 'error')).toBe(false);
  });

  it('warns when a button has no bindings', () => {
    const result = normalizeSpec({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'button', label: 'Inert' }],
    });
    expect(result.diagnostics[0]?.severity).toBe('warning');
    expect(result.diagnostics[0]?.message).toContain('no action bindings');
  });

  it('rejects a slider whose range is empty', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'slider', label: 'S', min: 10, max: 10 }],
    });
    expect(error.path).toBe('$.blocks[0].max');
  });

  it('rejects unknown envelope fields', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X', author: 'someone' },
      blocks: [{ type: 'text', text: 'a' }],
    });
    expect(error.path).toBe('$.meta.author');
  });

  it('rejects an unknown network capability', () => {
    const error = errorFrom({
      version: 1,
      meta: { title: 'X' },
      policy: { network: { allow: ['gopher'] } },
      blocks: [{ type: 'text', text: 'a' }],
    });
    expect(error.code).toBe('POLICY_VIOLATION');
    expect(error.path).toBe('$.policy.network.allow[0]');
  });

  it('records the compiler version on the IR', () => {
    const ir = normalize(MINIMAL);
    expect(ir.compilerVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(ir.irVersion).toBe(1);
  });
});
