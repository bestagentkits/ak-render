/**
 * Terrain 3D: a heightmap block (from rows of elevations or a seeded relief)
 * with scaled elevation, contour lines, a colour ramp, numbered annotations
 * and a camera flyover. Without JS or WebGL, and in print, a shaded drawing of
 * the same block under the live camera, the elevation legend and the
 * annotation list with each place's elevation carry the content.
 */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import {
  anchorProps,
  bool,
  define,
  enumStr,
  idProp,
  list,
  num,
  OPTIONAL_TITLE,
  obj,
  onProp,
  str,
  txt,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { project, type SceneCamera, type Vec3 } from './scene-fallback.js';
import { TONES } from './scene-ir.js';
import {
  BASE,
  blockCorners,
  cellSegments,
  contourLevels,
  DEFAULT_RESOLUTION,
  encodeHeights,
  FEATURE_KINDS,
  type Feature,
  type Field,
  FOV,
  fieldFromRows,
  fitCamera,
  formatElevation,
  HOME_BEARING,
  isIndexLevel,
  type Layout,
  MAX_FEATURES,
  MAX_MARKS,
  MAX_SIDE,
  MIN_SIDE,
  niceInterval,
  normalize,
  RAMP_NAMES,
  RAMPS,
  type RampName,
  type Rgb,
  rampColor,
  reliefField,
  sample,
  terrainLayout,
  toHex,
  worldPoint,
} from './terrain-field.js';

const pair = (description: string, required = false) =>
  list(num({ min: 0, max: 1 }), { required, minItems: 2, maxItems: 2, description });

export const TERRAIN_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the ground shows, in words; the caption and the text alternative.',
  }),
  heights: list(list(num({ min: -1e6, max: 1e6 }), { minItems: MIN_SIDE, maxItems: MAX_SIDE }), {
    minItems: MIN_SIDE,
    maxItems: MAX_SIDE,
    description: `Elevations in \`unit\`, rows north to south, each west to east, up to ${MAX_SIDE} x ${MAX_SIDE}. Give this or \`relief\`.`,
  }),
  relief: obj(
    {
      seed: num({
        integer: true,
        min: 0,
        max: 2147483647,
        default: 1,
        description: 'Same seed, same ground.',
      }),
      resolution: num({
        integer: true,
        min: 16,
        max: MAX_SIDE,
        default: DEFAULT_RESOLUTION,
        description: 'Samples per side of the generated heightmap.',
      }),
      roughness: num({
        min: 0,
        max: 1,
        default: 0.5,
        description: 'How broken the ground between features is.',
      }),
      range: list(num({ min: -1e6, max: 1e6 }), {
        minItems: 2,
        maxItems: 2,
        description: 'Lowest and highest elevation in `unit`; default [0, 1000].',
      }),
      features: list(
        obj({
          kind: enumStr(FEATURE_KINDS, { required: true, description: 'Landform.' }),
          at: pair('[x, y] in 0-1, west to east and north to south.', true),
          to: pair('Where a ridge or valley ends.'),
          radius: num({
            min: 0.02,
            max: 1,
            default: 0.18,
            description: 'Size as a share of the block.',
          }),
          height: num({ min: 0, max: 2, default: 1, description: 'Relative strength.' }),
        }),
        { maxItems: MAX_FEATURES, description: 'Landforms laid over seeded noise.' },
      ),
    },
    { description: 'A seeded, generated heightmap instead of `heights`.' },
  ),
  unit: str({
    maxLength: 12,
    default: 'm',
    description: 'Elevation unit, shown in the legend and list.',
  }),
  width: num({
    min: 0.000001,
    max: 1e9,
    description:
      'Real west-to-east width in `unit`; the relief is then drawn to scale times `exaggeration`.',
  }),
  exaggeration: num({
    min: 0.1,
    max: 100,
    description: 'Vertical exaggeration; the compiler picks one when omitted.',
  }),
  contours: num({
    min: 0,
    max: 1e6,
    description: 'Contour interval in `unit`; omitted picks a round one, 0 hides contours.',
  }),
  ramp: enumStr(RAMP_NAMES, {
    default: 'terrain',
    description: 'Colour ramp from low to high ground.',
  }),
  annotations: list(
    obj({
      id: { ...idProp('Annotation id; `bind` reads and writes it.'), required: true },
      label: str({ required: true, maxLength: 80, description: 'Place name.' }),
      at: pair('[x, y] in 0-1, west to east and north to south.', true),
      description: str({ maxLength: 200, description: 'Shown in the list.' }),
      tone: enumStr(TONES, { description: 'Theme tone of the pin.' }),
    }),
    { maxItems: MAX_MARKS, description: 'Numbered places; the flyover visits them in order.' },
  ),
  flyover: bool({
    default: true,
    description:
      'A slow camera tour over the annotations (or around the block) with a Pause button.',
  }),
  bind: str({
    maxLength: 128,
    description:
      'A state path such as `state.place`: the chosen annotation id is written here, and a state value flies to it.',
  }),
  on: onProp(
    'Bindings fired with `{ value }` (the annotation id) when the reader chooses a place.',
  ),
  ...anchorProps,
};

