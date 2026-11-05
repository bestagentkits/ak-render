import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXTENT, layoutGraph } from '../../src/blocks/three/network-layout.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const read = (name: string) =>
  readFileSync(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url), 'utf8');

function graph(nodes: unknown[], edges: unknown[] = [], extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Graph' },
    blocks: [{ type: 'network-3d', id: 'g', summary: 'A graph.', nodes, edges, ...extra }],
  };
}

function errors(spec: unknown) {
  return normalizeSpec(spec)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.path}: ${d.message}`);
}

const ring = (n: number) => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, group: `g${i % 3}` })),
  edges: Array.from({ length: n }, (_, i) => ({ from: `n${i}`, to: `n${(i + 1) % n}` })),
});

function config(html: string): { position: number[]; ids: string[]; edges: number[] } {
  const match = /data-ak-3d="network"[^>]*data-ak-scene="([^"]+)"/.exec(html);
  const raw = (match?.[1] ?? '{}').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  return JSON.parse(raw);
}

describe('network-3d layout', () => {
  for (const layout of ['force', 'hierarchical', 'radial'] as const) {
    it(`${layout}: is deterministic and fits the extent`, () => {
      const { nodes, edges } = ring(40);
      const a = layoutGraph(nodes, edges, layout);
      const b = layoutGraph(nodes, edges, layout);
      expect(b).toEqual(a);
      expect(a).toHaveLength(40);
      for (const p of a) {
        for (const v of p) expect(Number.isFinite(v)).toBe(true);
        expect(Math.hypot(...p)).toBeLessThanOrEqual(EXTENT + 0.02);
      }
      // Nodes do not collapse onto one point.
      expect(new Set(a.map((p) => p.join(','))).size).toBeGreaterThan(36);
    });
  }

  it('lays out cycles, disconnected parts and a single node', () => {
    const cyclic = layoutGraph(
      [
        { id: 'a', group: '' },
        { id: 'b', group: '' },
        { id: 'c', group: '' },
        { id: 'z', group: '' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
      'hierarchical',
    );
    expect(cyclic).toHaveLength(4);
    expect(layoutGraph([{ id: 'solo', group: '' }], [], 'radial')).toEqual([[0, 0, 0]]);
  });

  it('a hierarchical layout puts each layer below its sources', () => {
    const p = layoutGraph(
      [
        { id: 'r', group: '' },
        { id: 'a', group: '' },
        { id: 'b', group: '' },
      ],
      [
        { from: 'r', to: 'a' },
        { from: 'a', to: 'b' },
      ],
      'hierarchical',
    );
    expect((p[0] as number[])[1]).toBeGreaterThan((p[1] as number[])[1] as number);
    expect((p[1] as number[])[1]).toBeGreaterThan((p[2] as number[])[1] as number);
  });

  it('radial places the root at the centre', () => {
    const { nodes, edges } = ring(12);
    const p = layoutGraph(nodes, edges, 'radial', 'n5');
    expect(Math.hypot(...(p[5] as number[]))).toBeLessThan(Math.hypot(...(p[0] as number[])));
  });
});

describe('network-3d contract', () => {
  it('compiles the fixture byte-identically and emits the network widget', () => {
    const runs = [0, 1, 2].map(() => compile(read('network-3d-basic'), { source: 'net' }).html);
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
    const html = runs[0] as string;
    expect(html).toContain('data-ak-3d="network"');
    expect(html).toContain('class="ak-3d-poster ak-net-poster"');
    expect(html).toContain('18 nodes, 29 links');
    expect(html).toContain('data-ak-3d-pick="payments"');
    expect(html).toContain('<th scope="col">Linked from</th>');
  });

  it('compiles the 1000-node stress fixture deterministically with every node placed', () => {
    const source = read('network-3d-stress');
    const first = compile(source, { source: 'stress' });
    const second = compile(source, { source: 'stress' });
    expect(second.html).toBe(first.html);
    const data = config(first.html);
    expect(data.ids).toHaveLength(1000);
    expect(data.position).toHaveLength(3000);
    expect(data.edges).toHaveLength(4000);
    expect(first.html).toContain('1000 nodes, 2000 links');
  });

  it('rejects duplicate ids and edges that name no node, allows cycles', () => {
    const n = (id: string) => ({ id });
    expect(errors(graph([n('a'), n('a')]))).toEqual([
      '$.blocks[0].nodes[1].id: node id "a" is used twice',
    ]);
    expect(errors(graph([n('a')], [{ from: 'a', to: 'ghost' }]))).toEqual([
      '$.blocks[0].edges[0].to: "ghost" is not a node id in this graph',
    ]);
    expect(errors(graph([n('a')], [{ from: 'a', to: 'a' }]))).toEqual([
      '$.blocks[0].edges[0].to: edge links "a" to itself',
    ]);
    expect(
      errors(
        graph(
          [n('a'), n('b')],
          [
            { from: 'a', to: 'b' },
            { from: 'b', to: 'a' },
          ],
        ),
      ),
    ).toEqual([]);
  });

  it('reads the compact node and link lists and reports malformed tokens', () => {
    const spec = graph([], [], {
      nodeList: 'a core Alpha node\nb core\nc',
      edgeList: 'a>b b>c\nc>a',
    });
    expect(errors(spec)).toEqual([]);
    const html = compile(spec, { source: 'compact' }).html;
    expect(html).toContain('3 nodes, 3 links');
    expect(html).toContain('Alpha node');
    expect(errors(graph([{ id: 'a' }], [], { edgeList: 'a-b' }))).toEqual([
      '$.blocks[0].edgeList: "a-b" is not a `from>to` link',
    ]);
    expect(errors(graph([], []))).toEqual([
      '$.blocks[0].nodes: a graph needs at least one node in `nodes` or `nodeList`',
    ]);
  });

  it('gives each of eight cycled groups its own tone and shade', () => {
    const html = compile(read('network-3d-stress'), { source: 'stress' }).html;
    const swatches = [
      ...html.matchAll(
        /<li><span><span class="ak-net-swatch"( data-tone="[a-z]+"(?: data-ak-net-shade="\d")?)>/g,
      ),
    ].map((m) => m[1]);
    expect(swatches).toHaveLength(8);
    expect(new Set(swatches).size).toBe(8);
    expect(swatches.join(' ')).not.toContain('warning');
  });

  it('checks groups and the root', () => {
    expect(
      errors(graph([{ id: 'a', group: 'x' }], [], { groups: [{ id: 'y' }, { id: 'y' }] })),
    ).toEqual([
      '$.blocks[0].groups[1].id: group "y" is listed twice',
      '$.blocks[0].nodes[0].group: group "x" is not listed in groups',
    ]);
    expect(errors(graph([{ id: 'a' }], [], { root: 'b', layout: 'radial' }))).toEqual([
      '$.blocks[0].root: root "b" is not a node id in this graph',
    ]);
  });
});
