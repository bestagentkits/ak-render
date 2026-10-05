import { describe, expect, it } from 'vitest';
import { chainOrder, renderDiagramFallback } from '../../src/render/diagram-fallback.js';

const nodes = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

describe('diagram fallback', () => {
  it('orders a simple chain by its edges, not by declaration order', () => {
    const ordered = chainOrder(nodes, [
      { from: 'b', to: 'c', label: '' },
      { from: 'a', to: 'b', label: '' },
    ]);
    expect(ordered?.map((node) => node.id)).toEqual(['a', 'b', 'c']);
  });

  it('refuses branches, cycles and dangling edges', () => {
    expect(
      chainOrder(nodes, [
        { from: 'a', to: 'b', label: '' },
        { from: 'a', to: 'c', label: '' },
      ]),
    ).toBeUndefined();
    expect(chainOrder(nodes.slice(0, 2), [{ from: 'a', to: 'z', label: '' }])).toBeUndefined();
    expect(chainOrder(nodes, [])).toBeUndefined();
  });

  it('draws a chain as a flow with labelled connectors', () => {
    const html = renderDiagramFallback(
      nodes.map((node) => ({ ...node })),
      [
        { from: 'a', to: 'b', label: 'parsed' },
        { from: 'b', to: 'c', label: '<escaped>' },
      ],
    );
    expect(html.startsWith('<ol class="ak-flow">')).toBe(true);
    expect(html.match(/class="ak-flow-edge"/gu)).toHaveLength(2);
    expect(html).toContain('&lt;escaped&gt;');
  });

  it('falls back to nodes plus an explicit connection list for any other graph', () => {
    const html = renderDiagramFallback(
      nodes.map((node) => ({ ...node })),
      [{ from: 'a', to: 'c', label: 'skip' }],
    );
    expect(html).toContain('<ul class="ak-flow-nodes">');
    expect(html).toContain('<ul class="ak-flow-links">');
    expect(html).not.toContain('ak-flow-edge');
  });
});
