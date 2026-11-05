/**
 * Terrain field math shared by the compiler and the 3D runtime: the height
 * grid (from data or a seeded relief), bilinear sampling, colour ramps,
 * contour levels and marching-squares segments, the 16-bit height transport,
 * block extent and vertical scale, and the camera fit. Pure and deterministic:
 * the same input gives the same numbers on every host.
 */

/** Largest grid side; a 256 x 256 heightmap is the widget's full resolution. */
export const MAX_SIDE = 256;
export const MIN_SIDE = 2;
export const DEFAULT_RESOLUTION = 128;
export const MAX_FEATURES = 16;
export const MAX_MARKS = 12;
/** World size of the block's longer side; the shorter side follows the grid's aspect. */
export const BLOCK_SIZE = 4;
/** The base under the lowest ground, in world units. */
export const BASE = 0.16;
/** Displayed relief, as a share of the block's longer side, when the compiler picks the scale. */
export const AUTO_RELIEF = 0.24;

export const FEATURE_KINDS = ['peak', 'ridge', 'valley', 'crater', 'basin'] as const;
export const RAMP_NAMES = ['terrain', 'glacier', 'desert', 'volcanic', 'viridis'] as const;
export type RampName = (typeof RAMP_NAMES)[number];

/** Colour ramps as sRGB stops, low to high; data colours, the same in either scheme. */
export const RAMPS: Record<RampName, readonly (readonly [number, string])[]> = {
  terrain: [
    [0, '#2d5e46'],
    [0.16, '#4f8a4c'],
    [0.34, '#9fb06a'],
    [0.5, '#d8c48d'],
    [0.66, '#b08658'],
    [0.8, '#86705f'],
    [0.91, '#c4bdb4'],
    [1, '#f8f7f3'],
  ],
  glacier: [
    [0, '#1b3150'],
    [0.28, '#2c6390'],
    [0.55, '#7fa6cf'],
    [0.8, '#cfe0ee'],
    [1, '#ffffff'],
  ],
  desert: [
    [0, '#6f3519'],
    [0.3, '#b25d2b'],
    [0.56, '#d89f5b'],
    [0.8, '#ecd39c'],
    [1, '#fcf3dc'],
  ],
  volcanic: [
    [0, '#1c1a20'],
    [0.36, '#3e3337'],
    [0.6, '#76392a'],
    [0.82, '#cf612a'],
    [1, '#ffc263'],
  ],
  viridis: [
    [0, '#440154'],
    [0.25, '#3b528b'],
    [0.5, '#21918c'],
    [0.75, '#5ec962'],
    [1, '#fde725'],
  ],
};

export type Rgb = [number, number, number];