type Row = Record<string, JsonValue>;

const rowsOf = (value: JsonValue | undefined): Row[] =>
  Array.isArray(value) ? (value.filter(isPlainObject) as Row[]) : [];
const numOr = (value: JsonValue | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const pairOf = (value: JsonValue | undefined): [number, number] | undefined =>
  Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number')
    ? [value[0] as number, value[1] as number]
    : undefined;

export interface TerrainMark {
  id: string;
  label: string;
  u: number;
  v: number;
  description: string;
  tone: string;
  elevation: number;
}

export interface TerrainModel {
  field: Field;
  layout: Layout;
  unit: string;
  ramp: RampName;
  /** Contour interval in `unit`; 0 when contours are off. */
  interval: number;
  levels: number[];
  marks: TerrainMark[];
  camera: SceneCamera;
}

/** The heightmap: valid rows of elevations, else the seeded relief, else a flat default relief. */
export function terrainField(node: IrNode): Field {
  const raw = node.props.heights;
  if (Array.isArray(raw) && raw.length >= MIN_SIDE) {
    const rows = raw.filter(Array.isArray) as number[][];
    const cols = rows[0]?.length ?? 0;
    if (rows.length === raw.length && cols >= MIN_SIDE && rows.every((r) => r.length === cols))
      return fieldFromRows(rows);
  }
  const relief = isPlainObject(node.props.relief) ? (node.props.relief as Row) : {};
  const features: Feature[] = rowsOf(relief.features).map((f) => {
    const to = pairOf(f.to);
    return {
      kind: typeof f.kind === 'string' ? f.kind : 'peak',
      at: pairOf(f.at) ?? [0.5, 0.5],
      ...(to ? { to } : {}),
      radius: numOr(f.radius, 0.18),
      height: numOr(f.height, 1),
    };
  });
  const range = pairOf(relief.range) ?? [0, 1000];
  return reliefField({
    seed: numOr(relief.seed, 1),
    resolution: numOr(relief.resolution, DEFAULT_RESOLUTION),
    roughness: numOr(relief.roughness, 0.5),
    features,
    range: range[1] > range[0] ? range : [0, 1000],
  });
}

export function terrainModel(node: IrNode): TerrainModel {
  const field = terrainField(node);
  const width = typeof node.props.width === 'number' ? node.props.width : undefined;
  const exag = typeof node.props.exaggeration === 'number' ? node.props.exaggeration : undefined;
  const layout = terrainLayout(field, width, exag);
  const span = field.max - field.min;
  const interval =
    typeof node.props.contours === 'number' ? node.props.contours : niceInterval(span);
  const levels = interval > 0 ? contourLevels(field.min, field.max, interval) : [];
  const marks = rowsOf(node.props.annotations).map((row) => {
    const [u, v] = pairOf(row.at) ?? [0.5, 0.5];
    return {
      id: String(row.id),
      label: typeof row.label === 'string' ? row.label : String(row.id),
      u,
      v,
      description: typeof row.description === 'string' ? row.description : '',
      tone: typeof row.tone === 'string' ? row.tone : 'accent',
      elevation: sample(field, u, v),
    };
  });
  const top = BASE + span * layout.vscale;
  const fit = fitCamera(blockCorners(layout, top), HOME_BEARING, 16 / 9);
  const ramp = (RAMP_NAMES as readonly string[]).includes(String(node.props.ramp))
    ? (node.props.ramp as RampName)
    : 'terrain';
  const unit = typeof node.props.unit === 'string' ? node.props.unit : 'm';
  return {
    field,
    layout,
    unit,
    ramp,
    interval: levels.length > 0 ? interval : 0,
    levels,
    marks,
    camera: { position: fit.position, target: fit.target, fov: FOV },
  };
}

/** Everything the runtime mounts, resolved at compile time. */
export function terrainConfig(
  node: IrNode,
  model: TerrainModel,
  state: Row,
): Record<string, JsonValue> {
  const { field, layout, camera } = model;
  const bind = stringProp(node, 'bind');
  const bound = bind.startsWith('state.') ? state[bind.slice(6)] : undefined;
  return {
    camera: { position: camera.position, target: camera.target, fov: camera.fov },
    lighting: 'studio',
    objects: [],
    terrain: {
      cols: field.cols,
      rows: field.rows,
      min: field.min,
      max: field.max,
      heights: encodeHeights(field),
      extent: layout.extent,
      vscale: layout.vscale,
      base: BASE,
      ramp: model.ramp,
      interval: model.interval,
      marks: model.marks.map((m) => ({
        id: m.id,
        label: m.label,
        at: [m.u, m.v],
        elevation: formatElevation(m.elevation, model.unit),
        tone: m.tone,
      })),
      flyover: node.props.flyover !== false,
      ...(typeof bound === 'string' && model.marks.some((m) => m.id === bound)
        ? { selected: bound }
        : {}),
      ...(bind === '' ? {} : { bind }),
    },
  };
}

// ---- Drawing --------------------------------------------------------------------------------

const W = 640;
const H = 360;
/** Cells along the drawing's longer side; enough for the shape of the ground to read. */
const POSTER_CELLS = 60;
/** Height of a pin's head above its ground point, in world units. */
export const PIN_LIFT = 0.36;
/** The studio rig's key and fill light, as the live scene lights the block. */
const KEY = normalize([5, 8, 6]);
const FILL = normalize([-6, 3, 4]);
const r1 = (n: number) => Math.round(n * 10) / 10;

const scale = ([r, g, b]: Rgb, k: number): Rgb => [r * k, g * k, b * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function lit(n: Vec3): number {
  return 0.34 + 0.62 * Math.max(0, dot(n, KEY)) + 0.16 * Math.max(0, dot(n, FILL));
}

/** The wall colour: the ramp's low end blended toward soil, at brightness `k`. */
function wallColor(ramp: RampName, k: number): string {
  const low = rampColor(ramp, 0.02);
  const soil: Rgb = [0.45, 0.36, 0.28];
  return toHex(scale([(low[0] + soil[0]) / 2, (low[1] + soil[1]) / 2, (low[2] + soil[2]) / 2], k));
}

/**
 * The block as the live view first shows it: shaded ground cells in painter's order, each with
 * its contour runs, the two walls that face the camera, and numbered pins on stems.
 */
export function terrainPoster(model: TerrainModel, label: string, uid: string): string {
  const { field, layout, camera, ramp } = model;
  const span = field.max - field.min || 1;
  const across = layout.extent[0] >= layout.extent[1];
  const cu = across
    ? POSTER_CELLS
    : Math.max(1, Math.round((POSTER_CELLS * layout.extent[0]) / layout.extent[1]));
  const cv = across
    ? Math.max(1, Math.round((POSTER_CELLS * layout.extent[1]) / layout.extent[0]))
    : POSTER_CELLS;
  const nu = Math.min(cu, field.cols - 1);
  const nv = Math.min(cv, field.rows - 1);
  // Each drawn point averages the field samples around it, so fine relief does not alias.
  const reach = Math.floor(Math.max((field.cols - 1) / nu, (field.rows - 1) / nv) / 2);
  const heights: number[] = [];
  for (let r = 0; r <= nv; r += 1)
    for (let c = 0; c <= nu; c += 1) {
      const fc = Math.round((c / nu) * (field.cols - 1));
      const fr = Math.round((r / nv) * (field.rows - 1));
      let sum = 0;
      let count = 0;
      for (let y = Math.max(0, fr - reach); y <= Math.min(field.rows - 1, fr + reach); y += 1)
        for (let x = Math.max(0, fc - reach); x <= Math.min(field.cols - 1, fc + reach); x += 1) {
          sum += field.data[y * field.cols + x] as number;
          count += 1;
        }
      heights.push(reach === 0 ? sample(field, c / nu, r / nv) : sum / count);
    }
  const h = (c: number, r: number) => heights[r * (nu + 1) + c] as number;
  const world = (c: number, r: number) => worldPoint(layout, field.min, c / nu, r / nv, h(c, r));
  const eye = camera.position;
  const forward = normalize([
    camera.target[0] - eye[0],
    camera.target[1] - eye[1],
    camera.target[2] - eye[2],
  ]);
  const at = (p: Vec3) => project(p, camera);
  // Vertex normals by central differences, so cells shade smoothly instead of as facets.
  const normalAt = (c: number, r: number): Vec3 => {
    const [c0, c1] = [Math.max(0, c - 1), Math.min(nu, c + 1)];
    const [r0, r1_] = [Math.max(0, r - 1), Math.min(nv, r + 1)];
    const xa = world(c0, r);
    const xb = world(c1, r);
    const za = world(c, r0);
    const zb = world(c, r1_);
    const sx = (xb[1] - xa[1]) / (xb[0] - xa[0]);
    const sz = (zb[1] - za[1]) / (zb[2] - za[2]);
    return normalize([-sx, 1, -sz]);
  };
  const light: number[] = [];
  for (let r = 0; r <= nv; r += 1) for (let c = 0; c <= nu; c += 1) light.push(lit(normalAt(c, r)));
  const lightAt = (c: number, r: number) => light[r * (nu + 1) + c] as number;
  interface Cell {
    depth: number;
    path: string;
  }
  const cells: Cell[] = [];
  for (let r = 0; r < nv; r += 1) {
    for (let c = 0; c < nu; c += 1) {
      const a = world(c, r);
      const b = world(c + 1, r);
      const cc = world(c + 1, r + 1);
      const d = world(c, r + 1);
      const e1: Vec3 = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
      const e2: Vec3 = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
      const n = normalize([
        e2[1] * e1[2] - e2[2] * e1[1],
        e2[2] * e1[0] - e2[0] * e1[2],
        e2[0] * e1[1] - e2[1] * e1[0],
      ]);
      const center: Vec3 = [
        (a[0] + cc[0]) / 2,
        (a[1] + b[1] + cc[1] + d[1]) / 4,
        (a[2] + cc[2]) / 2,
      ];
      const view = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
      if (dot(n, view) <= 0) continue;
      const points = [a, b, cc, d].map(at);
      if (points.some((p) => p === null)) continue;
      const screen = points as { x: number; y: number }[];
      const mean = (h(c, r) + h(c + 1, r) + h(c + 1, r + 1) + h(c, r + 1)) / 4;
      const shade =
        (lightAt(c, r) + lightAt(c + 1, r) + lightAt(c + 1, r + 1) + lightAt(c, r + 1)) / 4;
      const fill = toHex(scale(rampColor(ramp, (mean - field.min) / span), shade));
      let path = `<path fill="${fill}" stroke="${fill}" d="M${screen
        .map((p) => `${r1(p.x)},${r1(p.y)}`)
        .join('L')}Z"/>`;
      // This cell's contour runs draw right after it, so nearer ground hides them as it should.
      const minor: string[] = [];
      const major: string[] = [];
      for (const level of model.levels) {
        const lo = Math.min(h(c, r), h(c + 1, r), h(c + 1, r + 1), h(c, r + 1));
        const hi = Math.max(h(c, r), h(c + 1, r), h(c + 1, r + 1), h(c, r + 1));
        if (level < lo || level > hi) continue;
        for (const s of cellSegments(h(c, r), h(c + 1, r), h(c + 1, r + 1), h(c, r + 1), level)) {
          const p0 = at(
            worldPoint(
              layout,
              field.min,
              (c + (s[0] as number)) / nu,
              (r + (s[1] as number)) / nv,
              level,
            ),
          );
          const p1 = at(
            worldPoint(
              layout,
              field.min,
              (c + (s[2] as number)) / nu,
              (r + (s[3] as number)) / nv,
              level,
            ),
          );
          if (!p0 || !p1) continue;
          (isIndexLevel(level, model.interval) ? major : minor).push(
            `M${r1(p0.x)},${r1(p0.y)}L${r1(p1.x)},${r1(p1.y)}`,
          );
        }
      }
      if (minor.length > 0) path += `<path class="ak-tr-c" d="${minor.join('')}"/>`;
      if (major.length > 0) path += `<path class="ak-tr-c ak-tr-ci" d="${major.join('')}"/>`;
      cells.push({
        depth: dot([center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]], forward),
        path,
      });
    }
  }
  cells.sort((x, y) => y.depth - x.depth);

  // The walls the camera sees: south or north, and east or west.
  const dir = normalize([eye[0] - camera.target[0], 0, eye[2] - camera.target[2]]);
  const walls: string[] = [];
  const gradients: string[] = [];
  const id = (part: string) => `ak-tr-${part}-${uid}`;
  const wall = (name: string, edge: [number, number][], shade: number) => {
    const top = edge.map(([c, r]) => at(world(c, r)));
    const first = edge[0] as [number, number];
    const last = edge[edge.length - 1] as [number, number];
    const foot = [last, first].map(([c, r]) => {
      const p = world(c, r);
      return at([p[0], 0, p[2]]);
    });
    const outline = [...top, ...foot];
    if (outline.some((p) => p === null)) return;
    const pts = (list: { x: number; y: number }[]) =>
      list.map((p) => `${r1(p.x)},${r1(p.y)}`).join('L');
    // Lit soil at the top falling to shade at the foot, under a thin rim of light.
    gradients.push(
      `<linearGradient id="${id(name)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${wallColor(
        ramp,
        shade * 1.25,
      )}"/><stop offset="1" stop-color="${wallColor(ramp, shade * 0.72)}"/></linearGradient>`,
    );
    walls.push(
      `<path fill="url(#${id(name)})" d="M${pts(outline as { x: number; y: number }[])}Z"/><path class="ak-tr-rim" d="M${pts(
        top as { x: number; y: number }[],
      )}"/>`,
    );
  };
  const south = dir[2] >= 0 ? nv : 0;
  const east = dir[0] >= 0 ? nu : 0;
  wall(
    'south',
    Array.from({ length: nu + 1 }, (_, c) => [c, south] as [number, number]),
    0.78,
  );
  wall(
    'east',
    Array.from({ length: nv + 1 }, (_, r) => [east, r] as [number, number]),
    0.56,
  );

  // A soft floor shadow under the block.
  const center = at([0, 0, 0]);
  const side = at([layout.extent[0] / 2, 0, layout.extent[1] / 2]);
  const shadow =
    center && side
      ? `<ellipse class="ak-tr-shadow" cx="${r1(center.x)}" cy="${r1(center.y + 6)}" rx="${r1(
          Math.abs(side.x - center.x) * 1.5 + 30,
        )}" ry="${r1(Math.abs(side.y - center.y) * 1.2 + 14)}" fill="url(#${id('floor')})"/>`
      : '';

  const pins = model.marks
    .map((mark, i) => {
      const ground = worldPoint(layout, field.min, mark.u, mark.v, mark.elevation);
      const foot = at(ground);
      const head = at([ground[0], ground[1] + PIN_LIFT, ground[2]]);
      if (!foot || !head) return '';
      return `<g class="ak-3d-mark ak-tr-pin" data-tone="${escapeAttribute(mark.tone)}"><path d="M${r1(foot.x)},${r1(
        foot.y,
      )}L${r1(head.x)},${r1(head.y)}"/><circle class="ak-tr-foot" cx="${r1(foot.x)}" cy="${r1(foot.y)}" r="2.5"/><circle cx="${r1(
        head.x,
      )}" cy="${r1(head.y)}" r="11"/><text x="${r1(head.x)}" y="${r1(head.y + 4)}">${i + 1}</text></g>`;
    })
    .join('');

  return `<svg class="ak-3d-poster ak-tr-poster" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet"><defs><radialGradient id="${id('floor')}"><stop offset="0" stop-opacity=".38"/><stop offset="1" stop-opacity="0"/></radialGradient>${gradients.join('')}</defs>${shadow}<g class="ak-tr-ground">${cells
    .map((cell) => cell.path)
    .join('')}${walls.join('')}</g>${pins}</svg>`;
}

/** The elevation legend: the ramp as a bar with round ticks, and the scale facts. */
function legend(model: TerrainModel, uid: string): string {
  const { field, unit, ramp, interval } = model;
  const span = field.max - field.min;
  const gradient = RAMPS[ramp]
    .map(([t, color]) => `<stop offset="${t}" stop-color="${color}"/>`)
    .join('');
  const step = span > 0 ? niceInterval(span, 4) : 0;
  const ticks = [
    field.min,
    ...(step > 0 ? contourLevels(field.min, field.max, step) : []),
    field.max,
  ];
  // Inner ticks that would crowd an end label give way to it.
  const placed = ticks.filter(
    (value, i) =>
      i === 0 ||
      i === ticks.length - 1 ||
      (span > 0 && (value - field.min) / span > 0.12 && (field.max - value) / span > 0.12),
  );
  const x = (value: number) => (span > 0 ? r1(8 + ((value - field.min) / span) * 304) : 8);
  const marks = placed
    .map((value, i) => {
      const anchor = i === 0 ? 'start' : i === placed.length - 1 ? 'end' : 'middle';
      const tx = i === 0 ? 8 : i === placed.length - 1 ? 312 : x(value);
      return `<line x1="${x(value)}" x2="${x(value)}" y1="18" y2="24"/><text x="${tx}" y="38" text-anchor="${anchor}">${escapeText(
        formatElevation(value, ''),
      )}</text>`;
    })
    .join('');
  const facts = [
    `Elevation ${formatElevation(field.min, unit)} to ${formatElevation(field.max, unit)}`,
    interval > 0
      ? `contours every ${formatElevation(interval, unit)}, heavier every ${formatElevation(interval * 5, unit)}`
      : 'no contours',
    model.layout.exaggeration !== null ? `vertical scale ×${model.layout.exaggeration}` : '',
    `${field.cols} × ${field.rows} samples`,
  ].filter((f) => f !== '');
  return `<div class="ak-tr-legend"><svg class="ak-tr-ramp" viewBox="0 0 320 44" role="img" aria-label="${escapeAttribute(
    `Colour scale, low to high: ${formatElevation(field.min, unit)} to ${formatElevation(field.max, unit)}`,
  )}"><defs><linearGradient id="ak-tr-ramp-${uid}">${gradient}</linearGradient></defs><rect x="8" y="4" width="304" height="14" rx="4" fill="url(#ak-tr-ramp-${uid})"/>${marks}</svg><p class="ak-tr-facts">${escapeText(facts.join(' · '))}</p></div>`;
}

function markList(model: TerrainModel, selected: string): string {
  if (model.marks.length === 0) return '';
  const items = model.marks
    .map((mark, i) => {
      const note =
        mark.description === ''
          ? ''
          : `<span class="ak-3d-note">${escapeText(mark.description)}</span>`;
      return `<li><button type="button" disabled data-ak-terrain-mark="${escapeAttribute(mark.id)}" aria-pressed="${
        mark.id === selected ? 'true' : 'false'
      }"><span class="ak-3d-name"><span class="ak-3d-num" data-tone="${escapeAttribute(mark.tone)}" aria-hidden="true">${
        i + 1
      }</span>${escapeText(mark.label)}<span class="ak-tr-elev">${escapeText(
        formatElevation(mark.elevation, model.unit),
      )}</span></span>${note}</button></li>`;
    })
    .join('');
  return `<ol class="ak-3d-objects ak-3d-hotspots ak-tr-marks" aria-label="Places">${items}</ol>`;
}

export function renderTerrain(node: IrNode, context: RenderContext): string {
  const model = terrainModel(node);
  const config = terrainConfig(node, model, context.ir.state);
  const summary = stringProp(node, 'summary');
  const uid = node.id.replace(/[^A-Za-z0-9_-]/gu, '-');
  const selected = String((config.terrain as Row).selected ?? '');
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-tr',
      'data-ak-3d': 'terrain',
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(config),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${terrainPoster(model, summary, uid)}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}</figcaption>`,
      legend(model, uid),
      markList(model, selected),
    ].join(''),
  );
}

/** One heightmap source, a rectangular grid, an ordered range, ends for lines, unique ids. */
export function checkTerrain(node: IrNode, { bag }: CheckContext): void {
  const report = (path: string, message: string) =>
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, nodeId: node.id, message });
  // Normalizing fills an omitted list with [] and an omitted object with {}.
  const heights =
    Array.isArray(node.props.heights) && node.props.heights.length > 0
      ? node.props.heights
      : undefined;
  const relief =
    isPlainObject(node.props.relief) && Object.keys(node.props.relief).length > 0
      ? node.props.relief
      : undefined;
  if (heights === undefined && relief === undefined)
    report(pathKey(node.path, 'heights'), 'give `heights` (rows of elevations) or a `relief`');
  if (heights !== undefined && relief !== undefined)
    report(pathKey(node.path, 'relief'), 'give `heights` or `relief`, not both');
  if (Array.isArray(heights)) {
    const cols = Array.isArray(heights[0]) ? heights[0].length : 0;
    heights.forEach((row, i) => {
      if (Array.isArray(row) && row.length !== cols)
        report(
          pathIndex(pathKey(node.path, 'heights'), i),
          `row ${i} has ${row.length} values and row 0 has ${cols}; every row needs the same count`,
        );
    });
  }
  if (isPlainObject(relief)) {
    const base = pathKey(node.path, 'relief');
    const range = pairOf((relief as Row).range);
    if (range && !(range[1] > range[0]))
      report(pathKey(base, 'range'), `range [${range[0]}, ${range[1]}] must run low to high`);
    rowsOf((relief as Row).features).forEach((f, i) => {
      if ((f.kind === 'ridge' || f.kind === 'valley') && pairOf(f.to) === undefined)
        report(
          pathIndex(pathKey(base, 'features'), i),
          `a ${String(f.kind)} needs \`to\`, where it ends`,
        );
    });
  }
  const seen = new Set<string>();
  rowsOf(node.props.annotations).forEach((row, i) => {
    const id = String(row.id);
    if (seen.has(id))
      report(
        pathKey(pathIndex(pathKey(node.path, 'annotations'), i), 'id'),
        `annotation id "${id}" is used twice`,
      );
    seen.add(id);
  });
}

export const terrain3dBlock: BlockModule = {
  definition: define({
    type: 'terrain-3d',
    category: 'media',
    tags: ['3d', 'webgl', 'terrain', 'map', 'elevation', 'interactive'],
    useCases: ['show a landscape or elevation model', 'tour places on a relief map'],
    purpose:
      'Heightmap terrain with scaled elevation, contours, a colour ramp, annotations and a flyover.',
    summary: 'Terrain: heightmap or relief, contours, ramp, places, flyover.',
    props: TERRAIN_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A shaded drawing of the block with numbered pins, the elevation legend and the place list with each elevation render without JS or WebGL and in print; reduced motion holds the camera still, a pause button stops the flyover, and every place button works by keyboard.',
  }),
  render: renderTerrain,
  check: checkTerrain,
};
