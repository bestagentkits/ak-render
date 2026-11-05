/**
 * Golden diagram cases: the shapes a diagram-panel must survive.
 *
 * Each case is a typed diagram spec plus the relationships it declares, so a
 * check can prove the drawing shows exactly those relationships and no more.
 * The cases are compiled with the reference grid adapter, which has
 * deterministic geometry; they cover topology (branches, cycles, fan-out and
 * fan-in, dense and parallel edges, disconnected parts), text (long
 * Vietnamese labels, markup-like labels, empty labels), grouping (lanes,
 * stages, nested boundaries) and size (one node up to a large drawing).
 */

export interface GoldenCase {
  readonly name: string;
  readonly spec: Record<string, unknown>;
  /** The relationships the spec declares, in spec order. */
  readonly edges: readonly (readonly [string, string])[];
  readonly nodes: readonly string[];
}

type Edge = readonly [string, string, string?];

function architecture(
  name: string,
  nodes: readonly (string | readonly [string, string])[],
  edges: readonly Edge[],
  boundaries: readonly { id: string; label: string; components: string[] }[] = [],
): GoldenCase {
  const components = nodes.map((node) =>
    typeof node === 'string'
      ? { id: node, label: node.toUpperCase() }
      : { id: node[0], label: node[1] },
  );
  return {
    name,
    spec: {
      diagram_type: 'architecture',
      components,
      connections: edges.map(([from, to, label]) => (label ? { from, to, label } : { from, to })),
      ...(boundaries.length ? { boundaries } : {}),
    },
    nodes: components.map((component) => component.id),
    edges: edges.map(([from, to]) => [from, to] as const),
  };
}

const range = (count: number, prefix = 'n') =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);

const chain = (ids: readonly string[]): Edge[] =>
  ids.slice(1).map((id, index) => [ids[index] as string, id] as const);

const LARGE = range(60);
const largeEdges: Edge[] = [
  ...chain(LARGE.slice(0, 12)),
  ...LARGE.slice(12).map((id, index) => [LARGE[index % 12] as string, id] as const),
];

const DENSE = range(8);
const denseEdges: Edge[] = DENSE.flatMap((from, i) =>
  DENSE.slice(i + 1, i + 4).map((to) => [from, to] as const),
);

