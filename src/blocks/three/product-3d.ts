/**
 * Product 3D: a product assembled from typed parts under a studio light, with
 * finish variants, numbered hotspots that fly the camera to them, and an
 * exploded view. Without JS or WebGL, and in print, a drawn plan with the same
 * numbered pins, the hotspot list and the finish list carry the content.
 */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  idProp,
  LABEL,
  list,
  OPTIONAL_TITLE,
  obj,
  onProp,
  str,
  txt,
} from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import {
  frameCamera,
  placeObjects,
  project,
  type SceneCamera,
  type Vec3,
  vec,
} from './scene-fallback.js';
import { checkScene, MATERIALS, objectSchema, objectsOf, SHAPES, TONES, vec3 } from './scene-ir.js';

export const MAX_PARTS = 64;
export const MAX_VARIANTS = 12;
export const MAX_HOTSPOTS = 24;
/** Theme tones plus the darker and lighter of the page's ink and paper, for neutral finishes. */
export const FINISH_TONES = [...TONES, 'dark', 'light'] as const;
/**
 * Scene shapes a product is built from, plus a rounded box and a capsule (as tall as its size,
 * half as wide). Shapes that are never a product part are left out, and so is the invisible
 * group: every part is drawn, and `parent` can still hang one part off another.
 */
const NOT_PARTS: ReadonlySet<string> = new Set(['plane', 'torus-knot', 'icosahedron', 'group']);
export const PRODUCT_SHAPES = [
  ...SHAPES.filter((shape) => !NOT_PARTS.has(shape)),
  'rounded-box',
  'capsule',
] as const;
/** How much a hotspot close-up turns from the home view toward the hotspot's own side. */
const TURN = 0.45;
const DEG = Math.PI / 180;

const statePath = (description: string) =>
  str({ maxLength: 128, description: `${description} A state path such as \`state.part\`.` });

const finishTone = (description: string) => enumStr(FINISH_TONES, { description });

/** A scene object plus the offset it moves by in the exploded view. */
function partSchema(): PropSchema {
  const base = objectSchema() as PropSchema & { fields: Record<string, PropSchema> };
  // Hotspots carry the reader-facing notes, so a part keeps only an optional name.
  const { description: _description, ...fields } = base.fields;
  return obj({
    ...fields,
    label: str({ maxLength: 200, description: 'Part name; the plan shows it as a tooltip.' }),
    shape: enumStr(PRODUCT_SHAPES, {
      default: 'box',
      description: 'rounded-box and capsule suit product bodies and cells.',
    }),
    tone: finishTone('Color before any variant applies; `dark` and `light` are neutral finishes.'),
    explode: vec3(
      'Offset from the assembled position in the exploded view, parent space [x, y, z].',
    ),
  });
}

export const PRODUCT_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the product is, in words; the caption and the text alternative.',
  }),
  parts: list(partSchema(), {
    required: true,
    minItems: 1,
    maxItems: MAX_PARTS,
    description:
      'The product as nested primitives; `explode` sets each part apart in the exploded view.',
  }),
  variants: list(
    obj({
      id: { ...idProp('Variant id; `variantBind` reads and writes it.'), required: true },
      label: LABEL,
      finishes: list(
        obj({
          part: { kind: 'string', required: true, maxLength: 64, description: 'Part id.' },
          tone: finishTone('Color the part takes in this variant.'),
          material: enumStr(MATERIALS, { description: 'Surface the part takes in this variant.' }),
        }),
        {
          maxItems: MAX_PARTS,
          description: 'Parts this variant refinishes; others keep their own.',
        },
      ),
    }),
    {
      maxItems: MAX_VARIANTS,
      description: 'Finishes offered in the dropdown; the first is the default.',
    },
  ),
  hotspots: list(
    obj({
      id: {
        ...idProp('Hotspot id; `bind` receives it when the hotspot is chosen.'),
        required: true,
      },
      label: { ...LABEL, required: true },
      description: str({
        maxLength: 300,
        description: 'Shown when chosen and in the hotspot list.',
      }),
      part: {
        kind: 'string',
        required: true,
        maxLength: 64,
        description: 'Part the pin rides on.',
      },
      offset: vec3('Pin offset from the part centre, world units [x, y, z]; default the centre.'),
    }),
    { maxItems: MAX_HOTSPOTS, description: 'Numbered pins; choosing one flies the camera to it.' },
  ),
  bind: statePath('The chosen hotspot id is written here, and a state value chooses it.'),
  variantBind: statePath('The variant id is read from and written here.'),
  explodeBind: statePath(
    '`exploded` (or `true`) explodes the product; any other value assembles it.',
  ),
  on: onProp('Bindings fired with `{ value }` (the hotspot id) when a hotspot is chosen.'),
  ...anchorProps,
};

