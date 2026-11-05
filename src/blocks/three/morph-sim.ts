/**
 * Morph 3D geometry and timeline, shared by the compiler (poster) and the
 * runtime (live mesh), so both draw the same surfaces from the same numbers.
 *
 * Every target is sampled on one grid per topology: a welded cube-sphere for
 * closed surfaces and a wrapped (u, v) grid for rings. Targets on one grid have
 * the same vertex count, order and faces, so a morph is a straight per-vertex
 * blend. A closed surface and a ring differ in genus, so no blend between them
 * exists; mixing them is a compile error, never a torn or collapsing mesh.
 */

export const CLOSED_SHAPES = [
  'sphere',
  'cube',
  'capsule',
  'cylinder',
  'cone',
  'gem',
  'blob',
  'star',
] as const;
export const RING_SHAPES = ['torus', 'knot', 'twist'] as const;
export const MORPH_SHAPES = [...CLOSED_SHAPES, ...RING_SHAPES] as const;
export type MorphShape = (typeof MORPH_SHAPES)[number];
export type Topology = 'closed' | 'ring';

export const EASINGS = ['smooth', 'spring', 'snap', 'linear'] as const;
export type Easing = (typeof EASINGS)[number];
export const TIMELINES = ['loop', 'once', 'manual'] as const;
export type TimelineMode = (typeof TIMELINES)[number];

export const MIN_TARGETS = 2;
export const MAX_TARGETS = 6;

/** Grid detail: the live mesh, the poster and the chip glyphs. */
export const LIVE_DETAIL = { closed: 30, ring: [192, 28] } as const;
export const POSTER_DETAIL = { closed: 18, ring: [96, 16] } as const;
export const GLYPH_DETAIL = { closed: 5, ring: [28, 6] } as const;
export interface Detail {
  closed: number;
  ring: readonly [number, number];
}

const RING_SET: ReadonlySet<string> = new Set(RING_SHAPES);
export function topologyOf(shape: string): Topology {
  return RING_SET.has(shape) ? 'ring' : 'closed';
}
/** Human name of a topology, for diagnostics. */
export const TOPOLOGY_NAME: Record<Topology, string> = {
  closed: 'a closed surface (genus 0)',
  ring: 'a ring (genus 1)',
};

/**
 * The index of the first target whose topology differs from the first one's,
 * or -1 when every target can morph into every other.
 */
export function topologyBreak(shapes: readonly string[]): number {
  const first = shapes[0];
  if (first === undefined) return -1;
  const want = topologyOf(first);
  return shapes.findIndex((shape) => topologyOf(shape) !== want);
}

type V3 = [number, number, number];
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

// ---- Closed shapes: signed distances, sampled along rays from the centre -------------------

const ICOSA: V3[] = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: V3[] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  return raw.map(([x, y, z]) => {
    const l = len3(x, y, z);
    return [x / l, y / l, z / l];
  });
})();

/** Signed distance (or a bound with the right sign) of each closed shape; every one contains the origin. */
const SDF: Record<(typeof CLOSED_SHAPES)[number], (x: number, y: number, z: number) => number> = {
  sphere: (x, y, z) => len3(x, y, z) - 1,
  cube(x, y, z) {
    const r = 0.17;
    const qx = Math.abs(x) - 0.74 + r;
    const qy = Math.abs(y) - 0.74 + r;
    const qz = Math.abs(z) - 0.74 + r;
    return (
      len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
      Math.min(Math.max(qx, qy, qz), 0) -
      r
    );
  },
  capsule(x, y, z) {
    const h = Math.max(-0.46, Math.min(0.46, y));
    return len3(x, y - h, z) - 0.58;
  },
  cylinder(x, y, z) {
    const r = 0.14;
    const dx = Math.hypot(x, z) - 0.82 + r;
    const dy = Math.abs(y) - 0.66 + r;
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
  },
  cone(x, y, z) {
    // A rounded cone: a wide sphere at the base swept to a small one at the tip.
    const r1 = 0.64;
    const r2 = 0.09;
    const h = 1.36;
    const qx = Math.hypot(x, z);
    const qy = y + 0.42;
    const b = (r1 - r2) / h;
    const a = Math.sqrt(1 - b * b);
    const k = -b * qx + a * qy;
    if (k < 0) return Math.hypot(qx, qy) - r1;
    if (k > a * h) return Math.hypot(qx, qy - h) - r2;
    return qx * a + qy * b - r1;
  },
  gem: (x, y, z) => (Math.abs(x) + Math.abs(y) / 1.22 + Math.abs(z) - 0.8) * 0.5774 - 0.07,
  blob(x, y, z) {
    const l = len3(x, y, z) || 1;
    const [dx, dy, dz] = [x / l, y / l, z / l];
    const r =
      0.9 +
      0.075 * (Math.sin(3.1 * dx + 0.7) + Math.sin(2.7 * dy + 1.9) + Math.sin(3.4 * dz + 2.6)) +
      0.06 * Math.sin(4.6 * dx * dy + 5.2 * dz + 0.3);
    return l - r;
  },
  star(x, y, z) {
    const l = len3(x, y, z) || 1;
    let m = 0;
    for (const v of ICOSA) m = Math.max(m, (x * v[0] + y * v[1] + z * v[2]) / l);
    return l - (0.66 + 0.5 * m ** 14);
  },
};