function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The ramp colour at `t` in [0, 1], as sRGB channels in [0, 1]. */
export function rampColor(name: string, t: number): Rgb {
  const stops =
    RAMPS[(RAMP_NAMES as readonly string[]).includes(name) ? (name as RampName) : 'terrain'];
  const k = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i += 1) {
    const [t1, c1] = stops[i] as readonly [number, string];
    if (k <= t1) {
      const [t0, c0] = stops[i - 1] as readonly [number, string];
      const f = t1 === t0 ? 0 : (k - t0) / (t1 - t0);
      const a = hexRgb(c0);
      const b = hexRgb(c1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return hexRgb((stops[stops.length - 1] as readonly [number, string])[1]);
}

export function toHex([r, g, b]: Rgb): string {
  const c = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// ---- Height grid ----------------------------------------------------------------------------

export interface Field {
  /** Samples west to east. */
  cols: number;
  /** Samples north to south. */
  rows: number;
  /** Row-major elevations, in the spec's unit. */
  data: Float64Array;
  min: number;
  max: number;
}

export function fieldFrom(cols: number, rows: number, data: Float64Array): Field {
  let min = Infinity;
  let max = -Infinity;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { cols, rows, data, min, max };
}

/** A field from rows of elevations; rows must already be checked to share one length. */
export function fieldFromRows(rows: readonly (readonly number[])[]): Field {
  const cols = rows[0]?.length ?? 0;
  const data = new Float64Array(cols * rows.length);
  rows.forEach((row, r) => {
    for (let c = 0; c < cols; c += 1) data[r * cols + c] = Number(row[c] ?? 0);
  });
  return fieldFrom(cols, rows.length, data);
}

/** Bilinear elevation at `u` (west to east) and `v` (north to south), both in [0, 1]. */
export function sample(field: Field, u: number, v: number): number {
  const x = Math.min(1, Math.max(0, u)) * (field.cols - 1);
  const y = Math.min(1, Math.max(0, v)) * (field.rows - 1);
  const x0 = Math.min(field.cols - 2, Math.floor(x));
  const y0 = Math.min(field.rows - 2, Math.floor(y));
  const fx = x - x0;
  const fy = y - y0;
  const at = (c: number, r: number) => field.data[r * field.cols + c] as number;
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

// ---- Seeded relief --------------------------------------------------------------------------

export interface Feature {
  kind: string;
  at: [number, number];
  to?: [number, number];
  radius: number;
  height: number;
}

export interface Relief {
  seed: number;
  resolution: number;
  roughness: number;
  features: readonly Feature[];
  range: [number, number];
}

/** An integer hash of a lattice point and the seed: the noise is a pure function of both. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** Fractal noise in [0, 1]: ridged in its upper octaves so slopes read as eroded ground. */
function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  let frequency = 1;
  for (let octave = 0; octave < 5; octave += 1) {
    const n = valueNoise(x * frequency, y * frequency, seed + octave * 101);
    const shaped = octave < 2 ? n : 1 - Math.abs(n * 2 - 1);
    sum += shaped * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

/** Distance from point p to segment ab, in the unit square. */
function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function featureLift(f: Feature, p: [number, number], noise: number): number {
  const r = Math.max(0.01, f.radius);
  if (f.kind === 'ridge' || f.kind === 'valley') {
    const d = segmentDistance(p, f.at, f.to ?? f.at) / r;
    const shape = Math.exp(-d * d * 2.2) * (0.75 + 0.5 * noise);
    return f.kind === 'ridge' ? f.height * shape : -f.height * shape;
  }
  const d = Math.hypot(p[0] - f.at[0], p[1] - f.at[1]) / r;
  if (f.kind === 'crater') {
    const rim = Math.exp(-((d - 1) ** 2) * 18);
    const bowl = d < 1 ? (1 - d * d) * 0.85 : 0;
    return f.height * (rim - bowl);
  }
  if (f.kind === 'basin') return -f.height * Math.exp(-d * d * 1.6);
  // A peak: a dome with steep shoulders, its flanks broken up by the noise.
  return f.height * Math.exp(-d * d * 1.5) * (0.78 + 0.44 * noise);
}

/** The seeded relief as a square grid, normalized and mapped onto `range`. */
export function reliefField(relief: Relief): Field {
  const n = Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(relief.resolution)));
  const raw = new Float64Array(n * n);
  const rough = Math.min(1, Math.max(0, relief.roughness));
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      const p: [number, number] = [c / (n - 1), r / (n - 1)];
      const noise = fbm(p[0] * 4 + 7.3, p[1] * 4 + 3.1, relief.seed);
      const swell = fbm(p[0] * 1.6 + 2.9, p[1] * 1.6 + 5.7, relief.seed + 977);
      let lift = 0;
      for (const f of relief.features) lift += featureLift(f, p, noise);
      // High ground is more broken than low ground, as erosion leaves it.
      const detail =
        (noise - 0.5) * 2 * (0.14 + rough * 0.62) * (0.4 + 1.1 * Math.min(1, Math.max(0, lift)));
      raw[r * n + c] = lift + detail + (swell - 0.5) * 2 * (0.06 + rough * 0.22);
    }
  }
  const span = fieldFrom(n, n, raw);
  const [lo, hi] = relief.range;
  const scale = span.max > span.min ? (hi - lo) / (span.max - span.min) : 0;
  const data = new Float64Array(n * n);
  // Rounded to a ten-thousandth of the range, so every host stores the same numbers.
  const step = (hi - lo) / 10000 || 1;
  for (let i = 0; i < raw.length; i += 1)
    data[i] = lo + Math.round((((raw[i] as number) - span.min) * scale) / step) * step;
  return fieldFrom(n, n, data);
}

// ---- Transport ------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Elevations as 16-bit steps between min and max, little-endian, in base64. */
export function encodeHeights(field: Field): string {
  const span = field.max - field.min;
  const bytes = new Uint8Array(field.data.length * 2);
  field.data.forEach((v, i) => {
    const q = span > 0 ? Math.round(((v - field.min) / span) * 65535) : 0;
    bytes[i * 2] = q & 255;
    bytes[i * 2 + 1] = q >> 8;
  });
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    out += b === undefined ? '=' : B64[(n >> 6) & 63];
    out += c === undefined ? '=' : B64[n & 63];
  }
  return out;
}