type Row = Record<string, JsonValue>;

function rows(node: IrNode, key: string): Row[] {
  const raw = node.props[key];
  return Array.isArray(raw) ? (raw.filter(isPlainObject) as Row[]) : [];
}

function stateValue(
  node: IrNode,
  prop: string,
  state: Record<string, JsonValue>,
): JsonValue | undefined {
  const path = stringProp(node, prop);
  return path.startsWith('state.') ? state[path.slice(6)] : undefined;
}

const round = (n: number) => Number(n.toFixed(4));
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));
const rounded = (a: Vec3): Vec3 => a.map(round) as Vec3;

export function isExploded(value: JsonValue | undefined): boolean {
  return value === true || value === 'exploded';
}

/** The active variant: the bound state's value when it names one, else the first. */
function activeVariant(node: IrNode, state: Record<string, JsonValue>): Row | undefined {
  const variants = rows(node, 'variants');
  const wanted = stateValue(node, 'variantBind', state);
  return variants.find((v) => v.id === wanted) ?? variants[0];
}

/** Parts with a variant's finishes applied: what the first frame and the plan show. */
function finishedParts(node: IrNode, variant: Row | undefined): Row[] {
  const finishes = new Map<string, Row>();
  if (variant !== undefined && Array.isArray(variant.finishes))
    for (const finish of variant.finishes.filter(isPlainObject) as Row[])
      finishes.set(String(finish.part), finish);
  return objectsOf(node, 'parts').map((part) => {
    const finish = finishes.get(String(part.id));
    const out: Row = {};
    for (const [key, value] of Object.entries(part)) if (key !== 'explode') out[key] = value;
    if (typeof finish?.tone === 'string') out.tone = finish.tone;
    if (typeof finish?.material === 'string') out.material = finish.material;
    return out;
  });
}

/** Parts moved to their exploded positions, for placing the exploded view at compile time. */
function explodedParts(parts: readonly Row[]): Row[] {
  return parts.map((part) => ({
    ...part,
    position: add(vec(part.position, [0, 0, 0]), vec(part.explode, [0, 0, 0])),
  }));
}

interface PlacedHotspot {
  id: string;
  label: string;
  description: string;
  part: string;
  /** Assembled world point and how far it moves when exploded. */
  at: Vec3;
  shift: Vec3;
}

function placeHotspots(node: IrNode): PlacedHotspot[] {
  const parts = objectsOf(node, 'parts');
  const assembled = new Map(placeObjects(parts).map((p) => [p.id, p.world]));
  const exploded = new Map(placeObjects(explodedParts(parts)).map((p) => [p.id, p.world]));
  return rows(node, 'hotspots').map((hotspot) => {
    const part = String(hotspot.part);
    const offset = vec(hotspot.offset, [0, 0, 0]);
    const base = assembled.get(part) ?? [0, 0, 0];
    return {
      id: String(hotspot.id),
      label: typeof hotspot.label === 'string' ? hotspot.label : String(hotspot.id),
      description: typeof hotspot.description === 'string' ? hotspot.description : '',
      part,
      at: add(base, offset),
      shift: sub(exploded.get(part) ?? base, base),
    };
  });
}

/** Unit-size sample points on a shape's surface, whose hull is the shape's outline from any side. */
function outline(shape: JsonValue | undefined): Vec3[] {
  const ring = (radius: number, y: number, n = 24): Vec3[] =>
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return [radius * Math.cos(t), y, radius * Math.sin(t)];
    });
  const ball = (radius: number, y: number): Vec3[] =>
    [-0.95, -0.7, -0.35, 0, 0.35, 0.7, 0.95].flatMap((s) =>
      ring(radius * Math.sqrt(1 - s * s), y + radius * s, 16),
    );
  if (shape === 'cylinder') return [...ring(0.5, -0.5), ...ring(0.5, 0.5)];
  if (shape === 'cone') return [...ring(0.5, -0.5), [0, 0.5, 0]];
  if (shape === 'sphere') return ball(0.5, 0);
  // A capsule is as tall as its size and half as wide.
  if (shape === 'capsule') return [...ball(0.25, -0.25), ...ball(0.25, 0.25)];
  // A torus lies in its local xy plane: the outer rim and the tube's top and bottom.
  if (shape === 'torus')
    return [...ring(0.667, 0), ...ring(0.5, 0.167), ...ring(0.5, -0.167)].map(
      ([x, y, z]) => [x, z, y] as Vec3,
    );
  const corners: Vec3[] = [];
  const depth = shape === 'plane' ? 0 : 0.5;
  for (const x of [-0.5, 0.5])
    for (const y of [-0.5, 0.5]) for (const z of [-depth, depth]) corners.push([x, y, z]);
  return corners;
}

