import { describe, expect, it } from 'vitest';
import {
  compile,
  type DiagramAdapter,
  type DiagramRenderRequest,
  runDiagramAdapter,
} from '../../src/index.js';
import { gridDiagramAdapter } from './support/grid-diagram-adapter.js';

const SPEC = `version: 1
meta: { title: Request flow }
blocks:
  - type: diagram-panel
    id: flow
    title: Request flow
    spec:
      diagram_type: architecture
      components:
        - { id: client, label: Client }
        - { id: api, label: API }
        - { id: db, label: "Cơ sở dữ liệu" }
      connections:
        - { from: client, to: api, label: HTTPS }
        - { from: api, to: db, protocol: SQL }
      boundaries:
        - { id: backend, label: Backend, components: [api, db] }
`;

const SPEC_OBJECT = {
  diagram_type: 'architecture',
  components: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  connections: [{ from: 'a', to: 'b' }],
};

const SVG =
  '<svg viewBox="0 0 10 10"><defs><marker id="m"><path d="M0 0"/></marker></defs><g id="na"><rect width="1" height="1"/></g><g data-node-id="b"><rect width="1" height="1" fill="url(#m)"/></g><path id="e1" marker-end="url(#m)" d="M0 0"/><use href="#m"/></svg>';

function v2(
  render: (request: DiagramRenderRequest) => ReturnType<DiagramAdapter['render']>,
): DiagramAdapter {
  return { name: 'v2', version: '1.0.0', contract: 2, render };
}

function run(adapter: DiagramAdapter, spec: unknown = SPEC_OBJECT) {
  return runDiagramAdapter(adapter, {
    spec: spec as never,
    title: 'T',
    nodeId: 'panel',
  });
}

const MANIFEST = {
  version: 2 as const,
  nodes: [{ id: 'a', element: 'na' }, { id: 'b' }],
  edges: [{ from: 'a', to: 'b', element: 'e1' }],
};

describe('diagram adapter v2: manifest', () => {
  it('binds nodes and relationships, writes compiler hooks and scopes ids', () => {
    const result = run(
      v2(() => ({
        svg: SVG,
        manifest: MANIFEST,
        capabilities: { focus: true, zoom: true, bogus: true } as never,
      })),
    );
    expect(result?.rejected).toBeUndefined();
    expect(result?.contract).toBe(2);
    expect(result?.capabilities).toEqual(['focus', 'zoom']);
    expect(result?.manifest).toEqual({ nodes: 2, edges: 1, groups: 0 });
    const markup = result?.markup ?? '';
    expect(markup).toContain('id="panel-na" data-ak-node="a" data-ak-label="A"');
    expect(markup).toContain('data-node-id="b" data-ak-node="b"');
    expect(markup).toContain('data-ak-edge="0" data-ak-from="a" data-ak-to="b"');
    expect(markup).toContain('id="panel-m"');
    expect(markup).toContain('fill="url(#panel-m)"');
    expect(markup).toContain('href="#panel-m"');
    expect(markup).not.toMatch(/id="m"/u);
  });

  it('asks the adapter for contract 2 and keeps v1 adapters on contract 1', () => {
    const seen: number[] = [];
    run(
      v2((request) => {
        seen.push(request.contractVersion);
        return undefined;
      }),
    );
    run({
      name: 'v1',
      version: '1',
      render: (request) => {
        seen.push(request.contractVersion);
        return undefined;
      },
    });
    expect(seen).toEqual([2, 1]);
  });

  it('keeps v1 output byte-for-byte: no hooks, no id rewriting', () => {
    const result = run({ name: 'v1', version: '1', render: () => SVG });
    expect(result?.contract).toBe(1);
    expect(result?.markup).toContain('<marker id="m">');
    expect(result?.markup).not.toContain('data-ak-');
  });

  it('refuses a v2 result from an adapter that declares contract 1', () => {
    const result = run({
      name: 'v1',
      version: '1',
      render: () => ({ svg: SVG, manifest: MANIFEST }) as never,
    });
    expect(result?.rejected).toBe('a v1 adapter returned a v2 result');
  });

  it.each([
    [
      'an undeclared node',
      { version: 2, nodes: [{ id: 'ghost', element: 'na' }] },
      'is not declared',
    ],
    [
      'a fabricated relationship',
      { version: 2, nodes: [], edges: [{ from: 'b', to: 'a', element: 'e1' }] },
      'relationship "b" -> "a" is not declared',
    ],
    [
      'a relationship drawn twice',
      {
        version: 2,
        nodes: [],
        edges: [
          { from: 'a', to: 'b', element: 'e1' },
          { from: 'a', to: 'b', element: 'na' },
        ],
      },
      'is not declared',
    ],
    [
      'a duplicate node',
      { version: 2, nodes: [{ id: 'a', element: 'na' }, { id: 'a' }] },
      'listed twice',
    ],
    [
      'an unknown group',
      { version: 2, nodes: [], groups: [{ id: 'zone' }] },
      'group "zone" is not declared',
    ],
    [
      'an element that is not drawn',
      { version: 2, nodes: [{ id: 'a', element: 'missing' }] },
      'matches no element',
    ],
    [
      'a non-token element',
      { version: 2, nodes: [{ id: 'a', element: 'x" onclick="' }] },
      'element token',
    ],
    ['a wrong version', { version: 1, nodes: [] }, 'not version 2'],
    [
      'too many nodes',
      { version: 2, nodes: Array.from({ length: 401 }, (_, i) => ({ id: `n${i}` })) },
      'size bounds',
    ],
  ])('rejects %s and falls back', (_name, manifest, reason) => {
    const result = run(v2(() => ({ svg: SVG, manifest }) as never));
    expect(result?.markup).toBe('');
    expect(result?.rejected).toContain(reason);
  });

  it('still applies the v1 trust boundary to v2 svg', () => {
    const result = run(
      v2(() => ({ svg: '<svg><script>x</script></svg>', manifest: { version: 2, nodes: [] } })),
    );
    expect(result?.rejected).toBe('script element');
  });

  it('compiles a page whose canvas carries the contract and capabilities', () => {
    const result = compile(SPEC, { diagramAdapter: gridDiagramAdapter() });
    expect(result.warnings).toEqual([]);
    expect(result.html).toContain(
      'data-ak-diagram-contract="2" data-ak-diagram-capabilities="focus trace zoom search"',
    );
    expect(result.html).toContain('data-ak-node="db" data-ak-label="Cơ sở dữ liệu"');
    expect(result.html).toContain('data-ak-label="SQL"');
    expect(result.html).toContain(
      'data-ak-group="backend" data-ak-label="Backend" data-ak-members="api db"',
    );
    // The text description stays, and the compile is deterministic.
    expect(result.html).toContain('data-ak-diagram-fallback');
    expect(compile(SPEC, { diagramAdapter: gridDiagramAdapter() }).html).toBe(result.html);
  });

  it('warns and falls back when the manifest fabricates a relationship', () => {
    const result = compile(SPEC, { diagramAdapter: gridDiagramAdapter({ fabricate: true }) });
    expect(result.html).not.toContain('data-ak-diagram-contract');
    expect(result.warnings.map((warning) => warning.message).join('\n')).toContain(
      'relationship "db" -> "client" is not declared by the spec',
    );
  });
});