/** The surface point along unit direction d, found by bisection; deterministic to float precision. */
function castRay(shape: (typeof CLOSED_SHAPES)[number], dx: number, dy: number, dz: number): V3 {
  const f = SDF[shape];
  let near = 0;
  let far = 2.5;
  for (let i = 0; i < 40; i += 1) {
    const mid = (near + far) / 2;
    if (f(dx * mid, dy * mid, dz * mid) < 0) near = mid;
    else far = mid;
  }
  const t = (near + far) / 2;
  return [dx * t, dy * t, dz * t];
}

// ---- Ring shapes: a tube swept along a closed curve in the xy plane -------------------------

interface RingSpec {
  /** Point on the centre curve at u in [0, 1). */
  curve(u: number): V3;
  /** Cross-section radius at u, tube angle theta. */
  radius(u: number, theta: number): number;
}

const TAU = Math.PI * 2;

const RINGS: Record<(typeof RING_SHAPES)[number], RingSpec> = {
  torus: {
    curve: (u) => [0.74 * Math.cos(u * TAU), 0.74 * Math.sin(u * TAU), 0],
    radius: () => 0.3,
  },
  knot: {
    // A (2, 3) torus knot.
    curve(u) {
      const t = u * TAU * 2;
      const r = 0.6 * (2 + Math.cos(1.5 * t)) * 0.5;
      return [r * Math.cos(t), r * Math.sin(t), 0.3 * Math.sin(1.5 * t)];
    },
    radius: () => 0.17,
  },
  twist: {
    // A rounded-square tube that turns three quarter-turns per lap, so its ends meet.
    curve: (u) => [0.74 * Math.cos(u * TAU), 0.74 * Math.sin(u * TAU), 0],
    radius(u, theta) {
      const a = theta - u * Math.PI * 1.5;
      const c = Math.abs(Math.cos(a));
      const s = Math.abs(Math.sin(a));
      return 0.29 / (c ** 4 + s ** 4) ** 0.25;
    },
  },
};

/** Tube points with the same frame rule for every ring, so all rings wind the same way. */
function ringPoint(spec: RingSpec, u: number, v: number, step: number): V3 {
  const p1 = spec.curve(u);
  const p2 = spec.curve(u + step);
  const t: V3 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
  const s: V3 = [p2[0] + p1[0], p2[1] + p1[1], p2[2] + p1[2]];
  let b: V3 = [t[1] * s[2] - t[2] * s[1], t[2] * s[0] - t[0] * s[2], t[0] * s[1] - t[1] * s[0]];
  let n: V3 = [b[1] * t[2] - b[2] * t[1], b[2] * t[0] - b[0] * t[2], b[0] * t[1] - b[1] * t[0]];
  const bl = len3(...b) || 1;
  const nl = len3(...n) || 1;
  b = [b[0] / bl, b[1] / bl, b[2] / bl];
  n = [n[0] / nl, n[1] / nl, n[2] / nl];
  const theta = v * TAU;
  const r = spec.radius(u, theta);
  const c = Math.cos(theta) * r;
  const sn = Math.sin(theta) * r;
  return [p1[0] + c * n[0] + sn * b[0], p1[1] + c * n[1] + sn * b[1], p1[2] + c * n[2] + sn * b[2]];
}

