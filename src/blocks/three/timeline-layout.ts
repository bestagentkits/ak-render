/**
 * Timeline 3D layout: where each milestone sits in space, the overview camera
 * and the close-up camera for each milestone. Pure arithmetic on the milestone
 * count, shared by the compiler (config and poster) and the runtime (framing),
 * so the drawing and the live scene agree and the output is deterministic.
 */

export type Vec3 = [number, number, number];

export const LAYOUTS = ['auto', 'ribbon', 'spiral', 'line'] as const;
export type Layout = Exclude<(typeof LAYOUTS)[number], 'auto'>;

/** Up to this many milestones read best along a ribbon; more coil into a spiral. */
export const RIBBON_MAX = 18;
export const MAX_MILESTONES = 200;
/** Marker sphere diameter, world units. */
export const MARKER = 0.38;
/** Height of the lowest marker's centre above the floor. */
export const LIFT = 0.55;
export const FOV = 30;
/** Distance from a milestone to its close-up camera. */
export const CLOSE = 5.4;

const round = (n: number) => Number(n.toFixed(4));
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function resolveLayout(layout: string | undefined, count: number): Layout {
  if (layout === 'ribbon' || layout === 'spiral' || layout === 'line') return layout;
  return count <= RIBBON_MAX ? 'ribbon' : 'spiral';
}

/** Raw milestone points before centring, in order. */
function rawPoints(layout: Layout, count: number): Vec3[] {
  const k = (i: number) => (count > 1 ? i / (count - 1) : 0);
  if (layout === 'spiral') {
    // An Archimedean spiral walked at even arc steps, outward, rising gently with time.
    const step = 1.25;
    const start = 1.5;
    const gap = 1.55;
    let theta = 0;
    return Array.from({ length: count }, (_, i) => {
      const r = start + (gap * theta) / (Math.PI * 2);
      const point: Vec3 = [r * Math.cos(theta), LIFT + 2.2 * k(i), r * Math.sin(theta)];
      theta += step / r;
      return point;
    });
  }
  const step = 1.75;
  if (layout === 'line') return Array.from({ length: count }, (_, i) => [i * step, LIFT, 0]);
  // A ribbon: forward along x, swaying in depth, climbing slowly with time.
  return Array.from({ length: count }, (_, i) => [
    i * step,
    LIFT + 0.9 * k(i),
    2.1 * Math.sin((i * step) / 3.2),
  ]);
}