/** Euler XYZ rotation in degrees, matching Three.js. */
function rotate(p: Vec3, r: Vec3): Vec3 {
  let [x, y, z] = p;
  const [a, b, c] = [r[0] * DEG, r[1] * DEG, r[2] * DEG];
  [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
  [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
  [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)];
  return [x, y, z];
}

interface PartShape {
  part: Row;
  center: Vec3;
  /** Surface sample points in world space. */
  corners: Vec3[];
  box: [Vec3, Vec3];
}

/** Each part's outline points and box in world space. */
function partCorners(parts: readonly Row[]): PartShape[] {
  const placed = new Map(placeObjects(parts).map((p) => [p.id, p.world]));
  return parts.map((part) => {
    const size = typeof part.size === 'number' ? part.size : 1;
    const s = vec(part.scale, [1, 1, 1]);
    const rotation = vec(part.rotation, [0, 0, 0]);
    const center = placed.get(String(part.id)) ?? [0, 0, 0];
    const corners = outline(part.shape).map(([x, y, z]) =>
      add(center, rotate([x * size * s[0], y * size * s[1], z * size * s[2]], rotation)),
    );
    return { part, center, corners, box: boundsOf(corners) };
  });
}

/** True when box a lies wholly inside box b: a part hidden within another. */
function within(a: [Vec3, Vec3], b: [Vec3, Vec3]): boolean {
  return (
    a !== b &&
    ([0, 1, 2] as const).every((i) => a[0][i] >= b[0][i] - 1e-6 && a[1][i] <= b[1][i] + 1e-6)
  );
}
/** Tiny marker objects at given points, for framing a camera on exact extents. */
const markers = (points: readonly Vec3[]): Row[] =>
  points.map((point, i) => ({ id: `__p${i}`, shape: 'sphere', size: 0.001, position: point }));

function boundsOf(points: readonly Vec3[]): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (const axis of [0, 1, 2] as const) {
      lo[axis] = Math.min(lo[axis], p[axis]);
      hi[axis] = Math.max(hi[axis], p[axis]);
    }
  return points.length
    ? [lo, hi]
    : [
        [-0.5, -0.5, -0.5],
        [0.5, 0.5, 0.5],
      ];
}

export interface ProductModel {
  parts: Row[];
  variant: Row | undefined;
  hotspots: PlacedHotspot[];
  camera: SceneCamera;
  config: Record<string, JsonValue>;
}