// ---- Grids -----------------------------------------------------------------------------------

/** One topology's sample grid: per-vertex parameters and quad faces (4 indices each). */
export interface MorphGrid {
  topology: Topology;
  /** Closed: unit directions (3 per vertex). Ring: (u, v) pairs (2 per vertex). */
  params: Float64Array;
  vertexCount: number;
  quads: Uint32Array;
  /** The ring grid's u step, for the tube frame. */
  step: number;
}

/** Cube-sphere grid with shared edge vertices welded, so the surface has no seams. */
function closedGrid(n: number): MorphGrid {
  const keys = new Map<string, number>();
  const dirs: number[] = [];
  const quads: number[] = [];
  const vertex = (c: V3): number => {
    const key = `${c[0]},${c[1]},${c[2]}`;
    const found = keys.get(key);
    if (found !== undefined) return found;
    const [x, y, z] = [c[0] / n, c[1] / n, c[2] / n];
    // The cube-to-sphere map that keeps cells close to equal in area.
    const sx = x * Math.sqrt(1 - (y * y) / 2 - (z * z) / 2 + (y * y * z * z) / 3);
    const sy = y * Math.sqrt(1 - (z * z) / 2 - (x * x) / 2 + (z * z * x * x) / 3);
    const sz = z * Math.sqrt(1 - (x * x) / 2 - (y * y) / 2 + (x * x * y * y) / 3);
    const l = len3(sx, sy, sz) || 1;
    dirs.push(sx / l, sy / l, sz / l);
    keys.set(key, keys.size);
    return keys.size - 1;
  };
  for (const axis of [0, 1, 2] as const)
    for (const sign of [-1, 1]) {
      const b = (axis + 1) % 3;
      const c = (axis + 2) % 3;
      const at = (i: number, j: number): number => {
        const p: V3 = [0, 0, 0];
        p[axis] = sign * n;
        p[b] = -n + 2 * i;
        p[c] = -n + 2 * j;
        return vertex(p);
      };
      for (let i = 0; i < n; i += 1)
        for (let j = 0; j < n; j += 1) {
          const [p, q, r, s] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
          // Wind every face outward: the (b, c) basis flips handedness with the sign.
          quads.push(...(sign > 0 ? [p, q, r, s] : [p, s, r, q]));
        }
    }
  return {
    topology: 'closed',
    params: Float64Array.from(dirs),
    vertexCount: keys.size,
    quads: Uint32Array.from(quads as number[]),
    step: 0,
  };
}

function ringGrid(segments: number, sides: number): MorphGrid {
  const params: number[] = [];
  for (let i = 0; i < segments; i += 1)
    for (let j = 0; j < sides; j += 1) params.push(i / segments, j / sides);
  const quads: number[] = [];
  const at = (i: number, j: number) => (i % segments) * sides + (j % sides);
  for (let i = 0; i < segments; i += 1)
    for (let j = 0; j < sides; j += 1)
      quads.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
  return {
    topology: 'ring',
    params: Float64Array.from(params),
    vertexCount: segments * sides,
    quads: Uint32Array.from(quads),
    step: 1 / segments,
  };
}

/** Signed volume of a closed quad mesh; positive when the faces wind outward. */
export function signedVolume(positions: Float32Array, quads: Uint32Array): number {
  let volume = 0;
  const p = (i: number): V3 => [
    positions[i * 3] as number,
    positions[i * 3 + 1] as number,
    positions[i * 3 + 2] as number,
  ];
  const tet = (a: V3, b: V3, c: V3) =>
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0]);
  for (let q = 0; q < quads.length; q += 4) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => p(quads[q + k] as number)) as [V3, V3, V3, V3];
    volume += tet(a, b, c) + tet(a, c, d);
  }
  return volume / 6;
}