/** Milestone points centred over the origin on the floor plane, rounded. */
export function milestonePoints(layout: Layout, count: number): Vec3[] {
  const raw = rawPoints(layout, count);
  const xs = raw.map((p) => p[0]);
  const zs = raw.map((p) => p[2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  return raw.map(([x, y, z]) => [round(x - cx), round(y), round(z - cz)]);
}

/** Direction from the scene to the overview camera. */
export function overviewDir(layout: Layout): Vec3 {
  // The ribbon is seen from well along its length, so its sway and climb fill the frame's height.
  return norm(layout === 'spiral' ? [0.42, 0.64, 1] : [-0.9, 0.62, 1]);
}

/** The overview look-at point: the middle of the milestones' bounds. */
export function centerOf(points: readonly Vec3[]): Vec3 {
  const mid = (axis: 0 | 1 | 2) => {
    const values = points.map((p) => p[axis]);
    return (Math.min(...values) + Math.max(...values)) / 2;
  };
  return [round(mid(0)), round(mid(1) * 0.6), round(mid(2))];
}

/**
 * The distance along `dir` from `center` at which every point, padded by a
 * marker, fits inside `margin` of a frame of the given aspect.
 */
export function fitDistance(
  points: readonly Vec3[],
  center: Vec3,
  dir: Vec3,
  aspect: number,
  margin = 0.92,
  /** Points that bound the frame vertically only, such as the stems' feet under the markers. */
  below: readonly Vec3[] = [],
): number {
  const forward: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tanV = Math.tan((FOV * Math.PI) / 360) * margin;
  const tanH = tanV * aspect;
  const pad = MARKER * 1.4;
  let distance = 1;
  const offset = (p: Vec3): Vec3 => [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
  for (const p of points) {
    const d = offset(p);
    const depth = dot(d, forward);
    distance = Math.max(
      distance,
      (Math.abs(dot(d, right)) + pad) / tanH - depth,
      (Math.abs(dot(d, up)) + pad) / tanV - depth,
    );
  }
  for (const p of below) {
    const d = offset(p);
    distance = Math.max(distance, Math.abs(dot(d, up)) / tanV - dot(d, forward));
  }
  return distance;
}

export interface Camera {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** The overview camera at an aspect: the whole path in frame along the layout's bearing. */
export function overviewCamera(points: readonly Vec3[], layout: Layout, aspect: number): Camera {
  let center = centerOf(points);
  const dir = overviewDir(layout);
  // The stems' feet frame too, so no stem runs off the stage.
  const ground = Math.min(...points.map((p) => p[1])) - MARKER / 2;
  const feet = points.map(([x, , z]): Vec3 => [x, ground, z]);
  let distance = fitDistance(points, center, dir, aspect, undefined, feet);
  // Perspective pulls an oblique path off centre: aim at the middle of its projected extent, then refit.
  const forward: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  for (let pass = 0; pass < 2; pass += 1) {
    const eye = center.map((c, i) => c + (dir[i] as number) * distance) as Vec3;
    const screen = (p: Vec3) => {
      const d: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
      const depth = dot(d, forward);
      return [dot(d, right) / depth, dot(d, up) / depth] as const;
    };
    const xs = points.map((p) => screen(p)[0]);
    const ys = [...points, ...feet].map((p) => screen(p)[1]);
    const sx = ((Math.min(...xs) + Math.max(...xs)) / 2) * distance;
    const sy = ((Math.min(...ys) + Math.max(...ys)) / 2) * distance;
    center = center.map((c, i) => c + (right[i] as number) * sx + (up[i] as number) * sy) as Vec3;
    distance = fitDistance(points, center, dir, aspect, undefined, feet);
  }
  center = center.map(round) as Vec3;
  return {
    position: center.map((c, i) => round(c + (dir[i] as number) * distance)) as Vec3,
    target: center,
    fov: FOV,
  };
}

/**
 * The close-up camera for milestone `i`: beside the path on the overview's
 * side, a little above and behind, so the neighbours on either side stay in
 * view and the path reads as moving forward.
 */
export function milestoneCamera(points: readonly Vec3[], i: number, layout: Layout): Camera {
  const at = points[i] as Vec3;
  const before = points[Math.max(0, i - 1)] as Vec3;
  const after = points[Math.min(points.length - 1, i + 1)] as Vec3;
  let tangent = norm([after[0] - before[0], 0, after[2] - before[2]]);
  if (tangent[0] === 0 && tangent[2] === 0) tangent = [1, 0, 0];
  let side = norm(cross([0, 1, 0], tangent));
  // Look from the overview's side, so a flight in never turns the world around.
  const home = overviewDir(layout);
  if (dot(side, home) < 0) side = [-side[0], -side[1], -side[2]];
  const dir = norm([side[0] - tangent[0] * 0.38, 0.62, side[2] - tangent[2] * 0.38]);
  const target: Vec3 = [at[0], at[1] + 0.12, at[2]];
  return {
    position: target.map((c, k) => round(c + (dir[k] as number) * CLOSE)) as Vec3,
    target: target.map(round) as Vec3,
    fov: FOV,
  };
}

/** Sortable value of an ISO-like date (`1969`, `1969-07`, `1969-07-20`, `-500`), or null. */
export function dateKey(value: string): number | null {
  const match = /^(-?\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/u.exec(value.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = match[2] === undefined ? 0 : Number(match[2]);
  const day = match[3] === undefined ? 0 : Number(match[3]);
  if (month > 12 || day > 31) return null;
  return year * 10_000 + month * 100 + day;
}

/** The floor the markers stand over: just under the lowest marker, where the shadow catcher sits. */
export function floorY(points: readonly Vec3[]): number {
  return round(Math.min(...points.map((p) => p[1])) - MARKER / 2);
}
