/**
 * Globe 3D: latitude/longitude markers and great-circle arcs on a dotted
 * Natural Earth globe with an atmosphere and a night side. Markers and arcs
 * sit on layers; a time step filters them; nearby markers cluster by zoom;
 * picking a marker writes page state and flies the camera to it. The compiler
 * resolves the camera, the sun, the clusters and every distance, and draws
 * the same view as a static SVG poster. Without JS or WebGL readers get that
 * poster plus a table of every place and every route.
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
import {
  arcPoints,
  type ClusterLevel,
  clusterMarkers,
  formatCoordinate,
  greatCircleKm,
  landDots,
  meanCenter,
  round2,
  toVec,
} from './globe-geo.js';
import { project, type SceneCamera, type Vec3 } from './scene-fallback.js';
import { TONES } from './scene-ir.js';
import { WORLD_LAND } from './world-land.generated.js';

export const MAX_MARKERS = 1000;
export const MAX_ARCS = 500;
const MAX_LAYERS = 12;
const FOV = 30;
/** Home distance from the globe centre, in globe radii: the globe and its glow fill the stage. */
export const HOME_DISTANCE = 4.6;
/**
 * Clustering levels by camera distance: at home markers within 7 degrees
 * merge, closer in within 2.5, and close up every marker stands alone. The
 * runtime scales the distance up on a small stage, which reaches the 14 degree
 * level, so bubbles keep their spacing on a phone.
 */
export const CLUSTER_LEVELS = [
  { radius: 14, from: 6 },
  { radius: 7, from: 3.4 },
  { radius: 2.5, from: 2.2 },
] as const;
/** Poster lattice size: enough dots that the continents read at 640 x 360. */
const POSTER_DOTS = 14000;
/** Markers with the largest values carry a text label on the poster. */
const POSTER_LABELS = 8;
const TIME = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/u;
/** Layers without a tone take these in order. */
// Warning comes last: some themes give it the accent's colour.
const TONE_CYCLE = ['accent', 'info', 'success', 'danger', 'neutral', 'warning'] as const;

const statePath = (description: string) =>
  str({ maxLength: 128, description: `${description} A state path such as \`state.city\`.` });
const timeProp = str({
  maxLength: 10,
  description: 'When it applies: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; the time filter reads it.',
});

export const GLOBE_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the globe shows, in words; the caption and the text alternative.',
  }),
  markers: list(
    obj({
      id: { ...idProp('Marker id; selection writes it to `bind`, arcs name it.'), required: true },
      label: str({ maxLength: 120, description: 'Place name; defaults to the id.' }),
      lat: num({ required: true, min: -90, max: 90, description: 'Latitude in degrees, north +.' }),
      lon: num({
        required: true,
        min: -180,
        max: 180,
        description: 'Longitude in degrees, east +.',
      }),
      value: num({ min: 0, max: 1e12, description: 'Magnitude; raises the marker as a spike.' }),
      layer: str({ maxLength: 64, description: 'Layer id from `layers`.' }),
      time: timeProp,
      description: str({ maxLength: 300, description: 'Read in the table and when selected.' }),
    }),
    { maxItems: 200, description: 'Places with details; `markerList` adds more tersely.' },
  ),
  markerList: {
    kind: 'text',
    maxLength: 60000,
    description:
      'Compact places, one per line: `id lat lon [layer] [value] [time] [label…]`, `-` skips a field. Adds to `markers`.',
  } as const,
  arcs: list(
    obj({
      from: str({ required: true, maxLength: 64, description: 'Start marker id.' }),
      to: str({ required: true, maxLength: 64, description: 'End marker id.' }),
      label: str({ maxLength: 120, description: 'Route name; defaults to `from – to`.' }),
      value: num({ min: 0, max: 1e12, description: 'Magnitude; thickens the arc.' }),
      layer: str({ maxLength: 64, description: 'Layer id from `layers`.' }),
      time: timeProp,
    }),
    { maxItems: 200, description: 'Great-circle routes between markers; `arcList` adds more.' },
  ),
  arcList: {
    kind: 'text',
    maxLength: 30000,
    description:
      'Compact routes, one per line: `from>to [layer] [value] [time] [label…]`, `-` skips a field. Adds to `arcs`.',
  } as const,
  layers: list(
    obj({
      id: { kind: 'string', required: true, maxLength: 64, description: 'Layer id items name.' },
      label: str({ maxLength: 120 }),
      tone: enumStr(TONES, { description: 'Theme color; omitted, layers cycle the palette.' }),
    }),
    { maxItems: MAX_LAYERS, description: 'Layers in legend order; each can be shown or hidden.' },
  ),
  center: list(num({ min: -180, max: 180 }), {
    minItems: 2,
    maxItems: 2,
    description: '`[lat, lon]` the camera faces at home; omitted, the middle of the markers.',
  }),
  cluster: bool({
    default: true,
    description: 'Merge nearby markers into counts when zoomed out.',
  }),
  valueLabel: str({ maxLength: 60, description: 'Column heading for `value`; default `Value`.' }),
  bind: statePath('Selection is written here; a marker id set here selects it.'),
  timeBind: statePath('A time read from here shows only items up to it; empty shows all.'),
  on: onProp('Bindings fired with `{ value }` (the marker id) when a marker is selected.'),
  ...anchorProps,
};