const gridCache = new Map<string, MorphGrid>();
export function morphGrid(topology: Topology, detail: Detail): MorphGrid {
  const key = topology === 'closed' ? `c${detail.closed}` : `r${detail.ring.join('x')}`;
  const cached = gridCache.get(key);
  if (cached) return cached;
  let grid =
    topology === 'closed' ? closedGrid(detail.closed) : ringGrid(detail.ring[0], detail.ring[1]);
  // Fix the winding once against a reference shape, so every face of every target points out.
  const reference = shapePositions(topology === 'closed' ? 'sphere' : 'torus', grid);
  if (signedVolume(reference, grid.quads) < 0) {
    const flipped = new Uint32Array(grid.quads.length);
    for (let q = 0; q < grid.quads.length; q += 4) {
      flipped[q] = grid.quads[q] as number;
      flipped[q + 1] = grid.quads[q + 3] as number;
      flipped[q + 2] = grid.quads[q + 2] as number;
      flipped[q + 3] = grid.quads[q + 1] as number;
    }
    grid = { ...grid, quads: flipped };
  }
  gridCache.set(key, grid);
  return grid;
}

/** One target's vertex positions on its topology's grid. */
export function shapePositions(shape: string, grid: MorphGrid): Float32Array {
  const out = new Float32Array(grid.vertexCount * 3);
  if (grid.topology === 'closed') {
    const name = (CLOSED_SHAPES as readonly string[]).includes(shape)
      ? (shape as (typeof CLOSED_SHAPES)[number])
      : 'sphere';
    for (let i = 0; i < grid.vertexCount; i += 1) {
      const p = castRay(
        name,
        grid.params[i * 3] as number,
        grid.params[i * 3 + 1] as number,
        grid.params[i * 3 + 2] as number,
      );
      out.set(p, i * 3);
    }
    return out;
  }
  const spec =
    RINGS[(RING_SHAPES as readonly string[]).includes(shape) ? (shape as 'torus') : 'torus'];
  for (let i = 0; i < grid.vertexCount; i += 1)
    out.set(
      ringPoint(spec, grid.params[i * 2] as number, grid.params[i * 2 + 1] as number, grid.step),
      i * 3,
    );
  return out;
}

/** Triangle indices for a quad grid. */
export function triangles(quads: Uint32Array): Uint32Array {
  const out = new Uint32Array((quads.length / 4) * 6);
  for (let q = 0, t = 0; q < quads.length; q += 4, t += 6) {
    const [a, b, c, d] = [quads[q], quads[q + 1], quads[q + 2], quads[q + 3]] as number[];
    out.set([a as number, b as number, c as number, a as number, c as number, d as number], t);
  }
  return out;
}

/** Area-weighted vertex normals over quads; the welded grid makes them smooth across seams. */
export function vertexNormals(positions: Float32Array, quads: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  const p = (i: number, k: number) => positions[i * 3 + k] as number;
  for (let q = 0; q < quads.length; q += 4) {
    const [a, b, c, d] = [quads[q], quads[q + 1], quads[q + 2], quads[q + 3]] as number[] as [
      number,
      number,
      number,
      number,
    ];
    // The cross of the diagonals is twice the quad's area vector.
    const e: V3 = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)];
    const f: V3 = [p(d, 0) - p(b, 0), p(d, 1) - p(b, 1), p(d, 2) - p(b, 2)];
    const nx = e[1] * f[2] - e[2] * f[1];
    const ny = e[2] * f[0] - e[0] * f[2];
    const nz = e[0] * f[1] - e[1] * f[0];
    for (const v of [a, b, c, d]) {
      normals[v * 3] = (normals[v * 3] as number) + nx;
      normals[v * 3 + 1] = (normals[v * 3 + 1] as number) + ny;
      normals[v * 3 + 2] = (normals[v * 3 + 2] as number) + nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = len3(normals[i] as number, normals[i + 1] as number, normals[i + 2] as number) || 1;
    normals[i] = (normals[i] as number) / l;
    normals[i + 1] = (normals[i + 1] as number) / l;
    normals[i + 2] = (normals[i + 2] as number) / l;
  }
  return normals;
}

export interface MorphMesh {
  grid: MorphGrid;
  /** Positions per target, all on one grid. */
  targets: Float32Array[];
}

