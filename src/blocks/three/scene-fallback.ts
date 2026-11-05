/**
 * The static scene: what a reader sees with no JavaScript, no WebGL, in print
 * before the live frame exists, and in a screenshot of the source.
 *
 * The compiler projects every object's world position through the same camera
 * the runtime uses and draws a labelled SVG plan, so the poster agrees with the
 * live scene without a browser. Numbers are rounded, so output stays
 * byte-deterministic.
 */

import type { JsonValue } from '../../json.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';

export type Vec3 = [number, number, number];

export interface SceneCamera {
  position: Vec3;
  target: Vec3;
  fov: number;
}

export interface PlacedObject {
  id: string;
  label: string;
  description: string;
  shape: string;
  tone: string;
  size: number;
  world: Vec3;
  scale: number;
}

const DEG = Math.PI / 180;

export function vec(value: JsonValue | undefined, fallback: Vec3): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number')
    ? (value as Vec3)
    : fallback;
}

/** Rotate by Euler XYZ degrees, the order Three.js uses by default. */
function rotate(p: Vec3, r: Vec3): Vec3 {
  let [x, y, z] = p;
  const [a, b, c] = [r[0] * DEG, r[1] * DEG, r[2] * DEG];
  // Object3D applies Rz * Ry * Rx to a local point: X first.
  [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
  [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
  [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)];
  return [x, y, z];
}

interface Frame {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  parent?: string;
}

/** World positions of every object, applying the parent chain. */
export function placeObjects(objects: readonly Record<string, JsonValue>[]): PlacedObject[] {
  const frames = new Map<string, Frame>();
  for (const object of objects) {
    frames.set(String(object.id), {
      position: vec(object.position, [0, 0, 0]),
      rotation: vec(object.rotation, [0, 0, 0]),
      scale: vec(object.scale, [1, 1, 1]),
      ...(typeof object.parent === 'string' ? { parent: object.parent } : {}),
    });
  }
  const worldOf = (id: string, guard: number): { p: Vec3; s: number } => {
    const frame = frames.get(id);
    if (frame === undefined || guard > 16) return { p: [0, 0, 0], s: 1 };
    const own = Math.max(...frame.scale);
    if (frame.parent === undefined || !frames.has(frame.parent))
      return { p: frame.position, s: own };
    const parent = frames.get(frame.parent) as Frame;
    const up = worldOf(frame.parent, guard + 1);
    const local = rotate(
      [
        frame.position[0] * parent.scale[0],
        frame.position[1] * parent.scale[1],
        frame.position[2] * parent.scale[2],
      ],
      parent.rotation,
    );
    // The parent's own rotation is folded in above; its ancestors' rotations are
    // approximated by translation only, which is enough for a labelled plan.
    return { p: [up.p[0] + local[0], up.p[1] + local[1], up.p[2] + local[2]], s: up.s * own };
  };
  return objects.map((object) => {
    const id = String(object.id);
    const world = worldOf(id, 0);
    return {
      id,
      label: typeof object.label === 'string' ? object.label : id,
      description: typeof object.description === 'string' ? object.description : '',
      shape: typeof object.shape === 'string' ? object.shape : 'box',
      tone: typeof object.tone === 'string' ? object.tone : 'accent',
      size: typeof object.size === 'number' ? object.size : 1,
      world: world.p,
      scale: world.s,
    };
  });
}

const W = 640;
const H = 360;
const round = (n: number) => Math.round(n * 10) / 10;

/** Perspective projection of a world point; null when behind the camera. */
export function project(
  p: Vec3,
  camera: SceneCamera,
): { x: number; y: number; depth: number } | null {
  const [cx, cy, cz] = camera.position;
  const forward = normalize([camera.target[0] - cx, camera.target[1] - cy, camera.target[2] - cz]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const d: Vec3 = [p[0] - cx, p[1] - cy, p[2] - cz];
  const depth = dot(d, forward);
  if (depth <= 0.01) return null;
  const f = H / 2 / Math.tan((camera.fov * DEG) / 2);
  return { x: W / 2 + (dot(d, right) * f) / depth, y: H / 2 - (dot(d, up) * f) / depth, depth };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function glyph(shape: string, x: number, y: number, r: number): string {
  const a = `${round(x)}`;
  const b = `${round(y)}`;
  if (shape === 'sphere' || shape === 'icosahedron')
    return `<circle cx="${a}" cy="${b}" r="${round(r)}"/>`;
  if (shape === 'torus' || shape === 'torus-knot') {
    return `<circle cx="${a}" cy="${b}" r="${round(r)}" fill="none" stroke-width="${round(Math.max(2, r / 3))}"/>`;
  }
  if (shape === 'cone') {
    return `<polygon points="${round(x)},${round(y - r)} ${round(x + r)},${round(y + r)} ${round(x - r)},${round(y + r)}"/>`;
  }
  if (shape === 'plane') {
    return `<rect x="${round(x - r * 1.4)}" y="${round(y - r * 0.3)}" width="${round(r * 2.8)}" height="${round(r * 0.6)}"/>`;
  }
  return `<rect x="${round(x - r)}" y="${round(y - r)}" width="${round(r * 2)}" height="${round(r * 2)}" rx="${round(r / 5)}"/>`;
}

/** The labelled SVG plan of the scene. */
export function scenePoster(
  objects: readonly PlacedObject[],
  camera: SceneCamera,
  label: string,
): string {
  const drawn = objects
    .filter((object) => object.shape !== 'group')
    .map((object) => ({ object, at: project(object.world, camera) }))
    .filter((entry) => entry.at !== null)
    .sort(
      (a, b) => (b.at?.depth ?? 0) - (a.at?.depth ?? 0) || a.object.id.localeCompare(b.object.id),
    );
  const marks = drawn
    .map(({ object, at }) => {
      const point = at as { x: number; y: number; depth: number };
      const f = H / 2 / Math.tan((camera.fov * DEG) / 2);
      const r = Math.min(120, Math.max(4, ((object.size * object.scale) / 2 / point.depth) * f));
      return `<g class="ak-3d-mark" data-tone="${escapeAttribute(object.tone)}">${glyph(
        object.shape,
        point.x,
        point.y,
        r,
      )}<text x="${round(point.x)}" y="${round(point.y + r + 14)}">${escapeText(object.label)}</text></g>`;
    })
    .join('');
  return `<svg class="ak-3d-poster" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet">${marks}</svg>`;
}

/** Bounding radius of a drawn object; a plane is flat, so its corners set the extent. */
function radiusOf(object: PlacedObject): number {
  const half = (object.size * object.scale) / 2;
  if (object.shape === 'plane') return half * Math.SQRT2;
  if (object.shape === 'sphere' || object.shape === 'icosahedron') return half;
  // Boxes, cylinders, cones and tori: the corner of the enclosing cube.
  return half * Math.sqrt(3);
}

const FILL = 0.84;
const ELEVATION = 28 * DEG;

/**
 * Points that bound what each object shows on screen: the eight corners of its
 * enclosing cube, pulled in to the sphere for round shapes. Tighter than a
 * sphere's axis points, so the framing hugs the subject.
 */
function extremes(objects: readonly PlacedObject[]): Vec3[] {
  return objects.flatMap((object) => {
    const half = (object.size * object.scale) / 2;
    const round = object.shape === 'sphere' || object.shape === 'icosahedron';
    const h = round ? half * 0.82 : half;
    const [x, y, z] = object.world;
    const corners: Vec3[] = [];
    for (const dx of [-h, h])
      for (const dy of [-h, h]) for (const dz of [-h, h]) corners.push([x + dx, y + dy, z + dz]);
    return round
      ? [...corners, [x + half, y, z], [x - half, y, z], [x, y + half, z], [x, y - half, z]]
      : corners;
  });
}

/** Screen-space bounds of points from this camera, or null when any is behind it. */
function screenBounds(
  points: readonly Vec3[],
  camera: SceneCamera,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const at = project(point, camera);
    if (at === null) return null;
    minX = Math.min(minX, at.x);
    maxX = Math.max(maxX, at.x);
    minY = Math.min(minY, at.y);
    maxY = Math.max(maxY, at.y);
  }
  return { minX, maxX, minY, maxY };
}
/** True when every point lands inside the central FILL share of the frame. */
function fits(points: readonly Vec3[], camera: SceneCamera): boolean {
  return points.every((point) => {
    const at = project(point, camera);
    return (
      at !== null &&
      Math.abs(at.x - W / 2) <= (W / 2) * FILL &&
      Math.abs(at.y - H / 2) <= (H / 2) * FILL
    );
  });
}

/** How much the pickable objects cover each other from this camera, in pixels. */
function overlap(objects: readonly PlacedObject[], camera: SceneCamera): number {
  const f = H / 2 / Math.tan((camera.fov * DEG) / 2);
  const marks = objects.flatMap((object) => {
    const at = project(object.world, camera);
    return at === null ? [] : [{ x: at.x, y: at.y, r: (radiusOf(object) * f) / at.depth }];
  });
  let total = 0;
  for (let i = 0; i < marks.length; i += 1) {
    for (let j = i + 1; j < marks.length; j += 1) {
      const a = marks[i] as (typeof marks)[number];
      const b = marks[j] as (typeof marks)[number];
      total += Math.max(0, a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return total;
}

/**
 * The camera a scene uses: authored, or framed by the compiler. The framing
 * tries eight azimuths at a fixed elevation, keeps the one where the pickable
 * objects hide each other least, and moves in until the scene fills 80% of the
 * frame. Every step is arithmetic on the spec, so the result is deterministic.
 */
export function frameCamera(
  objects: readonly PlacedObject[],
  authored: JsonValue | undefined,
): SceneCamera {
  const given =
    authored !== null && typeof authored === 'object' && !Array.isArray(authored) ? authored : {};
  const fov = typeof given.fov === 'number' ? given.fov : 30;
  const drawn = objects.filter((object) => object.shape !== 'group');
  if (Array.isArray(given.position)) {
    return { position: vec(given.position, [0, 0, 0]), target: vec(given.target, [0, 0, 0]), fov };
  }
  // The floor frames nothing: fit the subject, and the plane only when it is all there is.
  const subject = drawn.filter((object) => object.shape !== 'plane');
  const points = extremes(subject.length > 0 ? subject : drawn);
  const aimed = Array.isArray(given.target);
  const target: Vec3 = aimed
    ? vec(given.target, [0, 0, 0])
    : points.length === 0
      ? [0, 0, 0]
      : ([0, 1, 2].map((axis) => {
          const values = points.map((point) => point[axis] as number);
          return round((Math.min(...values) + Math.max(...values)) / 2);
        }) as Vec3);
  const pickable = drawn.filter((object) => object.shape !== 'plane');
  let best: { camera: SceneCamera; score: number } | undefined;
  for (let k = 0; k < 8; k += 1) {
    const azimuth = (35 + k * 45) * DEG;
    const direction: Vec3 = [
      Math.cos(ELEVATION) * Math.sin(azimuth),
      Math.sin(ELEVATION),
      Math.cos(ELEVATION) * Math.cos(azimuth),
    ];
    const at = (distance: number, aim: Vec3): SceneCamera => ({
      position: [
        aim[0] + direction[0] * distance,
        aim[1] + direction[1] * distance,
        aim[2] + direction[2] * distance,
      ],
      target: aim,
      fov,
    });
    // The closest distance that still fits: fit is monotonic in distance.
    const closest = (aim: Vec3): SceneCamera => {
      let near = 0.5;
      let far = 4000;
      for (let step = 0; step < 40; step += 1) {
        const mid = (near + far) / 2;
        if (fits(points, at(mid, aim))) far = mid;
        else near = mid;
      }
      return at(far, aim);
    };
    let camera = closest(target);
    // Perspective pushes the subject off centre; slide the aim so the margins
    // match, then fit again. Two passes settle within a pixel.
    if (!aimed) {
      for (let pass = 0; pass < 2; pass += 1) {
        const box = screenBounds(points, camera);
        if (box === null) break;
        const depth = Math.hypot(
          camera.position[0] - camera.target[0],
          camera.position[1] - camera.target[1],
          camera.position[2] - camera.target[2],
        );
        const f = H / 2 / Math.tan((fov * DEG) / 2);
        const shiftX = (((box.minX + box.maxX) / 2 - W / 2) * depth) / f;
        const shiftY = (-((box.minY + box.maxY) / 2 - H / 2) * depth) / f;
        const forward = normalize([-direction[0], -direction[1], -direction[2]]);
        const right = normalize(cross(forward, [0, 1, 0]));
        const up = cross(right, forward);
        const aim: Vec3 = [0, 1, 2].map(
          (axis) =>
            (camera.target[axis] as number) +
            (right[axis] as number) * shiftX +
            (up[axis] as number) * shiftY,
        ) as Vec3;
        camera = closest(aim);
      }
    }
    const score = Math.round(overlap(pickable, camera));
    if (best === undefined || score < best.score) best = { camera, score };
  }
  const chosen = (best as { camera: SceneCamera }).camera;
  return {
    position: chosen.position.map((n) => round(n)) as Vec3,
    target: chosen.target.map((n) => round(n)) as Vec3,
    fov,
  };
}
