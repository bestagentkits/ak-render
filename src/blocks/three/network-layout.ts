/**
 * Compile-time graph layout for `network-3d`.
 *
 * Every layout is plain arithmetic over the spec, seeded from the node ids, and
 * rounded to two decimals, so the same spec always gives the same coordinates
 * and the emitted page is byte-identical. The runtime never lays out: it draws
 * the positions the compiler wrote, which is also what the static plan shows.
 */

import type { Vec3 } from './scene-fallback.js';

export const LAYOUTS = ['force', 'hierarchical', 'radial'] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface GraphNode {
  id: string;
  group: string;
}
export interface GraphEdge {
  from: string;
  to: string;
}

/** Half the extent the laid-out graph is scaled to, in scene units. */
export const EXTENT = 6;

const round2 = (n: number) => Math.round(n * 100) / 100 || 0;

/** FNV-1a over the ids: the seed changes only when the graph does. */
function seedOf(nodes: readonly GraphNode[]): number {
  let hash = 0x811c9dc5;
  for (const node of nodes) {
    for (let i = 0; i < node.id.length; i += 1) {
      hash ^= node.id.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x2c;
  }
  return hash >>> 0;
}

/** Mulberry32: a small seeded generator, so jitter is reproducible. */
function random(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Evenly spread directions on a sphere (golden-angle spiral). */
function spherePoint(i: number, count: number): Vec3 {
  if (count <= 1) return [0, 0, 0];
  const y = 1 - (2 * (i + 0.5)) / count;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = i * 2.399963229728653;
  return [Math.cos(angle) * r, y, Math.sin(angle) * r];
}

interface Graph {
  index: Map<string, number>;
  /** Undirected neighbours, in edge order. */
  adjacent: number[][];
  /** Directed successors and predecessor counts, for the hierarchy. */
  out: number[][];
  inCount: number[];
  pairs: [number, number][];
}

function graphOf(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Graph {
  const index = new Map<string, number>();
  nodes.forEach((node, i) => {
    if (!index.has(node.id)) index.set(node.id, i);
  });
  const adjacent = nodes.map(() => [] as number[]);
  const out = nodes.map(() => [] as number[]);
  const inCount = nodes.map(() => 0);
  const pairs: [number, number][] = [];
  for (const edge of edges) {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    if (a === undefined || b === undefined || a === b) continue;
    adjacent[a]?.push(b);
    adjacent[b]?.push(a);
    out[a]?.push(b);
    inCount[b] = (inCount[b] ?? 0) + 1;
    pairs.push([a, b]);
  }
  return { index, adjacent, out, inCount, pairs };
}

/**
 * Breadth-first depth from the given starts; cycles are fine because a node is
 * placed the first time it is reached. Unreached components start again from
 * their first node, so every node gets a depth.
 */
function depths(count: number, starts: number[], next: number[][]): number[] {
  const depth = new Array<number>(count).fill(-1);
  const queue: number[] = [];
  const visit = (from: number[]) => {
    for (const s of from) {
      if (depth[s] !== -1) continue;
      depth[s] = 0;
      queue.push(s);
    }
    while (queue.length > 0) {
      const at = queue.shift() as number;
      for (const n of next[at] ?? []) {
        if (depth[n] !== -1) continue;
        depth[n] = (depth[at] ?? 0) + 1;
        queue.push(n);
      }
    }
  };
  visit(starts);
  for (let i = 0; i < count; i += 1) if (depth[i] === -1) visit([i]);
  return depth;
}

function highestDegree(graph: Graph): number {
  let best = 0;
  graph.adjacent.forEach((list, i) => {
    if (list.length > (graph.adjacent[best]?.length ?? 0)) best = i;
  });
  return best;
}

/** Group order of first appearance: the cluster each node is pulled toward. */
function groupIndex(nodes: readonly GraphNode[]): number[] {
  const order = new Map<string, number>();
  return nodes.map((node) => {
    if (!order.has(node.group)) order.set(node.group, order.size);
    return order.get(node.group) as number;
  });
}

/**
 * Fruchterman–Reingold in 3D with a cooling schedule, a spatial hash for
 * repulsion (linear per step instead of quadratic), and a pull toward each
 * group's centroid so groups read as clusters.
 */
function force(nodes: readonly GraphNode[], graph: Graph): Vec3[] {
  const n = nodes.length;
  const rand = random(seedOf(nodes));
  const groups = groupIndex(nodes);
  const groupCount = Math.max(1, ...groups.map((g) => g + 1));
  const spread = Math.cbrt(n) * 1.2;
  const centres = Array.from({ length: groupCount }, (_, g) =>
    spherePoint(g, groupCount).map((v) => v * spread * 0.9),
  );
  const pos: Vec3[] = nodes.map((_, i) => {
    const c = centres[groups[i] ?? 0] as number[];
    return [
      (c[0] ?? 0) + (rand() - 0.5) * spread * 0.6,
      (c[1] ?? 0) + (rand() - 0.5) * spread * 0.6,
      (c[2] ?? 0) + (rand() - 0.5) * spread * 0.6,
    ];
  });
  const k = 1;
  const cell = 2 * k;
  const iterations = n > 600 ? 120 : 220;
  const disp: Vec3[] = nodes.map(() => [0, 0, 0]);
  for (let step = 0; step < iterations; step += 1) {
    const temperature = spread * 0.12 * (1 - step / iterations) + 0.01;
    for (const d of disp) d.fill(0);
    const grid = new Map<string, number[]>();
    pos.forEach((p, i) => {
      const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    });
    for (let i = 0; i < n; i += 1) {
      const p = pos[i] as Vec3;
      const gx = Math.floor(p[0] / cell);
      const gy = Math.floor(p[1] / cell);
      const gz = Math.floor(p[2] / cell);
      const d = disp[i] as Vec3;
      for (let dx = -1; dx <= 1; dx += 1)
        for (let dy = -1; dy <= 1; dy += 1)
          for (let dz = -1; dz <= 1; dz += 1) {
            for (const j of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
              if (j === i) continue;
              const q = pos[j] as Vec3;
              let x = p[0] - q[0];
              let y = p[1] - q[1];
              let z = p[2] - q[2];
              let dist2 = x * x + y * y + z * z;
              if (dist2 < 1e-6) {
                // Coincident points: a fixed nudge by index keeps the result deterministic.
                x = ((i - j) % 3) * 0.01 + 0.01;
                y = 0.01;
                z = 0;
                dist2 = x * x + y * y;
              }
              if (dist2 > cell * cell) continue;
              const f = (k * k) / dist2;
              d[0] += x * f;
              d[1] += y * f;
              d[2] += z * f;
            }
          }
    }
    for (const [a, b] of graph.pairs) {
      const p = pos[a] as Vec3;
      const q = pos[b] as Vec3;
      const x = p[0] - q[0];
      const y = p[1] - q[1];
      const z = p[2] - q[2];
      const dist = Math.sqrt(x * x + y * y + z * z) || 0.01;
      const f = dist / k;
      const da = disp[a] as Vec3;
      const db = disp[b] as Vec3;
      da[0] -= x * f;
      da[1] -= y * f;
      da[2] -= z * f;
      db[0] += x * f;
      db[1] += y * f;
      db[2] += z * f;
    }
    // Cluster pull toward the live group centroid, and a weak pull to the origin.
    const sums = Array.from({ length: groupCount }, () => [0, 0, 0, 0]);
    pos.forEach((p, i) => {
      const s = sums[groups[i] ?? 0] as number[];
      s[0] = (s[0] ?? 0) + p[0];
      s[1] = (s[1] ?? 0) + p[1];
      s[2] = (s[2] ?? 0) + p[2];
      s[3] = (s[3] ?? 0) + 1;
    });
    for (let i = 0; i < n; i += 1) {
      const p = pos[i] as Vec3;
      const d = disp[i] as Vec3;
      const s = sums[groups[i] ?? 0] as number[];
      const count = s[3] || 1;
      for (let axis = 0; axis < 3; axis += 1) {
        const centroid = (s[axis] ?? 0) / count;
        d[axis] = (d[axis] ?? 0) + (centroid - (p[axis] ?? 0)) * 0.35 - (p[axis] ?? 0) * 0.05;
      }
      const length = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      if (length > 0) {
        const move = Math.min(length, temperature) / length;
        p[0] += d[0] * move;
        p[1] += d[1] * move;
        p[2] += d[2] * move;
      }
    }
  }
  return pos;
}

/** Layers by depth from the sources, each layer a grid in x/z ordered by its parents. */
function hierarchical(nodes: readonly GraphNode[], graph: Graph, root: number | null): Vec3[] {
  const n = nodes.length;
  const sources: number[] = [];
  if (root !== null) sources.push(root);
  for (let i = 0; i < n; i += 1) if (graph.inCount[i] === 0 && i !== root) sources.push(i);
  if (sources.length === 0) sources.push(highestDegree(graph));
  const depth = depths(n, sources, graph.out);
  const layers: number[][] = [];
  depth.forEach((d, i) => {
    if (!layers[d]) layers[d] = [];
    layers[d]?.push(i);
  });
  const order = new Array<number>(n).fill(0);
  const pos: Vec3[] = nodes.map(() => [0, 0, 0]);
  const groups = groupIndex(nodes);
  layers.forEach((layer, d) => {
    // Barycentre of already placed neighbours keeps children under their parents.
    const key = (i: number) => {
      const placed = (graph.adjacent[i] ?? []).filter((j) => (depth[j] ?? 0) < d);
      const mean = placed.length
        ? placed.reduce((sum, j) => sum + (order[j] ?? 0), 0) / placed.length
        : (groups[i] ?? 0) * 1000;
      return mean;
    };
    const sorted = [...layer].sort((a, b) => key(a) - key(b) || a - b);
    const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length * 3)));
    const rows = Math.ceil(sorted.length / cols);
    sorted.forEach((i, at) => {
      order[i] = at / Math.max(1, sorted.length - 1);
      const col = at % cols;
      const row = Math.floor(at / cols);
      pos[i] = [col - (cols - 1) / 2, -d * 2.4, (row - (rows - 1) / 2) * 1.2];
    });
  });
  return pos;
}