/** The inverse of `encodeHeights`; a malformed payload gives null. */
export function decodeHeights(
  text: string,
  cols: number,
  rows: number,
  min: number,
  max: number,
): Field | null {
  const count = cols * rows;
  if (!(count > 0) || typeof text !== 'string' || text.length !== Math.ceil((count * 2) / 3) * 4)
    return null;
  const bytes = new Uint8Array(count * 2 + 2);
  let j = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k += 1) {
      const ch = text[i + k] as string;
      const v = ch === '=' ? 0 : B64.indexOf(ch);
      if (v < 0) return null;
      n = (n << 6) | v;
    }
    bytes[j++] = (n >> 16) & 255;
    bytes[j++] = (n >> 8) & 255;
    bytes[j++] = n & 255;
  }
  const data = new Float64Array(count);
  const span = max - min;
  for (let i = 0; i < count; i += 1)
    data[i] =
      min + (((bytes[i * 2] as number) | ((bytes[i * 2 + 1] as number) << 8)) / 65535) * span;
  return { cols, rows, data, min, max };
}

// ---- Contours -------------------------------------------------------------------------------

/** A round contour step that gives about `target` lines across the range. */
export function niceInterval(span: number, target = 9): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit < 1.5 ? 1 : unit < 3.5 ? 2.5 : unit < 7.5 ? 5 : 10;
  return nice === 2.5 && power < 1 ? 2 * power : nice * power;
}

/** Contour levels strictly inside (min, max), every `interval`. */
export function contourLevels(min: number, max: number, interval: number): number[] {
  if (!(interval > 0) || !(max > min)) return [];
  const levels: number[] = [];
  const first = Math.floor(min / interval) + 1;
  for (let k = first; k * interval < max && levels.length < 200; k += 1)
    levels.push(Number((k * interval).toPrecision(12)));
  return levels;
}

/** True for a level that is a multiple of five intervals: an index contour, drawn heavier. */
export function isIndexLevel(level: number, interval: number): boolean {
  const k = Math.round(level / interval);
  return k % 5 === 0;
}

/**
 * Marching-squares segments of one cell at `level`. Corners run (0,0), (1,0), (1,1), (0,1)
 * in cell space; returns pairs of points as [x0, y0, x1, y1] lists, in cell units.
 */
