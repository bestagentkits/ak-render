import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';
import { PROBE_REGISTRY } from './support/probe-block-group.js';

const REMOTE_IMAGE = 'https://images.example.com/shot.png';

function panelSpec(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    meta: { title: 'Nested slots' },
    blocks: [
      {
        type: 'probe-panel',
        aside: [{ type: 'text', text: 'Aside note.' }],
        items: [
          { title: 'First', blocks: [{ type: 'text', text: 'One.' }] },
          {
            title: 'Second',
            blocks: [
              { type: 'text', text: 'Two.' },
              {
                type: 'tabs',
                items: [
                  { title: 'A', text: 'Alpha.' },
                  { title: 'B', text: 'Beta.' },
                ],
              },
            ],
          },
        ],
        ...extra,
      },
    ],
  };
}

function errors(spec: unknown) {
  return normalizeSpec(spec, { registry: PROBE_REGISTRY }).diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  );
}

describe('nested slots', () => {
  it('builds slot lists into IrNode.slots, keeping blocks out of props', () => {
    const { ir, diagnostics } = normalizeSpec(panelSpec(), { registry: PROBE_REGISTRY });
    expect(diagnostics).toEqual([]);
    const panel = ir.nodes.find((node) => node.type === 'probe-panel');
    expect(panel?.children).toEqual([]);
    expect(Object.keys(panel?.slots ?? {})).toEqual([
      'aside',
      'items[0].blocks',
      'items[1].blocks',
    ]);
    expect(panel?.props.items).toEqual([{ title: 'First' }, { title: 'Second' }]);
    expect(panel?.props.aside).toBeUndefined();

    const nested = (panel?.slots?.['items[1].blocks'] ?? []).map((id) =>
      ir.nodes.find((node) => node.id === id),
    );
    expect(nested.map((node) => node?.type)).toEqual(['text', 'tabs']);
    expect(nested[1]?.path).toBe('$.blocks[0].items[1].blocks[1]');
    expect(nested[1]?.parentId).toBe(panel?.id);
    expect(nested[1]?.depth).toBe(2);
  });

  it('leaves a node without nested blocks without a slots key', () => {
    const { ir } = normalizeSpec(
      { version: 1, meta: { title: 'Plain' }, blocks: [{ type: 'text', text: 'Hi.' }] },
      { registry: PROBE_REGISTRY },
    );
    expect(ir.nodes.every((node) => !('slots' in node))).toBe(true);
  });

  it('keeps IR order depth-first and node ids stable across runs', () => {
    const runs = [1, 2, 3].map(
      () => normalizeSpec(panelSpec(), { registry: PROBE_REGISTRY }).ir.nodes,
    );
    const ids = runs.map((nodes) => nodes.map((node) => node.id));
    expect(ids[1]).toEqual(ids[0]);
    expect(ids[2]).toEqual(ids[0]);
    expect(runs[0]?.map((node) => node.path)).toEqual([
      '$',
      '$.blocks[0]',
      '$.blocks[0].aside[0]',
      '$.blocks[0].items[0].blocks[0]',
      '$.blocks[0].items[1].blocks[0]',
      '$.blocks[0].items[1].blocks[1]',
    ]);
  });

  it('reports an error in a nested prop at its full path', () => {
    const spec = panelSpec();
    const panel = (spec.blocks as Record<string, unknown>[])[0] as Record<string, unknown>;
    panel.items = [
      { title: 'First', blocks: [{ type: 'text', text: 'One.' }] },
      { title: 'Second', blocks: [{ type: 'image', src: 'a.png', alt: 7 }] },
    ];
    expect(errors(spec).map((diagnostic) => diagnostic.path)).toEqual([
      '$.blocks[0].items[1].blocks[0].alt',
    ]);
  });

  it('enforces a slot accepts list at the child type path', () => {
    const spec = panelSpec();
    const panel = (spec.blocks as Record<string, unknown>[])[0] as Record<string, unknown>;
    panel.items = [{ title: 'Only', blocks: [{ type: 'quote', text: 'No.' }] }];
    expect(errors(spec)).toEqual([
      expect.objectContaining({
        code: 'SPEC_VALIDATION_ERROR',
        path: '$.blocks[0].items[0].blocks[0].type',
        details: { type: 'quote', allowed: ['text', 'image', 'tabs'] },
      }),
    ]);
  });

  it('enforces a child parents list, including at the top level', () => {
    const top = {
      version: 1,
      meta: { title: 'Parents' },
      blocks: [{ type: 'probe-cell', title: 'Loose' }],
    };
    expect(errors(top)).toEqual([
      expect.objectContaining({
        path: '$.blocks[0].type',
        details: { type: 'probe-cell', allowed: ['probe-grid'] },
      }),
    ]);
    const inside = {
      version: 1,
      meta: { title: 'Parents' },
      blocks: [{ type: 'probe-grid', cells: [{ type: 'probe-cell', title: 'Placed' }] }],
    };
    expect(errors(inside)).toEqual([]);
  });

  it('bounds a slot list by its own min and max', () => {
    expect(
      errors(panelSpec({ aside: [1, 2, 3, 4].map(() => ({ type: 'text', text: 'x' })) })),
    ).toEqual([expect.objectContaining({ code: 'SPEC_BOUNDS_ERROR', path: '$.blocks[0].aside' })]);
  });

  it('counts nested blocks toward the document block limit', () => {
    const items = Array.from({ length: 101 }, (_, index) => ({
      title: `Item ${index}`,
      blocks: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    }));
    const spec = { version: 1, meta: { title: 'Big' }, blocks: [{ type: 'probe-panel', items }] };
    expect(errors(spec).some((diagnostic) => diagnostic.code === 'SPEC_BOUNDS_ERROR')).toBe(true);
  });

  it('counts a slot prop with another name toward the block limit too', () => {
    const cells = Array.from({ length: 40 }, () => ({ type: 'probe-cell', title: 'c' }));
    const blocks = Array.from({ length: 6 }, () => ({ type: 'probe-grid', cells }));
    const spec = { version: 1, meta: { title: 'Big' }, blocks };
    expect(errors(spec)).toEqual([
      expect.objectContaining({ code: 'SPEC_BOUNDS_ERROR', path: '$.blocks' }),
    ]);
  });
});

