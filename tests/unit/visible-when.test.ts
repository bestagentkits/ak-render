import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { evaluateCondition } from '../../src/spec/conditions.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

function spec(visibleWhen: unknown, state: Record<string, unknown> = { view: 'table' }) {
  return {
    version: 1,
    meta: { title: 'Conditions' },
    state,
    blocks: [
      { type: 'text', id: 'always', text: 'Always shown.' },
      { type: 'text', id: 'gated', text: 'Shown for one view.', visibleWhen },
    ],
  };
}

function errors(input: unknown) {
  return normalizeSpec(input).diagnostics.filter((d) => d.severity === 'error');
}

describe('visibleWhen', () => {
  it('records the condition and the state feature on the node', () => {
    const { ir, diagnostics } = normalizeSpec(spec({ path: 'state.view', equals: 'table' }));
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const gated = ir.nodes.find((node) => node.props.id === 'gated');
    expect(gated?.when).toEqual({ path: 'state.view', op: 'equals', value: 'table' });
    expect(gated?.runtimeFeatures).toContain('state');
    expect(ir.nodes.find((node) => node.props.id === 'always')?.when).toBeUndefined();
  });

  it('emits the initial view: a false condition starts hidden', () => {
    const shown = compile(spec({ path: 'state.view', equals: 'table' })).html;
    expect(shown).toMatch(/<div class="ak-when" data-ak-when="[^"]+"><p/u);
    const hidden = compile(spec({ path: 'state.view', equals: 'chart' })).html;
    expect(hidden).toMatch(/<div class="ak-when" data-ak-when="[^"]+" hidden><p/u);
    expect(hidden).toContain('.ak-when[hidden]{display:none!important}');
    expect(hidden).toContain('function syncConditions()');
  });

  it('ships no state CSS or runtime part without a condition', () => {
    const result = compile({
      version: 1,
      meta: { title: 'Plain' },
      blocks: [{ type: 'text', text: 'Plain.' }],
    });
    expect(result.html).not.toContain('ak-when');
    expect(result.html).not.toContain('syncConditions');
    expect(result.features).not.toContain('state');
  });

  it('reports invalid conditions at their JSON path', () => {
    const at = (value: unknown) => errors(spec(value)).map((d) => d.path);
    expect(at('state.view')).toEqual(['$.blocks[1].visibleWhen']);
    expect(at({ path: 'state.view' })).toEqual(['$.blocks[1].visibleWhen']);
    expect(at({ path: 'state.view', equals: 'a', truthy: true })).toEqual([
      '$.blocks[1].visibleWhen',
    ]);
    expect(at({ path: 'view', equals: 'a' })).toEqual(['$.blocks[1].visibleWhen.path']);
    expect(at({ path: 'state.view', in: [] })).toEqual(['$.blocks[1].visibleWhen.in']);
    expect(at({ path: 'state.view', in: ['a', { x: 1 }] })).toEqual([
      '$.blocks[1].visibleWhen.in[1]',
    ]);
    expect(at({ path: 'state.view', truthy: false })).toEqual(['$.blocks[1].visibleWhen.truthy']);
    expect(at({ path: 'state.view', equals: 'a', op: 'x' })).toEqual([
      '$.blocks[1].visibleWhen.op',
    ]);
  });

  it('warns when the state key is not declared', () => {
    const { diagnostics } = normalizeSpec(spec({ path: 'state.mode', truthy: true }));
    const warning = diagnostics.find((d) => d.severity === 'warning');
    expect(warning?.path).toBe('$.blocks[1].visibleWhen.path');
    expect(warning?.details).toEqual({ known: ['view'] });
  });

  it('evaluates every operator with strict, own-key semantics', () => {
    const state = { view: 'table', count: 0, nested: { on: true } };
    expect(evaluateCondition({ path: 'state.view', op: 'equals', value: 'table' }, state)).toBe(
      true,
    );
    expect(evaluateCondition({ path: 'state.count', op: 'equals', value: '0' }, state)).toBe(false);
    expect(evaluateCondition({ path: 'state.view', op: 'notEquals', value: 'x' }, state)).toBe(
      true,
    );
    expect(evaluateCondition({ path: 'state.view', op: 'in', value: ['a', 'table'] }, state)).toBe(
      true,
    );
    expect(evaluateCondition({ path: 'state.view', op: 'notIn', value: ['table'] }, state)).toBe(
      false,
    );
    expect(evaluateCondition({ path: 'state.count', op: 'falsy' }, state)).toBe(true);
    expect(evaluateCondition({ path: 'state.nested.on', op: 'truthy' }, state)).toBe(true);
    expect(evaluateCondition({ path: 'state.constructor', op: 'truthy' }, state)).toBe(false);
    expect(evaluateCondition({ path: 'state.missing.deep', op: 'falsy' }, state)).toBe(true);
  });
});