export function cellSegments(
  h00: number,
  h10: number,
  h11: number,
  h01: number,
  level: number,
): number[][] {
  const above = [h00 > level, h10 > level, h11 > level, h01 > level];
  const code = (above[0] ? 1 : 0) | (above[1] ? 2 : 0) | (above[2] ? 4 : 0) | (above[3] ? 8 : 0);
  if (code === 0 || code === 15) return [];
  const t = (a: number, b: number) => (a === b ? 0.5 : (level - a) / (b - a));
  // Edge crossings: top, right, bottom (left to right), left (top to bottom).
  const edges: [number, number][] = [
    [t(h00, h10), 0],
    [1, t(h10, h11)],
    [t(h01, h11), 1],
    [0, t(h00, h01)],
  ];
  const p = (e: number): [number, number] => edges[e] as [number, number];
  const pairs: Record<number, number[][]> = {
    1: [[3, 0]],
    2: [[0, 1]],
    3: [[3, 1]],
    4: [[1, 2]],
    5: [
      [3, 0],
      [1, 2],
    ],
    6: [[0, 2]],
    7: [[3, 2]],
    8: [[2, 3]],
    9: [[2, 0]],
    10: [
      [0, 1],
      [2, 3],
    ],
    11: [[2, 1]],
    12: [[1, 3]],
    13: [[1, 0]],
    14: [[0, 3]],
  };
  return (pairs[code] ?? []).map(([a, b]) => [...p(a ?? 0), ...p(b ?? 0)]);
}

/**
 * Contour segments over the whole field as flat [u0, v0, u1, v1, level-index] runs, `u` and `v`
 * in [0, 1]. `step` samples every step-th grid point, for coarser drawings.
 */
export function contourSegments(field: Field, levels: readonly number[], step = 1): Float32Array {
  const out: number[] = [];
  const s = Math.max(1, Math.floor(step));
  const at = (c: number, r: number) => field.data[r * field.cols + c] as number;
  const cs = Math.floor((field.cols - 1) / s);
  const rs = Math.floor((field.rows - 1) / s);
  for (let r = 0; r < rs; r += 1) {
    for (let c = 0; c < cs; c += 1) {
      const c0 = c * s;
      const r0 = r * s;
      const h00 = at(c0, r0);
      const h10 = at(c0 + s, r0);
      const h11 = at(c0 + s, r0 + s);
      const h01 = at(c0, r0 + s);
      const lo = Math.min(h00, h10, h11, h01);
      const hi = Math.max(h00, h10, h11, h01);
      levels.forEach((level, li) => {
        if (level < lo || level > hi) return;
        for (const seg of cellSegments(h00, h10, h11, h01, level)) {
          out.push(
            (c0 + (seg[0] as number) * s) / (field.cols - 1),
            (r0 + (seg[1] as number) * s) / (field.rows - 1),
            (c0 + (seg[2] as number) * s) / (field.cols - 1),
            (r0 + (seg[3] as number) * s) / (field.rows - 1),
            li,
          );
        }
      });
    }
  }
  return Float32Array.from(out);
}

// ---- World layout ---------------------------------------------------------------------------

export interface Layout {
  /** World width (west to east) and depth (north to south) of the block. */
  extent: [number, number];
  /** World units per elevation unit. */
  vscale: number;
  /** The vertical exaggeration over true scale, when the spec gives the ground's width. */
  exaggeration: number | null;
}

/**
 * Block extent and vertical scale. With the ground's real `width` the relief is drawn at true
 * scale times the exaggeration (the compiler picks one that reads when none is given); without
 * it the relief fills a fixed share of the block, times any exaggeration.
 */
export function terrainLayout(
  field: Field,
  width: number | undefined,
  exaggeration: number | undefined,
): Layout {
  const across = Math.max(1, field.cols - 1);
  const down = Math.max(1, field.rows - 1);
  const k = BLOCK_SIZE / Math.max(across, down);
  const extent: [number, number] = [across * k, down * k];
  const span = field.max - field.min;
  if (!(span > 0)) return { extent, vscale: 0, exaggeration: null };
  if (width !== undefined && width > 0) {
    const trueScale = extent[0] / width;
    const auto = (AUTO_RELIEF * BLOCK_SIZE) / (span * trueScale);
    const exag = exaggeration ?? niceFactor(auto);
    return { extent, vscale: trueScale * exag, exaggeration: exag };
  }
  return {
    extent,
    vscale: ((AUTO_RELIEF * BLOCK_SIZE) / span) * (exaggeration ?? 1),
    exaggeration: null,
  };
}