/**
 * Every target sampled on the shared grid. Throws on mixed topologies: the
 * compiler rejects them first, so this only guards a tampered page.
 */
export function buildMorph(shapes: readonly string[], detail: Detail): MorphMesh {
  const broken = topologyBreak(shapes);
  if (broken !== -1)
    throw new Error(
      `morph target ${broken} (${shapes[broken]}) has a different topology from ${shapes[0]}`,
    );
  const grid = morphGrid(topologyOf(shapes[0] ?? 'sphere'), detail);
  return { grid, targets: shapes.map((shape) => shapePositions(shape, grid)) };
}

// ---- Easing and timeline -------------------------------------------------------------------

/** Easing curves; `spring` overshoots and settles, so blend weights briefly leave [0, 1]. */
export function ease(name: string, k: number): number {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  if (name === 'linear') return k;
  if (name === 'snap') return 1 - 2 ** (-10 * k);
  if (name === 'spring') return 1 - Math.exp(-6 * k) * Math.cos(k * Math.PI * 4.5);
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
}

export interface TimelineOptions {
  /** Milliseconds per morph. */
  duration: number;
  /** Milliseconds each target holds before the next morph, when the timeline plays itself. */
  hold: number;
  easing: string;
  mode: TimelineMode;
}

/**
 * Blend weights over the targets, driven by a clock the caller passes in. A
 * transition starts from whatever blend is showing, so a new target chosen
 * mid-morph turns smoothly instead of jumping. Weights always sum to one.
 */
export class MorphTimeline {
  readonly weights: number[];
  /** The target being shown or morphed toward. */
  target: number;
  /** True while the timeline advances itself (loop or once). */
  playing: boolean;
  /** Morphs completed, for tests and diagnostics. */
  landed = 0;
  private from: number[];
  private startAt: number | null = null;
  private restAt: number | null = null;
  private moving = false;

  constructor(
    readonly count: number,
    initial: number,
    readonly options: TimelineOptions,
  ) {
    this.target = Math.min(Math.max(0, initial), count - 1);
    this.weights = Array.from({ length: count }, (_, i) => (i === this.target ? 1 : 0));
    this.from = [...this.weights];
    this.playing = options.mode !== 'manual' && count > 1;
  }

  /** True mid-morph. */
  get morphing(): boolean {
    return this.moving;
  }

  /** The share of the current morph done, eased; 1 at rest. */
  progress = 1;

  /** Start a morph toward `index`; false when it is already there. */
  goTo(index: number): boolean {
    if (index < 0 || index >= this.count) return false;
    if (index === this.target && !this.moving) return false;
    this.from = [...this.weights];
    this.target = index;
    this.startAt = null;
    this.moving = true;
    this.progress = 0;
    return true;
  }

  /** Land the current morph at once. */
  settle(): void {
    if (!this.moving) return;
    this.finish();
  }

  private finish(): void {
    for (let i = 0; i < this.count; i += 1) this.weights[i] = i === this.target ? 1 : 0;
    this.moving = false;
    this.progress = 1;
    this.landed += 1;
    this.restAt = null;
  }

  /** Advance to `now` (ms); true while frames are still needed (morphing or waiting to play on). */
  step(now: number): boolean {
    if (this.moving) {
      if (this.startAt === null) this.startAt = now;
      const k = this.options.duration > 0 ? (now - this.startAt) / this.options.duration : 1;
      if (k >= 1) {
        this.finish();
        this.restAt = now;
      } else {
        const e = ease(this.options.easing, k);
        this.progress = e;
        for (let i = 0; i < this.count; i += 1)
          this.weights[i] = (this.from[i] as number) * (1 - e) + (i === this.target ? e : 0);
        return true;
      }
    }
    if (!this.playing) return false;
    if (this.restAt === null) this.restAt = now;
    if (now - this.restAt < this.options.hold) return true;
    const next = this.target + 1;
    if (next >= this.count) {
      if (this.options.mode !== 'loop') {
        this.playing = false;
        return false;
      }
      this.goTo(0);
    } else this.goTo(next);
    this.startAt = now;
    return true;
  }
}
