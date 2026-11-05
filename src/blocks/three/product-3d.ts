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
import { checkScene, MATERIALS, objectSchema, objectsOf, TONES, vec3 } from './scene-ir.js';

export const MAX_PARTS = 64;
export const MAX_VARIANTS = 12;
export const MAX_HOTSPOTS = 24;
/** Theme tones plus the darker and lighter of the page's ink and paper, for neutral finishes. */
export const FINISH_TONES = [...TONES, 'dark', 'light'] as const;
/** How far the camera stands from a hotspot, as a share of the home distance. */
const CLOSE_UP = 0.74;
/** How much a hotspot close-up turns from the home view toward the hotspot's own side. */
const TURN = 0.45;
const DEG = Math.PI / 180;

const statePath = (description: string) =>
  str({ maxLength: 128, description: `${description} A state path such as \`state.part\`.` });

const finishTone = (description: string) => enumStr(FINISH_TONES, { description });

/** A scene object plus the offset it moves by in the exploded view. */
function partSchema(): PropSchema {
  const base = objectSchema() as PropSchema & { fields: Record<string, PropSchema> };
  return obj({
    ...base.fields,
    label: str({
      maxLength: 200,
      description: 'Part name; optional, since hotspots carry the reader-facing names.',
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

/** Half extents of a part along its own axes, after its scale. */
function halfExtents(part: Row): Vec3 {
  const size = typeof part.size === 'number' ? part.size : 1;
  const s = vec(part.scale, [1, 1, 1]);
  const shape = part.shape;
  // A capsule is half as wide as it is tall; a torus is flat on its local z.
  const k: Vec3 =
    shape === 'capsule'
      ? [0.25, 0.5, 0.25]
      : shape === 'torus'
        ? [0.67, 0.67, 0.17]
        : [0.5, 0.5, 0.5];
  if (shape === 'plane') k[2] = 0;
  return [size * s[0] * k[0], size * s[1] * k[1], size * s[2] * k[2]];
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

/** The eight corners of each drawn part's own box, in world space; groups draw nothing. */
function partCorners(parts: readonly Row[]): { part: Row; corners: Vec3[] }[] {
  const placed = new Map(placeObjects(parts).map((p) => [p.id, p.world]));
  return parts
    .filter((part) => part.shape !== 'group')
    .map((part) => {
      const [hx, hy, hz] = halfExtents(part);
      const rotation = vec(part.rotation, [0, 0, 0]);
      const center = placed.get(String(part.id)) ?? [0, 0, 0];
      const corners: Vec3[] = [];
      for (const x of [-hx, hx])
        for (const y of [-hy, hy])
          for (const z of [-hz, hz]) corners.push(add(center, rotate([x, y, z], rotation)));
      return { part, corners };
    });
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
  const assembled = partCorners(parts).flatMap((entry) => entry.corners);
  const exploded = partCorners(explodedParts(raw)).flatMap((entry) => entry.corners);
  const camera = frameCamera(
    placeObjects(markers([...assembled, ...hotspots.map((h) => h.at)])),
    undefined,
  );
  const [lo, hi] = boundsOf(assembled);
  const center: Vec3 = scale(add(lo, hi), 0.5);
  const [elo, ehi] = boundsOf(exploded);
  // The exploded view stands back by how much the product's extent grows.
  const spread = Math.max(1, length(sub(ehi, elo)) / (length(sub(hi, lo)) || 1));
  const home = sub(camera.position, camera.target);
  const homeDir = unit(home);
  const distance = length(home);
  const views = hotspots.map((hotspot) => {
    const outward = sub(hotspot.at, center);
    const side = length(outward) > 1e-6 ? unit(outward) : homeDir;
    const blend = unit(add(scale(homeDir, 1 - TURN), scale(side, TURN)));
    // Keep a close-up above the floor and below the zenith.
    const dir = unit([blend[0], Math.min(0.8, Math.max(0.12, blend[1])), blend[2]]);
    return {
      id: hotspot.id,
      label: hotspot.label,
      description: hotspot.description,
      part: hotspot.part,
      at: rounded(hotspot.at),
      shift: rounded(hotspot.shift),
      normal: rounded(side),
      dir: rounded(dir),
    };
  });
  const explode: Row = {};
  for (const part of raw)
    if (Array.isArray(part.explode)) explode[String(part.id)] = vec(part.explode, [0, 0, 0]);
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
      spread: round(spread),
      closeUp: round(distance * CLOSE_UP),
      center: rounded(center),
      bounds: [rounded(lo), rounded(hi)],
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

/** The labelled plan: each part's projected outline, back to front, under numbered pins. */
export function productPoster(model: ProductModel, label: string): string {
  const { camera } = model;
  const boxes = partCorners(model.parts).map((entry) => ({
    ...entry,
    box: boundsOf(entry.corners),
  }));
  // A part wholly inside another (a battery in its cabinet) is not visible from outside.
  const inside = (a: [Vec3, Vec3], b: [Vec3, Vec3]) =>
    a !== b && ([0, 1, 2] as const).every((i) => a[0][i] >= b[0][i] && a[1][i] <= b[1][i]);
  const drawn = boxes
    .filter((entry) => !boxes.some((other) => inside(entry.box, other.box)))
    .map(({ part, corners }) => {
      const points = corners.map((c) => project(c, camera)).filter((p) => p !== null);
      if (points.length === 0) return null;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const depth = points.reduce((sum, p) => sum + p.depth, 0) / points.length;
      return {
        part,
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: Math.min(...ys),
        y1: Math.max(...ys),
        depth,
      };
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => b.depth - a.depth || String(a.part.id).localeCompare(String(b.part.id)));
  const shapes = drawn
    .map(({ part, x0, x1, y0, y1 }) => {
      const w = x1 - x0;
      const h = y1 - y0;
      const round = ['sphere', 'cylinder', 'torus', 'capsule', 'icosahedron', 'cone'].includes(
        String(part.shape),
      );
      const rx = round
        ? Math.min(w, h) / 2
        : part.shape === 'rounded-box'
          ? Math.min(w, h) * 0.18
          : 2;
      return `<rect class="ak-3d-mark ak-product-part" data-tone="${escapeAttribute(String(part.tone ?? 'accent'))}" x="${r1(x0)}" y="${r1(y0)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(rx)}"/>`;
    })
    .join('');
  // A soft contact shadow under the product's footprint.
  const xs = drawn.flatMap((d) => [d.x0, d.x1]);
  const ys = drawn.map((d) => d.y1);
  const shadow =
    xs.length > 0
      ? `<ellipse class="ak-product-shadow" cx="${r1((Math.min(...xs) + Math.max(...xs)) / 2)}" cy="${r1(Math.max(...ys))}" rx="${r1((Math.max(...xs) - Math.min(...xs)) * 0.55)}" ry="12"/>`
      : '';
  const pins = model.hotspots
    .map((hotspot, i) => {
      const at = project(hotspot.at, camera);
      if (at === null) return '';
      return `<g class="ak-product-pin"><circle cx="${r1(at.x)}" cy="${r1(at.y)}" r="11"/><text x="${r1(at.x)}" y="${r1(at.y + 4)}">${i + 1}</text></g>`;
    })
    .join('');
  return `<svg class="ak-3d-poster ak-product-poster" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet">${shadow}${shapes}${pins}</svg>`;
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
    summary:
      'Product 3D: parts, finish dropdown, numbered hotspots with camera moves, exploded view.',
    props: PRODUCT_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A drawn plan with numbered pins, the finish list and the hotspot list render without JS or WebGL; the finish dropdown and every hotspot and view control work by keyboard.',
  }),
  render: renderProduct,
  check: checkProduct,
};