/** A readable exaggeration factor: whole numbers above 2, one decimal below, at least 1. */
function niceFactor(x: number): number {
  if (!(x > 0)) return 1;
  if (x >= 2) return Math.round(x);
  return Math.max(1, Math.round(x * 10) / 10);
}

/** World position of (u, v) at elevation `h`. */
export function worldPoint(layout: Layout, min: number, u: number, v: number, h: number) {
  return [
    (u - 0.5) * layout.extent[0],
    BASE + (h - min) * layout.vscale,
    (v - 0.5) * layout.extent[1],
  ] as [number, number, number];
}

// ---- Camera ---------------------------------------------------------------------------------

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalize = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** The home bearing: south-east of the block and well above it, so the relief reads. */
export const HOME_BEARING: V3 = normalize([0.52, 0.66, 1]);
export const FOV = 30;

/**
 * The camera along `dir` that fits `corners` inside `fill` of the half frame (across, down) at
 * this aspect, re-aimed at the corners' projected middle. The poster and the live view both use
 * it, so the first live frame lands where the drawing was.
 */
export function fitCamera(
  corners: readonly V3[],
  dir: V3,
  aspect: number,
  fill: [number, number] = [0.9, 0.84],
  fov = FOV,
): { position: V3; target: V3 } {
  const tanH = Math.tan((fov * Math.PI) / 360);
  const forward: V3 = [-dir[0], -dir[1], -dir[2]];
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  let aim: V3 = [0, 0, 0];
  for (const c of corners) aim = [aim[0] + c[0], aim[1] + c[1], aim[2] + c[2]];
  aim = aim.map((v) => v / Math.max(1, corners.length)) as V3;
  const extent = (distance: number) => {
    const eye: V3 = [
      aim[0] + dir[0] * distance,
      aim[1] + dir[1] * distance,
      aim[2] + dir[2] * distance,
    ];
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const c of corners) {
      const d = sub(c, eye);
      const depth = Math.max(1e-6, dot(d, forward));
      const x = dot(d, right) / (depth * tanH * aspect);
      const y = dot(d, up) / (depth * tanH);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return [x0, y0, x1, y1] as const;
  };
  let distance = 10;
  for (let pass = 0; pass < 3; pass += 1) {
    let near = 0.5;
    let far = 200;
    for (let i = 0; i < 48; i += 1) {
      const mid = (near + far) / 2;
      const [x0, y0, x1, y1] = extent(mid);
      if ((x1 - x0) / 2 > fill[0] || (y1 - y0) / 2 > fill[1]) near = mid;
      else far = mid;
    }
    distance = far;
    const [x0, y0, x1, y1] = extent(distance);
    const halfH = tanH * distance;
    const mx = ((x0 + x1) / 2) * halfH * aspect;
    const my = ((y0 + y1) / 2) * halfH;
    aim = [
      aim[0] + right[0] * mx + up[0] * my,
      aim[1] + right[1] * mx + up[1] * my,
      aim[2] + right[2] * mx + up[2] * my,
    ];
  }
  const round = (n: number) => Number(n.toFixed(4));
  return {
    position: [
      aim[0] + dir[0] * distance,
      aim[1] + dir[1] * distance,
      aim[2] + dir[2] * distance,
    ].map(round) as V3,
    target: aim.map(round) as V3,
  };
}

/** The eight corners of the block: its base and the plane of its highest ground. */
export function blockCorners(layout: Layout, top: number): V3[] {
  const [w, d] = layout.extent;
  const out: V3[] = [];
  for (const y of [0, top])
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) out.push([x, y, z]);
  return out;
}

/** An elevation for people: grouped thousands at and above 100, one decimal below. */
export function formatElevation(value: number, unit: string): string {
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 100) {
    text = Math.round(abs)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  } else text = String(Number(abs.toFixed(abs >= 10 ? 1 : 2)));
  const sign = value < 0 && text !== '0' ? '−' : '';
  return unit === '' ? `${sign}${text}` : `${sign}${text} ${unit}`;
}