/** Everything the runtime mounts and the plan draws, resolved at compile time. */
export function productModel(node: IrNode, state: Record<string, JsonValue>): ProductModel {
  const variant = activeVariant(node, state);
  const parts = finishedParts(node, variant);
  const raw = objectsOf(node, 'parts');
  const hotspots = placeHotspots(node);
  const shapes = partCorners(parts);
  const boxes = new Map(shapes.map((shape) => [String(shape.part.id), shape.box]));
  const assembled = shapes.flatMap((entry) => entry.corners);
  const exploded = partCorners(explodedParts(raw)).flatMap((entry) => entry.corners);
  const camera = frameCamera(
    placeObjects(markers([...assembled, ...hotspots.map((h) => h.at)])),
    undefined,
  );
  const [lo, hi] = boundsOf(assembled);
  const center: Vec3 = scale(add(lo, hi), 0.5);
  const homeDir = unit(sub(camera.position, camera.target));
  const views = hotspots.map((hotspot) => {
    const outward = sub(hotspot.at, center);
    const side = length(outward) > 1e-6 ? unit(outward) : homeDir;
    const blend = unit(add(scale(homeDir, 1 - TURN), scale(side, TURN)));
    // Keep a close-up above the floor and below the zenith.
    const dir = unit([blend[0], Math.min(0.8, Math.max(0.12, blend[1])), blend[2]]);
    const box = boxes.get(hotspot.part) ?? [hotspot.at, hotspot.at];
    // A pin on a part sealed inside another reads as behind until the product comes apart.
    const inner = [...boxes.values()].some((other) => within(box, other));
    return {
      id: hotspot.id,
      label: hotspot.label,
      description: hotspot.description,
      part: hotspot.part,
      at: rounded(hotspot.at),
      shift: rounded(hotspot.shift),
      normal: rounded(side),
      dir: rounded(dir),
      box: [rounded(box[0]), rounded(box[1])],
      ...(inner ? { inner: true } : {}),
    };
  });
  const explode: Row = {};
  for (const part of raw)
    if (Array.isArray(part.explode)) explode[String(part.id)] = vec(part.explode, [0, 0, 0]);
  const [elo, ehi] = boundsOf(exploded);
  const config: Record<string, JsonValue> = {
    objects: parts,
    camera: { position: camera.position, target: camera.target, fov: camera.fov },
    lighting: 'studio',
    product: {
      variants: rows(node, 'variants').map((v) => ({
        id: String(v.id),
        finishes: Array.isArray(v.finishes)
          ? (v.finishes.filter(isPlainObject) as Row[]).map((f) => ({
              part: String(f.part),
              ...(typeof f.tone === 'string' ? { tone: f.tone } : {}),
              ...(typeof f.material === 'string' ? { material: f.material } : {}),
            }))
          : [],
      })),
      ...(variant === undefined ? {} : { variant: String(variant.id) }),
      hotspots: views,
      explode,
      exploded: isExploded(stateValue(node, 'explodeBind', state)),
      center: rounded(center),
      bounds: [rounded(lo), rounded(hi)],
      explodedBounds: [rounded(elo), rounded(ehi)],
      ...Object.fromEntries(
        (['bind', 'variantBind', 'explodeBind'] as const)
          .filter((key) => typeof node.props[key] === 'string')
          .map((key) => [key, node.props[key] as string]),
      ),
    },
  };
  return { parts, variant, hotspots, camera, config };
}

const W = 640;
const H = 360;
const r1 = (n: number) => Math.round(n * 10) / 10;

interface Point {
  x: number;
  y: number;
}