/** Rings by depth from the root, each child placed in its parent's angular slice. */
function radial(nodes: readonly GraphNode[], graph: Graph, root: number | null): Vec3[] {
  const n = nodes.length;
  const centre = root ?? highestDegree(graph);
  const depth = depths(n, [centre], graph.adjacent);
  const angle = new Array<number>(n).fill(0);
  const pos: Vec3[] = nodes.map(() => [0, 0, 0]);
  const rings: number[][] = [];
  depth.forEach((d, i) => {
    if (!rings[d]) rings[d] = [];
    rings[d]?.push(i);
  });
  const parentAngle = (i: number, d: number) => {
    const parents = (graph.adjacent[i] ?? []).filter((j) => depth[j] === d - 1);
    return parents.length ? (angle[parents[0] as number] ?? 0) : 0;
  };
  rings.forEach((ring, d) => {
    if (d === 0) {
      ring.forEach((i, at) => {
        pos[i] = [at * 1.5, 0, 0];
      });
      return;
    }
    const sorted = [...ring].sort((a, b) => parentAngle(a, d) - parentAngle(b, d) || a - b);
    const radius = d * 2.2;
    sorted.forEach((i, at) => {
      const theta = (at / sorted.length) * Math.PI * 2;
      angle[i] = theta;
      // Alternate rings tilt slightly so dense rings keep depth instead of a flat disc.
      const lift = Math.sin(theta * 3) * 0.35 * d;
      pos[i] = [Math.cos(theta) * radius, lift, Math.sin(theta) * radius];
    });
  });
  return pos;
}

