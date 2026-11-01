import { describe, expect, it } from 'vitest';
import { checkDiagramGraph, readDiagramGraph } from '../../src/diagram/semantic-graph.js';
import { compile, validate } from '../../src/index.js';
import { renderDiagramFallback } from '../../src/render/diagram-fallback.js';

const meta = { title: 'T' };

const specs = {
  architecture: {
    schema_version: 1,
    diagram_type: 'architecture',
    meta,
    boundaries: [{ id: 'vpc', label: 'Private VPC', components: ['api', 'db'] }],
    components: [
      { id: 'web', label: 'Web' },
      { id: 'api', label: 'API' },
      { id: 'db', label: 'Database' },
    ],
    connections: [
      { from: 'web', to: 'api', protocol: 'HTTPS' },
      { from: 'api', to: 'db', label: 'SQL' },
    ],
  },
  workflow: {
    schema_version: 1,
    diagram_type: 'workflow',
    meta,
    lanes: [
      { id: 'ci', label: 'CI' },
      { id: 'ops', label: 'Ops' },
    ],
    steps: [
      { id: 'build', label: 'Build', lane: 'ci' },
      { id: 'test', label: 'Test', lane: 'ci' },
      { id: 'ship', label: 'Ship', lane: 'ops' },
    ],
    transitions: [
      { from: 'build', to: 'test' },
      { from: 'test', to: 'ship', condition: 'green' },
      { from: 'test', to: 'build', kind: 'retry', label: 'fix' },
    ],
  },
  sequence: {
    schema_version: 1,
    diagram_type: 'sequence',
    meta,
    participants: [
      { id: 'client', label: 'Client' },
      { id: 'api', label: 'API' },
    ],
    messages: [
      { from: 'client', to: 'api', label: 'POST /orders' },
      { from: 'api', to: 'client', label: '201 Created', kind: 'return' },
    ],
  },
  dataflow: {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta,
    stages: [
      { id: 'load', label: 'Load', order: 2 },
      { id: 'ingest', label: 'Ingest', order: 1 },
    ],
    nodes: [
      { id: 'warehouse', label: 'Warehouse', stage: 'load' },
      { id: 'events', label: 'Events', stage: 'ingest' },
    ],
    flows: [{ from: 'events', to: 'warehouse', schema_type: 'Avro' }],
  },
  lifecycle: {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta,
    states: [
      { id: 'draft', label: 'Draft', kind: 'initial' },
      { id: 'live', label: 'Live' },
    ],
    transitions: [{ from: 'draft', to: 'live', event: 'publish' }],
  },
} as const;

describe('diagram semantic graph', () => {
  it('reads every typed archetype without inventing relationships', () => {
    for (const [type, spec] of Object.entries(specs)) {
      const graph = readDiagramGraph(spec as never);
      expect(graph.type).toBe(type);
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
      expect(checkDiagramGraph(spec as never)).toEqual([]);
    }
    expect(readDiagramGraph(specs.workflow as never).edges).toEqual([
      { from: 'build', to: 'test', label: '' },
      { from: 'test', to: 'ship', label: 'green' },
      { from: 'test', to: 'build', label: 'fix' },
    ]);
    expect(readDiagramGraph(specs.lifecycle as never).edges[0]?.label).toBe('publish');
    expect(readDiagramGraph(specs.architecture as never).edges[0]?.label).toBe('HTTPS');
  });

  it('keeps groups, their members and the dataflow stage order', () => {
    expect(readDiagramGraph(specs.architecture as never).groups).toEqual([
      { id: 'vpc', label: 'Private VPC', members: ['api', 'db'] },
    ]);
    expect(readDiagramGraph(specs.workflow as never).groups.map((g) => g.members)).toEqual([
      ['build', 'test'],
      ['ship'],
    ]);
    expect(readDiagramGraph(specs.dataflow as never).groups.map((g) => g.id)).toEqual([
      'ingest',
      'load',
    ]);
    expect(readDiagramGraph(specs.sequence as never).ordered).toBe(true);
  });

  it('keeps the untyped reading and also accepts edges', () => {
    const graph = readDiagramGraph({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ from: 'a', to: 'b' }],
    } as never);
    expect(graph.type).toBeUndefined();
    expect(graph.edges).toEqual([{ from: 'a', to: 'b', label: '' }]);
  });

  it('renders each archetype in the fallback, with sequence order and group labels', () => {
    const sequence = renderDiagramFallback(readDiagramGraph(specs.sequence as never));
    expect(sequence).toContain('<ol class="ak-flow-links ak-flow-steps">');
    expect(sequence.indexOf('POST /orders')).toBeLessThan(sequence.indexOf('201 Created'));
    const workflow = renderDiagramFallback(readDiagramGraph(specs.workflow as never));
    expect(workflow).toContain('aria-label="CI"');
    expect(workflow).toContain('aria-label="Ops"');
    expect(workflow.match(/<li><code>/gu)).toHaveLength(3);
    const architecture = renderDiagramFallback(readDiagramGraph(specs.architecture as never));
    expect(architecture).toContain('Private VPC');
    // `web` is outside every boundary and still shown.
    expect(architecture).toContain('<code>web</code>');
  });

  it('reports dangling references, duplicates, an empty graph and an unknown archetype', () => {
    const issues = checkDiagramGraph({
      diagram_type: 'workflow',
      steps: [{ id: 'a' }, { id: 'a' }],
      transitions: [{ from: 'a', to: 'ghost' }],
    } as never);
    expect(issues.map((issue) => issue.path)).toEqual(['steps[1].id', 'transitions[0].to']);
    expect(checkDiagramGraph({ diagram_type: 'workflow' } as never)[0]?.path).toBe('steps');
    expect(checkDiagramGraph({ diagram_type: 'erd', nodes: [{ id: 'x' }] } as never)).toHaveLength(
      1,
    );
  });
});

describe('diagram-panel without an adapter', () => {
  const page = (spec: object) => ({
    version: 1,
    meta: { title: 'Diagram' },
    blocks: [{ type: 'diagram-panel', id: 'd', spec }],
  });

  it('shows every workflow step and transition instead of only the title', () => {
    const { html } = compile(page(specs.workflow));
    for (const label of ['Build', 'Test', 'Ship', 'green', 'fix']) expect(html).toContain(label);
  });

  it('is deterministic for the same spec', () => {
    expect(compile(page(specs.lifecycle)).html).toBe(compile(page(specs.lifecycle)).html);
  });

  it('warns at the exact path of a broken reference', () => {
    const result = validate(
      page({ ...specs.lifecycle, transitions: [{ from: 'draft', to: 'gone' }] }),
    );
    const warning = result.diagnostics.find((d) => d.path?.endsWith('transitions[0].to'));
    expect(warning?.severity).toBe('warning');
    expect(warning?.path).toBe('$.blocks[0].spec.transitions[0].to');
  });
});