describe('nested slot rendering', () => {
  it('renders every slot child exactly once and collects nested features', () => {
    const result = compile(panelSpec(), { registry: PROBE_REGISTRY });
    for (const node of result.ir.nodes.filter((candidate) => candidate.id !== 'page')) {
      expect(result.html.split(`data-ak-id="${node.id}"`).length - 1, node.type).toBe(1);
    }
    expect(result.features).toContain('tabs');
    expect(result.html).toContain('<aside><!-- ak:');
  });

  it('gates a nested remote image by policy and admits its origin to the CSP', () => {
    const withImage = (policy?: unknown) => ({
      ...panelSpec(),
      ...(policy === undefined ? {} : { policy }),
      blocks: [
        {
          type: 'probe-panel',
          items: [{ title: 'Shot', blocks: [{ type: 'image', src: REMOTE_IMAGE, alt: 'Shot' }] }],
        },
      ],
    });
    const denied = compile(withImage(), { registry: PROBE_REGISTRY });
    expect(denied.html).not.toContain(`src="${REMOTE_IMAGE}"`);
    expect(denied.html).toContain('Remote image not loaded');

    const allowed = compile(withImage({ network: { allow: ['images'] } }), {
      registry: PROBE_REGISTRY,
    });
    expect(allowed.html).toContain(`src="${REMOTE_IMAGE}"`);
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/u.exec(allowed.html)?.[1];
    expect(csp).toContain('https://images.example.com');
  });
});