/**
 * Positions for every node, centred on the origin and scaled so the graph's
 * farthest node sits at `EXTENT`. Duplicate ids and dangling edges are the
 * check's business; here they are skipped so the layout never throws.
 */
export function layoutGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  layout: Layout,
  rootId?: string,
): Vec3[] {
  if (nodes.length === 0) return [];
  const graph = graphOf(nodes, edges);
  const root = rootId !== undefined ? (graph.index.get(rootId) ?? null) : null;
  const raw =
    layout === 'hierarchical'
      ? hierarchical(nodes, graph, root)
      : layout === 'radial'
        ? radial(nodes, graph, root)
        : force(nodes, graph);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of raw)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] as number, p[axis] as number);
      max[axis] = Math.max(max[axis] as number, p[axis] as number);
    }
  const mid = [0, 1, 2].map((axis) => ((min[axis] as number) + (max[axis] as number)) / 2);
  let reach = 0;
  for (const p of raw)
    reach = Math.max(
      reach,
      Math.hypot(p[0] - (mid[0] ?? 0), p[1] - (mid[1] ?? 0), p[2] - (mid[2] ?? 0)),
    );
  const scale = reach > 0 ? EXTENT / reach : 1;
  return raw.map(
    (p) => p.map((v, axis) => round2((v - (mid[axis] ?? 0)) * scale)) as unknown as Vec3,
  );
}
