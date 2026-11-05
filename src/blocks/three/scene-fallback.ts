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
function project(p: Vec3, camera: SceneCamera): { x: number; y: number; depth: number } | null {
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

/** The camera a scene uses: authored, or framed to fit every object. */
export function frameCamera(
  objects: readonly PlacedObject[],
  authored: JsonValue | undefined,
): SceneCamera {
  const given =
    authored !== null && typeof authored === 'object' && !Array.isArray(authored) ? authored : {};
  const target = vec(given.target, [0, 0, 0]);
  let position = vec(given.position, [0, 0, 0]);
  if (!Array.isArray(given.position)) {
    const radius = Math.max(
      2,
      ...objects.map(
        (o) =>
          Math.hypot(o.world[0] - target[0], o.world[1] - target[1], o.world[2] - target[2]) +
          o.size * o.scale,
      ),
    );
    const distance = radius * 2.2;
    position = [
      round(target[0] + distance * 0.55),
      round(target[1] + distance * 0.45),
      round(target[2] + distance * 0.7),
    ];
  }
  return { position, target, fov: typeof given.fov === 'number' ? given.fov : 45 };
}