interface Marker {
  id: string;
  label: string;
  lat: number;
  lon: number;
  value: number | null;
  layer: number;
  time: string;
  description: string;
}
interface Arc {
  from: number;
  to: number;
  label: string;
  value: number | null;
  layer: number;
  time: string;
  km: number;
}
interface Prepared {
  markers: Marker[];
  arcs: Arc[];
  layers: { id: string; label: string; tone: string }[];
  times: string[];
  height: number[];
  width: number[];
  clusters: ClusterLevel[];
  center: [number, number];
  camera: SceneCamera;
  sun: Vec3;
  /** The time cutoff from page state when the page opens ('' shows everything). */
  cut: string;
}

/** Page state the globe opens with: the selected marker id and the time cutoff. */
export interface GlobeStart {
  selected?: string;
  time?: string;
}

function rows(node: IrNode, key: string): Record<string, JsonValue>[] {
  const raw = node.props[key];
  return Array.isArray(raw) ? (raw.filter(isPlainObject) as Record<string, JsonValue>[]) : [];
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const NUMBER = /^-?\d+(\.\d+)?$/u;

/** One compact line as a row plus what is wrong with it, if anything. */
interface Line {
  row: Record<string, JsonValue>;
  line: number;
  problem: string;
}

/** Splits `[layer] [value] [time] [label…]` after the leading fields; `-` leaves a field out. */
function tail(row: Record<string, JsonValue>, rest: string[]): string {
  const [layer, value, time, ...label] = rest;
  let problem = '';
  if (layer !== undefined && layer !== '-') row.layer = layer;
  if (value !== undefined && value !== '-') {
    if (NUMBER.test(value) && Number(value) >= 0) row.value = Number(value);
    else problem = `"${value}" is not a value of zero or more`;
  }
  if (time !== undefined && time !== '-') {
    row.time = time;
    if (!TIME.test(time)) problem ||= `"${time}" is not a date as YYYY, YYYY-MM or YYYY-MM-DD`;
  }
  if (label.length > 0) row.label = label.join(' ');
  return problem;
}

function lines(node: IrNode, key: string): string[] {
  const raw = node.props[key];
  return typeof raw === 'string' ? raw.split('\n') : [];
}

/** `markerList` lines parsed; a line with a problem is still listed so the check can name it. */
function markerLines(node: IrNode): Line[] {
  const out: Line[] = [];
  lines(node, 'markerList').forEach((text, i) => {
    const [id, lat, lon, ...rest] = text.trim().split(/\s+/u);
    if (id === undefined || id === '') return;
    const row: Record<string, JsonValue> = { id };
    let problem = '';
    if (!ID.test(id)) problem = `"${id}" is not a marker id (lowercase letters, digits, dashes)`;
    else if (!NUMBER.test(lat ?? '') || Math.abs(Number(lat)) > 90)
      problem = `latitude "${lat ?? ''}" must be a number from -90 to 90`;
    else if (!NUMBER.test(lon ?? '') || Math.abs(Number(lon)) > 180)
      problem = `longitude "${lon ?? ''}" must be a number from -180 to 180`;
    row.lat = Number(lat);
    row.lon = Number(lon);
    problem ||= tail(row, rest);
    out.push({ row, line: i + 1, problem });
  });
  return out;
}

function arcLines(node: IrNode): Line[] {
  const out: Line[] = [];
  lines(node, 'arcList').forEach((text, i) => {
    const [ends, ...rest] = text.trim().split(/\s+/u);
    if (ends === undefined || ends === '') return;
    const [from, to, extra] = ends.split('>');
    const row: Record<string, JsonValue> = { from: from ?? '', to: to ?? '' };
    const problem =
      !from || !to || extra !== undefined
        ? `"${ends}" is not a \`from>to\` route`
        : tail(row, rest);
    out.push({ row, line: i + 1, problem });
  });
  return out;
}

/** `markers` then the well-formed `markerList` lines. */
function markerRowsOf(node: IrNode): Record<string, JsonValue>[] {
  return [
    ...rows(node, 'markers'),
    ...markerLines(node).flatMap((l) => (l.problem ? [] : [l.row])),
  ];
}
function arcRowsOf(node: IrNode): Record<string, JsonValue>[] {
  return [...rows(node, 'arcs'), ...arcLines(node).flatMap((l) => (l.problem ? [] : [l.row]))];
}
const text = (value: JsonValue | undefined, fallback = '') =>
  typeof value === 'string' && value !== '' ? value : fallback;
const numOrNull = (value: JsonValue | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const timeOf = (value: JsonValue | undefined) =>
  typeof value === 'string' && TIME.test(value) ? value : '';

/** Item `time` is shown at cutoff `cut` when it is not later, compared at the cutoff's precision. */
export function shownAt(time: string, cut: string): boolean {
  return cut === '' || time === '' || time.slice(0, cut.length) <= cut;
}

/** Whether marker `i` shows at the opening time cutoff. */
const markerOn = (p: Prepared, i: number) => shownAt(p.markers[i]?.time ?? '', p.cut);
/** Whether an arc shows at the opening cutoff: its own time and both ends. */
const arcOn = (p: Prepared, a: Arc) =>
  shownAt(a.time, p.cut) && markerOn(p, a.from) && markerOn(p, a.to);

const cache = new WeakMap<IrNode, { key: string; prepared: Prepared }>();
const startKey = (start: GlobeStart) => `${start.selected ?? ''}|${start.time ?? ''}`;

function prepare(node: IrNode, start: GlobeStart = {}): Prepared {
  const hit = cache.get(node);
  if (hit && hit.key === startKey(start)) return hit.prepared;
  const layers: Prepared['layers'] = rows(node, 'layers').map((l, i) => ({
    id: text(l.id),
    label: text(l.label, text(l.id)),
    tone: typeof l.tone === 'string' ? l.tone : (TONE_CYCLE[i % TONE_CYCLE.length] as string),
  }));
  const layerIndex = new Map(layers.map((l, i) => [l.id, i]));
  const markers: Marker[] = [];
  const markerIndex = new Map<string, number>();
  for (const m of markerRowsOf(node)) {
    const id = text(m.id);
    if (markerIndex.has(id)) continue;
    markerIndex.set(id, markers.length);
    markers.push({
      id,
      label: text(m.label, id),
      lat: numOrNull(m.lat) ?? 0,
      lon: numOrNull(m.lon) ?? 0,
      value: numOrNull(m.value),
      layer: layerIndex.get(text(m.layer)) ?? -1,
      time: timeOf(m.time),
      description: text(m.description),
    });
  }
  const arcs: Arc[] = [];
  for (const a of arcRowsOf(node)) {
    const from = markerIndex.get(text(a.from));
    const to = markerIndex.get(text(a.to));
    if (from === undefined || to === undefined || from === to) continue;
    const p = markers[from] as Marker;
    const q = markers[to] as Marker;
    arcs.push({
      from,
      to,
      label: text(a.label, `${p.label} – ${q.label}`),
      value: numOrNull(a.value),
      layer: layerIndex.get(text(a.layer)) ?? -1,
      time: timeOf(a.time),
      km: Math.round(greatCircleKm([p.lat, p.lon], [q.lat, q.lon])),
    });
  }
  const times = [
    ...new Set([...markers.map((m) => m.time), ...arcs.map((a) => a.time)].filter(Boolean)),
  ].sort();
  // Spikes: square-root scale so a few large values do not flatten the rest.
  const maxValue = Math.max(0, ...markers.map((m) => m.value ?? 0));
  const height = markers.map((m) =>
    maxValue > 0 && m.value !== null ? round3(0.012 + 0.1 * Math.sqrt(m.value / maxValue)) : 0,
  );
  const maxArc = Math.max(0, ...arcs.map((a) => a.value ?? 0));
  const width = arcs.map((a) =>
    maxArc > 0 && a.value !== null ? round3(0.35 + 0.65 * Math.sqrt(a.value / maxArc)) : 0.6,
  );
  const points = markers.map((m) => [m.lat, m.lon] as [number, number]);
  const weights = markers.map((m) => m.value ?? 0);
  const clusters =
    node.props.cluster === false || markers.length < 2
      ? []
      : CLUSTER_LEVELS.map((level) => clusterMarkers(points, weights, level.radius));
  const raw = node.props.center;
  // A marker selected on load is where the camera opens; otherwise the middle of the markers.
  const focus = markers[markerIndex.get(start.selected ?? '') ?? -1];
  const center: [number, number] =
    Array.isArray(raw) && typeof raw[0] === 'number' && typeof raw[1] === 'number'
      ? [Math.max(-90, Math.min(90, raw[0])), raw[1]]
      : focus
        ? [Math.max(-60, Math.min(60, focus.lat)), focus.lon]
        : homeCenter(points);
  const camera: SceneCamera = {
    position: toVec(center[0], center[1], HOME_DISTANCE).map(round3) as Vec3,
    target: [0, 0, 0],
    fov: FOV,
  };
  // The sun stands west of and above the view, so the day side faces the
  // reader and the night side is a crescent on the eastern limb.
  const sun = toVec(Math.max(-60, Math.min(60, center[0] + 20)), center[1] - 68).map(
    round3,
  ) as Vec3;
  const prepared: Prepared = {
    markers,
    arcs,
    layers,
    times,
    height,
    width,
    clusters,
    center: [round2(center[0]), round2(center[1])],
    camera,
    sun,
    cut: timeOf(start.time),
  };
  cache.set(node, { key: startKey(start), prepared });
  return prepared;
}

/** The middle of the markers, tilted a little toward the equator so the poles do not fill the view. */
function homeCenter(points: [number, number][]): [number, number] {
  const mean = meanCenter(points);
  if (!mean) return [20, 0];
  return [Math.max(-45, Math.min(45, mean[0] * 0.8)), mean[1]];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The data the runtime mounts: every coordinate, layer, time and cluster, resolved by the compiler. */
export function globeConfig(node: IrNode, start: GlobeStart = {}): Record<string, JsonValue> {
  const p = prepare(node, start);
  const timeIndex = new Map(p.times.map((t, i) => [t, i]));
  const config: Record<string, JsonValue> = {
    ids: p.markers.map((m) => m.id),
    labels: p.markers.map((m) => m.label),
    lat: p.markers.map((m) => m.lat),
    lon: p.markers.map((m) => m.lon),
    height: p.height,
    layer: p.markers.map((m) => m.layer),
    time: p.markers.map((m) => timeIndex.get(m.time) ?? -1),
    arcs: p.arcs.flatMap((a) => [a.from, a.to]),
    arcLayer: p.arcs.map((a) => a.layer),
    arcTime: p.arcs.map((a) => timeIndex.get(a.time) ?? -1),
    arcWidth: p.width,
    layers: p.layers.map((l) => ({ id: l.id, label: l.label, tone: l.tone })),
    times: p.times,
    clusters: p.clusters.map((level, i) => ({
      from: CLUSTER_LEVELS[i]?.from ?? 0,
      of: level.of,
      centers: level.centers.flat(),
    })),
    center: p.center,
    distance: HOME_DISTANCE,
    fov: FOV,
    sun: p.sun,
    land: WORLD_LAND,
  };
  for (const key of ['bind', 'timeBind'] as const) {
    const value = node.props[key];
    if (typeof value === 'string') config[key] = value;
  }
  return config;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** True when the globe does not hide `point` from the camera. */
function inView(point: Vec3, eye: Vec3): boolean {
  const d: Vec3 = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const length = Math.hypot(...d);
  const u: Vec3 = [d[0] / length, d[1] / length, d[2] / length];
  const b = dot3(u, eye);
  const disc = b * b - (dot3(eye, eye) - 1);
  if (disc <= 0) return true;
  const near = -b - Math.sqrt(disc);
  return near < 0 || near >= length - 1e-6;
}

/** Which clustering level the camera at `distance` uses, or -1 for none. */
export function clusterLevelAt(levels: readonly { from: number }[], distance: number): number {
  return levels.findIndex((level) => distance >= level.from);
}

/** The home view drawn as SVG: glow, ocean, dotted land, night side, arcs, markers and clusters. */
function globePoster(p: Prepared, node: IrNode, label: string): string {
  const eye = p.camera.position;
  const f = 180 / Math.tan(((FOV / 2) * Math.PI) / 180);
  const radius = f / Math.sqrt(HOME_DISTANCE * HOME_DISTANCE - 1);
  const uid = escapeAttribute(`ak-globe-${node.id}`);
  const at = (v: Vec3) => project(v, p.camera);
  const view: Vec3 = [eye[0] / HOME_DISTANCE, eye[1] / HOME_DISTANCE, eye[2] / HOME_DISTANCE];
  // Land: lattice dots on the near side, split by light so the night side recedes.
  const bands = ['', '', ''];
  for (const v of landDots(POSTER_DOTS)) {
    const facing = dot3(v, view);
    if (facing < 1 / HOME_DISTANCE + 0.02) continue;
    const q = at(v);
    if (!q) continue;
    const light = dot3(v, p.sun);
    const band = light > 0.12 ? 0 : light > -0.12 ? 1 : 2;
    bands[band] += `M${r1(q.x)} ${r1(q.y)}h0`;
  }
  const land = bands
    .map((d, i) => (d ? `<path class="ak-globe-land ak-globe-land-${i}" d="${d}"/>` : ''))
    .join('');
  // The night side: a gradient across the disc, dark away from the sun.
  const sunOnScreen = at([p.sun[0] * 3, p.sun[1] * 3, p.sun[2] * 3]);
  const angle = sunOnScreen ? Math.atan2(sunOnScreen.y - 180, sunOnScreen.x - 320) : Math.PI;
  const gx = Math.cos(angle);
  const gy = Math.sin(angle);
  const shade = `<linearGradient id="${uid}-night" gradientUnits="userSpaceOnUse" x1="${r1(320 + gx * radius)}" y1="${r1(180 + gy * radius)}" x2="${r1(320 - gx * radius)}" y2="${r1(180 - gy * radius)}"><stop offset=".42" stop-color="#000" stop-opacity="0"/><stop offset=".78" stop-color="#000" stop-opacity=".38"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></linearGradient>`;
  const ocean = `<radialGradient id="${uid}-ocean" cx="${r1(320 + gx * radius * 0.35)}" cy="${r1(180 + gy * radius * 0.35)}" r="${r1(radius * 1.35)}" gradientUnits="userSpaceOnUse"><stop offset="0" class="ak-globe-ocean-hi"/><stop offset="1" class="ak-globe-ocean-lo"/></radialGradient>`;
  const glow = `<radialGradient id="${uid}-glow" cx="320" cy="180" r="${r1(radius * 1.32)}" gradientUnits="userSpaceOnUse"><stop offset="${r1((1 / 1.32) * 100) / 100}" class="ak-globe-glow-in"/><stop offset=".86" class="ak-globe-glow-mid"/><stop offset="1" class="ak-globe-glow-out"/></radialGradient>`;
  // Arcs: the visible runs of each route, toned by layer.
  const tone = (layer: number) => p.layers[layer]?.tone ?? 'accent';
  const arcs = p.arcs
    .map((a, i) => {
      if (!arcOn(p, a)) return '';
      const from = p.markers[a.from] as Marker;
      const to = p.markers[a.to] as Marker;
      const points = arcPoints([from.lat, from.lon], [to.lat, to.lon], 48);
      let d = '';
      let pen = false;
      for (const point of points) {
        const q = inView(point, eye) ? at(point) : null;
        if (!q) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${r1(q.x)} ${r1(q.y)}`;
        pen = true;
      }
      return d
        ? `<path class="ak-3d-mark ak-globe-arc" data-tone="${tone(a.layer)}" stroke-width="${r1((p.width[i] ?? 0.6) * 2.2)}" d="${d}"/>`
        : '';
    })
    .join('');
  // Markers, or the home level's clusters when clustering is on.
  const level = p.clusters[clusterLevelAt(CLUSTER_LEVELS, HOME_DISTANCE)];
  const marks: string[] = [];
  const surfaceDot = (lat: number, lon: number, lift: number) => {
    const base = toVec(lat, lon);
    if (dot3(base, view) < 1 / HOME_DISTANCE + 0.01) return null;
    const tip = toVec(lat, lon, 1 + lift);
    return { base: at(base), tip: at(tip) };
  };
  const single = (i: number) => {
    const m = p.markers[i] as Marker;
    if (!markerOn(p, i)) return;
    const seen = surfaceDot(m.lat, m.lon, p.height[i] ?? 0);
    if (!seen?.base || !seen.tip) return;
    // Spikes near the limb stick out sideways; the live view fades them, the poster leaves them out.
    const base = toVec(m.lat, m.lon);
    const toEye: Vec3 = [eye[0] - base[0], eye[1] - base[1], eye[2] - base[2]];
    const facing = dot3(base, toEye) / Math.hypot(...toEye);
    const stem =
      (p.height[i] ?? 0) > 0 && facing >= 0.15
        ? `<path class="ak-globe-stem" d="M${r1(seen.base.x)} ${r1(seen.base.y)}L${r1(seen.tip.x)} ${r1(seen.tip.y)}"/>`
        : '';
    marks.push(
      `<g class="ak-3d-mark ak-globe-marker" data-tone="${tone(m.layer)}">${stem}<circle cx="${r1(seen.tip.x)}" cy="${r1(seen.tip.y)}" r="3"/></g>`,
    );
  };
  if (level) {
    level.centers.forEach(([lat, lon], c) => {
      const members = level.of.flatMap((owner, i) => (owner === c && markerOn(p, i) ? [i] : []));
      if (members.length === 0) return;
      if (members.length === 1) {
        single(members[0] as number);
        return;
      }
      const seen = surfaceDot(lat, lon, 0.01);
      if (!seen?.tip) return;
      const r = 6 + 3.2 * Math.sqrt(members.length);
      marks.push(
        `<g class="ak-3d-mark ak-globe-cluster" data-tone="${tone(p.markers[members[0] as number]?.layer ?? -1)}"><circle cx="${r1(seen.tip.x)}" cy="${r1(seen.tip.y)}" r="${r1(r)}"/><text x="${r1(seen.tip.x)}" y="${r1(seen.tip.y + 4)}">${members.length}</text></g>`,
      );
    });
  } else for (let i = 0; i < p.markers.length; i += 1) single(i);
  // Labels: the heaviest visible markers that stand alone.
  const shownIn = (c: number) =>
    level ? level.of.filter((owner, i) => owner === c && markerOn(p, i)).length : 1;
  const alone = (i: number) => !level || shownIn(level.of[i] ?? 0) === 1;
  const names = p.markers
    .map((m, i) => ({ m, i }))
    .filter(({ i }) => markerOn(p, i) && alone(i))
    .sort((a, b) => (b.m.value ?? 0) - (a.m.value ?? 0) || a.i - b.i)
    .flatMap(({ m, i }) => {
      const seen = surfaceDot(m.lat, m.lon, p.height[i] ?? 0);
      return seen?.tip
        ? [`<text x="${r1(seen.tip.x)}" y="${r1(seen.tip.y - 8)}">${escapeText(m.label)}</text>`]
        : [];
    })
    .slice(0, POSTER_LABELS)
    .join('');
  return `<svg class="ak-3d-poster ak-globe-poster" viewBox="0 0 640 360" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet"><defs>${glow}${ocean}${shade}</defs><circle class="ak-globe-halo" cx="320" cy="180" r="${r1(radius * 1.32)}" fill="url(#${uid}-glow)"/><circle class="ak-globe-ocean" cx="320" cy="180" r="${r1(radius)}" fill="url(#${uid}-ocean)"/>${land}<circle class="ak-globe-night" cx="320" cy="180" r="${r1(radius)}" fill="url(#${uid}-night)"/><circle class="ak-globe-rim" cx="320" cy="180" r="${r1(radius)}"/><g class="ak-globe-arcs">${arcs}</g>${marks.join('')}<g class="ak-globe-labels">${names}</g></svg>`;
}

function toneSwatch(tone: string): string {
  return `<span class="ak-net-swatch" data-tone="${escapeAttribute(tone)}"></span>`;
}

/** Layer chips: buttons the runtime enables, plain labels without JS. */
function legend(p: Prepared): string {
  if (p.layers.length === 0) return '';
  const counts = p.layers.map(() => 0);
  for (const m of p.markers) if (m.layer >= 0) counts[m.layer] = (counts[m.layer] ?? 0) + 1;
  for (const a of p.arcs) if (a.layer >= 0) counts[a.layer] = (counts[a.layer] ?? 0) + 1;
  const items = p.layers.map(
    (l, i) =>
      `<li><button type="button" disabled data-ak-globe-layer="${escapeAttribute(l.id)}" aria-pressed="true">${toneSwatch(l.tone)}<span>${escapeText(l.label)}</span><span class="ak-net-count">${counts[i] ?? 0}</span></button></li>`,
  );
  return `<ul class="ak-net-legend ak-globe-layers" aria-label="Layers">${items.join('')}</ul>`;
}

/** The time scrubber: every step up to the chosen one is shown. Disabled without JS. */
function timeControl(p: Prepared, node: IrNode): string {
  if (p.times.length < 2) return '';
  // The last step the opening cutoff shows.
  let index = 0;
  p.times.forEach((t, i) => {
    if (shownAt(t, p.cut)) index = i;
  });
  const id = escapeAttribute(`ak-globe-${node.id}-time`);
  return `<div class="ak-globe-time"><label for="${id}">Up to <output>${escapeText(
    p.times[index] ?? '',
  )}</output></label><input id="${id}" type="range" min="0" max="${p.times.length - 1}" step="1" value="${index}" disabled data-ak-globe-time aria-valuetext="${escapeAttribute(p.times[index] ?? '')}"><span class="ak-globe-time-ends"><span>${escapeText(p.times[0] ?? '')}</span><span>${escapeText(p.times[p.times.length - 1] ?? '')}</span></span></div>`;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const formatValue = (value: number | null) =>
  value === null ? '<span class="ak-net-none">—</span>' : escapeText(formatNumber(value));

/** Grouped thousands, fixed to the en-US style so output never depends on the host locale. */
function formatNumber(value: number): string {
  const [whole, fraction] = String(round2(value)).split('.');
  const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function rowAttrs(kind: string, key: string, layer: string, time: string, on: boolean): string {
  return ` data-ak-globe-${kind}="${escapeAttribute(key)}" data-ak-globe-in="${escapeAttribute(layer)}"${
    time ? ` data-ak-globe-when="${escapeAttribute(time)}"` : ''
  }${on ? '' : ' data-ak-globe-out'}`;
}

/** Every place with its coordinates, layer, value and time, for no-JS, print and assistive tech. */
function markerTable(p: Prepared, valueLabel: string, selected: string): string {
  const hasValue = p.markers.some((m) => m.value !== null);
  const hasTime = p.markers.some((m) => m.time !== '');
  const hasLayer = p.layers.length > 0;
  const head = `<th scope="col">Place</th><th scope="col">Latitude</th><th scope="col">Longitude</th>${
    hasLayer ? '<th scope="col">Layer</th>' : ''
  }${hasValue ? `<th scope="col">${escapeText(valueLabel)}</th>` : ''}${hasTime ? '<th scope="col">Time</th>' : ''}`;
  const body = p.markers
    .map((m, i) => {
      const layer = p.layers[m.layer];
      const description = m.description
        ? `<span class="ak-3d-note">${escapeText(m.description)}</span>`
        : '';
      return `<tr${rowAttrs('row', m.id, layer?.id ?? '', m.time, markerOn(p, i))}><th scope="row"><button type="button" disabled data-ak-3d-pick="${escapeAttribute(m.id)}" aria-pressed="${
        m.id === selected ? 'true' : 'false'
      }"><span class="ak-3d-name">${escapeText(m.label)}</span>${description}</button></th><td>${formatCoordinate(m.lat, 'lat')}</td><td>${formatCoordinate(m.lon, 'lon')}</td>${
        hasLayer
          ? `<td>${layer ? `${toneSwatch(layer.tone)}${escapeText(layer.label)}` : ''}</td>`
          : ''
      }${hasValue ? `<td>${formatValue(m.value)}</td>` : ''}${hasTime ? `<td>${escapeText(m.time)}</td>` : ''}</tr>`;
    })
    .join('');
  return `<div class="ak-net-table ak-globe-table" tabindex="0" role="region" aria-label="Places"><table><caption>${count(p.markers.length, 'place')}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Every route with its great-circle distance. */
function arcTable(p: Prepared, valueLabel: string): string {
  if (p.arcs.length === 0) return '';
  const hasValue = p.arcs.some((a) => a.value !== null);
  const hasTime = p.arcs.some((a) => a.time !== '');
  const hasLayer = p.layers.length > 0;
  const head = `<th scope="col">Route</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Distance</th>${
    hasLayer ? '<th scope="col">Layer</th>' : ''
  }${hasValue ? `<th scope="col">${escapeText(valueLabel)}</th>` : ''}${hasTime ? '<th scope="col">Time</th>' : ''}`;
  const body = p.arcs
    .map((a, i) => {
      const layer = p.layers[a.layer];
      return `<tr${rowAttrs('arc', String(i), layer?.id ?? '', a.time, arcOn(p, a))}><th scope="row">${escapeText(a.label)}</th><td>${escapeText(
        p.markers[a.from]?.label ?? '',
      )}</td><td>${escapeText(p.markers[a.to]?.label ?? '')}</td><td>${formatNumber(a.km)} km</td>${
        hasLayer
          ? `<td>${layer ? `${toneSwatch(layer.tone)}${escapeText(layer.label)}` : ''}</td>`
          : ''
      }${hasValue ? `<td>${formatValue(a.value)}</td>` : ''}${hasTime ? `<td>${escapeText(a.time)}</td>` : ''}</tr>`;
    })
    .join('');
  return `<div class="ak-net-table ak-globe-table" tabindex="0" role="region" aria-label="Routes"><table><caption>${count(p.arcs.length, 'route')}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderGlobe(node: IrNode, context: RenderContext): string {
  const read = (key: string) => {
    const path = stringProp(node, key);
    const value = path.startsWith('state.') ? context.ir.state[path.slice(6)] : undefined;
    return typeof value === 'string' ? value : '';
  };
  const start: GlobeStart = { selected: read('bind'), time: read('timeBind') };
  const p = prepare(node, start);
  const summary = stringProp(node, 'summary');
  const valueLabel = stringProp(node, 'valueLabel') || 'Value';
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-globe',
      'data-ak-3d': 'globe',
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(globeConfig(node, start)),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${globePoster(p, node, summary)}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}</figcaption>`,
      `<div class="ak-globe-controls">${legend(p)}${timeControl(p, node)}</div>`,
      markerTable(p, valueLabel, start.selected ?? ''),
      arcTable(p, valueLabel),
    ].join(''),
  );
}

/** Duplicate ids, unknown layers and endpoints, self-routes and malformed times. */
export function checkGlobe(node: IrNode, { bag }: CheckContext): void {
  const report = (path: string, message: string) =>
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, nodeId: node.id, message });
  const layers = rows(node, 'layers');
  const markersPath = pathKey(node.path, 'markers');
  const markerListPath = pathKey(node.path, 'markerList');
  const arcListPath = pathKey(node.path, 'arcList');
  // Each entry carries where to report it: a list item path, or the compact prop with its line.
  // A malformed compact line is reported once, below, and not checked further.
  const markers = [
    ...rows(node, 'markers').map((row, i) => ({ row, path: pathIndex(markersPath, i), at: '' })),
    ...markerLines(node).flatMap((l) =>
      l.problem ? [] : [{ row: l.row, path: markerListPath, at: `line ${l.line}: ` }],
    ),
  ];
  const arcs = [
    ...rows(node, 'arcs').map((row, i) => ({
      row,
      path: pathIndex(pathKey(node.path, 'arcs'), i),
      at: '',
    })),
    ...arcLines(node).flatMap((l) =>
      l.problem ? [] : [{ row: l.row, path: arcListPath, at: `line ${l.line}: ` }],
    ),
  ];
  for (const l of markerLines(node))
    if (l.problem) report(markerListPath, `line ${l.line}: ${l.problem}`);
  for (const l of arcLines(node))
    if (l.problem) report(arcListPath, `line ${l.line}: ${l.problem}`);
  if (markers.length === 0)
    report(markersPath, 'a globe needs at least one marker in `markers` or `markerList`');
  if (markers.length > MAX_MARKERS)
    report(markersPath, `a globe holds at most ${MAX_MARKERS} markers`);
  if (arcs.length > MAX_ARCS)
    report(pathKey(node.path, 'arcs'), `a globe holds at most ${MAX_ARCS} arcs`);
  const layerIds = new Set<string>();
  layers.forEach((l, i) => {
    const id = text(l.id);
    if (layerIds.has(id))
      report(
        pathKey(pathIndex(pathKey(node.path, 'layers'), i), 'id'),
        `layer "${id}" is listed twice`,
      );
    layerIds.add(id);
  });
  type Entry = { row: Record<string, JsonValue>; path: string; at: string };
  // A list item reports at its field; a compact line reports at the prop, naming the line.
  const field = (entry: Entry, key: string) => (entry.at ? entry.path : pathKey(entry.path, key));
  const checkItem = (entry: Entry) => {
    const { layer, time } = entry.row;
    if (typeof layer === 'string' && !layerIds.has(layer))
      report(field(entry, 'layer'), `${entry.at}layer "${layer}" is not listed in layers`);
    // Compact lines already report a malformed time with their other problems.
    if (!entry.at && typeof time === 'string' && !TIME.test(time))
      report(field(entry, 'time'), `"${time}" is not a date as YYYY, YYYY-MM or YYYY-MM-DD`);
  };
  const ids = new Set<string>();
  for (const entry of markers) {
    const id = text(entry.row.id);
    if (ids.has(id)) report(field(entry, 'id'), `${entry.at}marker id "${id}" is used twice`);
    ids.add(id);
    checkItem(entry);
  }
  for (const entry of arcs) {
    const { from, to } = entry.row;
    for (const value of [text(from), text(to)])
      if (value !== '' && !ids.has(value))
        report(
          field(entry, value === text(from) ? 'from' : 'to'),
          `${entry.at}"${value}" is not a marker id on this globe`,
        );
    if (text(from) !== '' && from === to)
      report(field(entry, 'to'), `${entry.at}arc links "${text(from)}" to itself`);
    checkItem(entry);
  }
  const center = node.props.center;
  if (Array.isArray(center) && typeof center[0] === 'number' && Math.abs(center[0]) > 90)
    report(pathKey(node.path, 'center'), 'center latitude must be between -90 and 90');
}

export const globe3dBlock: BlockModule = {
  definition: define({
    type: 'globe-3d',
    category: 'media',
    tags: ['3d', 'webgl', 'globe', 'map', 'geo', 'interactive'],
    useCases: ['show sites on a world map', 'draw routes between places'],
    purpose:
      'Interactive 3D globe with lat/lon markers, great-circle arcs, layers, clustering and a time filter.',
    summary:
      'Globe 3D: lat/lon markers, arcs, layers, clustering, time filter; pick flies the camera.',
    props: GLOBE_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A static SVG globe and tables of every place and route render without JS or WebGL; each place is a button, and the canvas is keyboard navigable.',
  }),
  render: renderGlobe,
  check: checkGlobe,
};