/** Convex hull of screen points (monotone chain); deterministic. */
function hull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const chain = (list: typeof sorted) => {
    const out: typeof sorted = [];
    for (const p of list) {
      while (out.length >= 2) {
        const [o, a] = out.slice(-2) as [Point, Point];
        if (cross(o, a, p) > 0) break;
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...chain(sorted), ...chain([...sorted].reverse())];
}

/**
 * True when box a draws before box b, seen from `eye`. A plane between the boxes settles it: the
 * box on the eye's side is in front. Boxes that interpenetrate (a dust cap seated in its cone)
 * use the axis they overlap least on, which is the one they are stacked along. Centre depth
 * alone gets this wrong: from above, a low woofer is farther than the taller baffle behind it.
 */
function drawsBefore(a: [Vec3, Vec3], b: [Vec3, Vec3], eye: Vec3): boolean {
  let axis: 0 | 1 | 2 = 0;
  let least = Infinity;
  for (const i of [0, 1, 2] as const) {
    const overlap = Math.min(a[1][i], b[1][i]) - Math.max(a[0][i], b[0][i]);
    if (overlap < least) {
      least = overlap;
      axis = i;
    }
  }
  const ca = (a[0][axis] + a[1][axis]) / 2;
  const cb = (b[0][axis] + b[1][axis]) / 2;
  if (ca === cb) return false;
  const up = cb > ca;
  const plane =
    least <= 0 ? (up ? a[1][axis] + b[0][axis] : b[1][axis] + a[0][axis]) / 2 : (ca + cb) / 2;
  return up ? eye[axis] > plane : eye[axis] < plane;
}

interface Drawn {
  part: Row;
  outline: Point[];
  box: [Vec3, Vec3];
  depth: number;
}

/**
 * Painter's order: a part draws after every overlapping part it is in front of. Ties and the rare
 * cycle fall back to centre depth, then id, so the plan is the same on every compile.
 */
function paintOrder(items: Drawn[], eye: Vec3): Drawn[] {
  const rect = (d: Drawn) => {
    const xs = d.outline.map((p) => p.x);
    const ys = d.outline.map((p) => p.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
  };
  const rects = items.map(rect);
  const before = items.map(() => new Set<number>());
  for (let i = 0; i < items.length; i += 1)
    for (let j = i + 1; j < items.length; j += 1) {
      const [a, b] = [rects[i], rects[j]];
      if (!a || !b || a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
      const [first, then] = drawsBefore((items[i] as Drawn).box, (items[j] as Drawn).box, eye)
        ? [i, j]
        : [j, i];
      before[then]?.add(first);
    }
  const rank = (i: number, j: number) => {
    const [a, b] = [items[i] as Drawn, items[j] as Drawn];
    // Code-unit order, not locale order, so every host sorts ids the same way.
    const [x, y] = [String(a.part.id), String(b.part.id)];
    return b.depth - a.depth || (x < y ? -1 : x > y ? 1 : 0);
  };
  const left = new Set(items.map((_, i) => i));
  const out: Drawn[] = [];
  while (left.size > 0) {
    const pool = [...left];
    const ready = pool.filter((i) => [...(before[i] ?? [])].every((j) => !left.has(j)));
    const next = (ready.length > 0 ? ready : pool).sort(rank)[0] as number;
    left.delete(next);
    out.push(items[next] as Drawn);
  }
  return out;
}

/** The plan: each visible part's projected silhouette, back to front, under numbered pins. */
export function productPoster(model: ProductModel, label: string): string {
  const { camera } = model;
  const shapes = partCorners(model.parts);
  // A part wholly inside another (a battery in its cabinet) is not visible from outside.
  const sealed = new Set(
    shapes
      .filter((entry) => shapes.some((other) => within(entry.box, other.box)))
      .map((entry) => String(entry.part.id)),
  );
  const drawn = paintOrder(
    shapes
      .filter((entry) => !sealed.has(String(entry.part.id)))
      .flatMap(({ part, center, corners, box }) => {
        const points = corners.map((c) => project(c, camera)).filter((p) => p !== null);
        const middle = project(center, camera);
        if (points.length === 0 || middle === null) return [];
        return [{ part, outline: hull(points), box, depth: middle.depth }];
      }),
    camera.position,
  );
  const marks = drawn
    .map(({ part, outline: points }) => {
      const name = typeof part.label === 'string' ? `<title>${escapeText(part.label)}</title>` : '';
      return `<polygon class="ak-3d-mark ak-product-part" data-tone="${escapeAttribute(String(part.tone ?? 'accent'))}" points="${points
        .map((p) => `${r1(p.x)},${r1(p.y)}`)
        .join(' ')}">${name}</polygon>`;
    })
    .join('');
  // A soft contact shadow under the product's footprint.
  const xs = drawn.flatMap((d) => d.outline.map((p) => p.x));
  const ys = drawn.flatMap((d) => d.outline.map((p) => p.y));
  const shadow =
    xs.length > 0
      ? `<ellipse class="ak-product-shadow" cx="${r1((Math.min(...xs) + Math.max(...xs)) / 2)}" cy="${r1(Math.max(...ys))}" rx="${r1((Math.max(...xs) - Math.min(...xs)) * 0.55)}" ry="12"/>`
      : '';
  const pins = model.hotspots
    .map((hotspot, i) => {
      const at = project(hotspot.at, camera);
      if (at === null) return '';
      // A sealed part's pin is hollow: it marks where the part sits, not a surface you can see.
      const inner = sealed.has(hotspot.part) ? ' data-ak-inner=""' : '';
      return `<g class="ak-product-pin"${inner}><circle cx="${r1(at.x)}" cy="${r1(at.y)}" r="11"/><text x="${r1(at.x)}" y="${r1(at.y + 4)}">${i + 1}</text></g>`;
    })
    .join('');
  return `<svg class="ak-3d-poster ak-product-poster" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet">${shadow}${marks}${pins}</svg>`;
}
function variantControl(node: IrNode, current: string): string {
  const variants = rows(node, 'variants');
  if (variants.length === 0) return '';
  const options = variants
    .map((v) => {
      const id = String(v.id);
      return `<option value="${escapeAttribute(id)}"${id === current ? ' selected' : ''}>${escapeText(
        typeof v.label === 'string' ? v.label : id,
      )}</option>`;
    })
    .join('');
  return `<label class="ak-3d-control ak-product-variant"><span class="ak-3d-control-label">Finish</span><select disabled data-ak-product-variant>${options}</select></label>`;
}

function finishList(node: IrNode, current: string): string {
  const variants = rows(node, 'variants');
  if (variants.length === 0) return '';
  const items = variants
    .map((v) => {
      const id = String(v.id);
      const name = escapeText(typeof v.label === 'string' ? v.label : id);
      return `<li${id === current ? ' aria-current="true"' : ''}>${name}</li>`;
    })
    .join('');
  return `<div class="ak-product-finishes"><span class="ak-3d-control-label">Finishes</span><ul>${items}</ul></div>`;
}

function hotspotList(hotspots: readonly PlacedHotspot[], selected: string): string {
  const items = hotspots
    .map((hotspot, index) => {
      const description =
        hotspot.description === ''
          ? ''
          : `<span class="ak-3d-note">${escapeText(hotspot.description)}</span>`;
      return `<li><button type="button" disabled data-ak-product-hotspot="${escapeAttribute(hotspot.id)}" aria-pressed="${
        hotspot.id === selected ? 'true' : 'false'
      }"><span class="ak-3d-name"><span class="ak-3d-num" aria-hidden="true">${index + 1}</span>${escapeText(
        hotspot.label,
      )}</span>${description}</button></li>`;
    })
    .join('');
  return items === '' ? '' : `<ol class="ak-3d-objects ak-3d-hotspots">${items}</ol>`;
}

export function renderProduct(node: IrNode, context: RenderContext): string {
  const state = context.ir.state;
  const model = productModel(node, state);
  const summary = stringProp(node, 'summary');
  const selected = stateValue(node, 'bind', state);
  const variant = model.variant === undefined ? '' : String(model.variant.id);
  const exploded = isExploded(stateValue(node, 'explodeBind', state));
  const controls = [
    variantControl(node, variant),
    `<div class="ak-3d-control" role="group" aria-label="View"><button type="button" disabled data-ak-product-explode aria-pressed="${exploded}">Exploded view</button><button type="button" disabled data-ak-product-reset>Reset view</button></div>`,
  ].join('');
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-product',
      'data-ak-3d': 'product',
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(model.config),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-controls">${controls}</div>`,
      `<div class="ak-3d-stage">${productPoster(model, summary)}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}</figcaption>`,
      finishList(node, variant),
      hotspotList(model.hotspots, typeof selected === 'string' ? selected : ''),
    ].join(''),
  );
}

/** Part tree as for a scene, then unique variant and hotspot ids and every part reference. */
export function checkProduct(node: IrNode, context: CheckContext): void {
  checkScene(node, context, 'parts');
  const report = (path: string, message: string) =>
    context.bag.add({ code: 'SPEC_VALIDATION_ERROR', path, nodeId: node.id, message });
  const parts = new Set(objectsOf(node, 'parts').map((part) => String(part.id)));
  for (const key of ['variants', 'hotspots']) {
    const seen = new Set<string>();
    rows(node, key).forEach((entry, i) => {
      const path = pathIndex(pathKey(node.path, key), i);
      const id = String(entry.id);
      if (seen.has(id)) report(pathKey(path, 'id'), `id "${id}" is used twice`);
      seen.add(id);
      if (key === 'hotspots' && !parts.has(String(entry.part)))
        report(pathKey(path, 'part'), `"${String(entry.part)}" is not a part id`);
      if (key === 'variants' && Array.isArray(entry.finishes))
        entry.finishes.forEach((finish, f) => {
          if (isPlainObject(finish) && !parts.has(String(finish.part)))
            report(
              pathKey(pathIndex(pathKey(path, 'finishes'), f), 'part'),
              `"${String(finish.part)}" is not a part id`,
            );
        });
    });
  }
}

export const product3dBlock: BlockModule = {
  definition: define({
    type: 'product-3d',
    category: 'media',
    tags: ['3d', 'webgl', 'product', 'hotspots', 'interactive'],
    useCases: ['showcase a product with finishes', 'explain parts with an exploded view'],
    purpose: 'Studio-lit product from typed parts: finish variants, hotspots and an exploded view.',
    summary: 'Product: finishes, hotspots, exploded view.',
    props: PRODUCT_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A drawn plan with numbered pins, the finish list and the hotspot list render without JS or WebGL; the finish dropdown and every hotspot and view control work by keyboard.',
  }),
  render: renderProduct,
  check: checkProduct,
};