export const GOLDEN_CASES: readonly GoldenCase[] = [
  architecture('single-node', ['solo'], []),
  architecture(
    'chain',
    ['a', 'b', 'c'],
    [
      ['a', 'b', 'calls'],
      ['b', 'c', 'writes'],
    ],
  ),
  architecture('deep-chain', range(12), chain(range(12))),
  architecture(
    'branch',
    ['root', 'l', 'r', 'll', 'lr'],
    [
      ['root', 'l'],
      ['root', 'r'],
      ['l', 'll'],
      ['l', 'lr'],
    ],
  ),
  architecture(
    'fan-out',
    ['hub', ...range(15, 'leaf')],
    range(15, 'leaf').map((id) => ['hub', id] as const),
  ),
  architecture(
    'fan-in',
    [...range(6, 'src'), 'sink'],
    range(6, 'src').map((id) => [id, 'sink'] as const),
  ),
  architecture(
    'diamond',
    ['top', 'left', 'right', 'bottom'],
    [
      ['top', 'left'],
      ['top', 'right'],
      ['left', 'bottom'],
      ['right', 'bottom'],
    ],
  ),
  architecture(
    'cycle',
    ['a', 'b', 'c'],
    [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a', 'retry'],
    ],
  ),
  architecture(
    'bidirectional',
    ['client', 'server'],
    [
      ['client', 'server', 'request'],
      ['server', 'client', 'response'],
    ],
  ),
  architecture(
    'parallel-edges',
    ['api', 'db'],
    [
      ['api', 'db', 'read'],
      ['api', 'db', 'write'],
      ['api', 'db', 'migrate'],
    ],
  ),
  architecture('dense', DENSE, denseEdges),
  architecture(
    'disconnected',
    ['a', 'b', 'c', 'd', 'lonely'],
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
  ),
  architecture(
    'long-vietnamese-labels',
    [
      ['gw', 'Cổng thanh toán quốc tế dành cho khách hàng doanh nghiệp'],
      ['svc', 'Dịch vụ đối soát giao dịch và hoàn tiền tự động'],
      ['db', 'Cơ sở dữ liệu lưu trữ lịch sử giao dịch nhiều năm'],
    ],
    [
      ['gw', 'svc', 'Gửi yêu cầu đối soát kèm chữ ký điện tử'],
      ['svc', 'db', 'Ghi nhận kết quả'],
    ],
  ),
  architecture(
    'markup-like-labels',
    [
      ['a', '<script>alert(1)</script>'],
      ['b', 'Tom & "Jerry"'],
    ],
    [['a', 'b', '</svg><img src=x>']],
  ),
  architecture(
    'empty-labels',
    [
      ['x', ''],
      ['y', ''],
    ],
    [['x', 'y']],
  ),
  architecture(
    'nested-boundaries',
    ['edge', 'api', 'worker', 'db', 'cache'],
    [
      ['edge', 'api'],
      ['api', 'worker'],
      ['worker', 'db'],
      ['api', 'cache'],
    ],
    [
      { id: 'cloud', label: 'Cloud', components: ['api', 'worker', 'db', 'cache'] },
      { id: 'data', label: 'Data tier', components: ['db', 'cache'] },
    ],
  ),
  architecture('large', LARGE, largeEdges),
  {
    name: 'workflow-lanes',
    spec: {
      diagram_type: 'workflow',
      lanes: [
        { id: 'customer', label: 'Customer' },
        { id: 'ops', label: 'Operations' },
      ],
      steps: [
        { id: 'order', label: 'Place order', lane: 'customer' },
        { id: 'check', label: 'Check stock', lane: 'ops' },
        { id: 'ship', label: 'Ship', lane: 'ops' },
        { id: 'receive', label: 'Receive', lane: 'customer' },
      ],
      transitions: [
        { from: 'order', to: 'check' },
        { from: 'check', to: 'ship', condition: 'in stock' },
        { from: 'ship', to: 'receive' },
      ],
    },
    nodes: ['order', 'check', 'ship', 'receive'],
    edges: [
      ['order', 'check'],
      ['check', 'ship'],
      ['ship', 'receive'],
    ],
  },
  {
    name: 'sequence-messages',
    spec: {
      diagram_type: 'sequence',
      participants: [
        { id: 'user', label: 'User' },
        { id: 'app', label: 'App' },
        { id: 'auth', label: 'Auth' },
      ],
      messages: [
        { from: 'user', to: 'app', label: 'sign in' },
        { from: 'app', to: 'auth', label: 'verify' },
        { from: 'auth', to: 'app', label: 'token' },
        { from: 'app', to: 'user', label: 'welcome' },
      ],
    },
    nodes: ['user', 'app', 'auth'],
    edges: [
      ['user', 'app'],
      ['app', 'auth'],
      ['auth', 'app'],
      ['app', 'user'],
    ],
  },
  {
    name: 'dataflow-stages',
    spec: {
      diagram_type: 'dataflow',
      stages: [
        { id: 'ingest', label: 'Ingest' },
        { id: 'serve', label: 'Serve' },
      ],
      nodes: [
        { id: 'events', label: 'Events', stage: 'ingest' },
        { id: 'lake', label: 'Lake', stage: 'ingest' },
        { id: 'mart', label: 'Mart', stage: 'serve' },
      ],
      flows: [
        { from: 'events', to: 'lake', schema_type: 'json' },
        { from: 'lake', to: 'mart', label: 'nightly' },
      ],
    },
    nodes: ['events', 'lake', 'mart'],
    edges: [
      ['events', 'lake'],
      ['lake', 'mart'],
    ],
  },
  {
    name: 'lifecycle-states',
    spec: {
      diagram_type: 'lifecycle',
      states: [
        { id: 'draft', label: 'Draft' },
        { id: 'review', label: 'In review' },
        { id: 'live', label: 'Live' },
      ],
      transitions: [
        { from: 'draft', to: 'review', event: 'submit' },
        { from: 'review', to: 'draft', event: 'reject' },
        { from: 'review', to: 'live', event: 'approve', action: 'publish' },
      ],
    },
    nodes: ['draft', 'review', 'live'],
    edges: [
      ['draft', 'review'],
      ['review', 'draft'],
      ['review', 'live'],
    ],
  },
  architecture(
    'two-level-tree',
    ['root', ...range(4, 'mid'), ...range(8, 'leaf')],
    [
      ...range(4, 'mid').map((id) => ['root', id] as const),
      ...range(8, 'leaf').map((id, index) => [`mid${Math.floor(index / 2) + 1}`, id] as const),
    ],
  ),
];

/** A page holding one case as a diagram-panel, with optional theme and motion. */
export function goldenPage(
  golden: GoldenCase,
  options: { preset?: string; motion?: string; policy?: string } = {},
): Record<string, unknown> {
  return {
    version: 1,
    meta: { title: `Golden: ${golden.name}` },
    ...(options.preset || options.policy
      ? {
          theme: {
            ...(options.preset ? { preset: options.preset } : {}),
            ...(options.policy ? { tokens: { 'motion-policy': options.policy } } : {}),
          },
        }
      : {}),
    blocks: [
      {
        type: 'diagram-panel',
        id: 'golden',
        title: golden.name,
        spec: golden.spec,
        ...(options.motion ? { motion: options.motion } : {}),
      },
    ],
  };
}
