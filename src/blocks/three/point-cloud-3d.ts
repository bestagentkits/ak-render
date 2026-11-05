/** Point cloud 3D: coordinates and intensity at true proportions, clip box, spatial pick and level of detail. */

import type { IrNode } from '../../ir.js';
import type { JsonValue } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  OPTIONAL_TITLE,
  onProp,
  str,
  txt,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import {
  type CloudLayout,
  checkPointCloud,
  cloudLayout,
  MAX_CLOUD_POINTS,
  MAX_INLINE_POINTS,
  POINT_CLOUD_SCHEMAS,
  POSTER_POINTS,
  pointId,
  TABLE_ROWS,
  toWorld,
  type Vec3,
} from './point-cloud-ir.js';
import {
  formatCount,
  type OrbitCamera,
  orbitPosition,
  orbitProjector,
  POSTER_H,
  POSTER_W,
  type PosterLabel,
  placeLabels,
} from './scatter-3d.js';
import {
  AXES,
  type Axis,
  type AxisScale,
  axisTitle,
  COLOR_STEPS,
  formatTick,
} from './scatter-ir.js';

const statePath = (description: string) =>
  str({ maxLength: 128, description: `${description} A state path such as \`state.point\`.` });

export const POINT_CLOUD_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the cloud shows, in words; the caption and the text alternative.',
  }),
  ...POINT_CLOUD_SCHEMAS,
  bind: statePath('The picked point id is written here; a point id in state selects it.'),
  on: onProp('Bindings fired with `{ value }`: the point id on `select`.'),
  ...anchorProps,
};

const FOV = 30;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** World axis (0 right, 1 up, 2 toward the viewer) and direction of each data axis. */
export function worldAxis(up: 'y' | 'z', axis: Axis): { w: 0 | 1 | 2; sign: 1 | -1 } {
  if (up === 'y') return { w: axis === 'x' ? 0 : axis === 'y' ? 1 : 2, sign: 1 };
  return axis === 'x' ? { w: 0, sign: 1 } : axis === 'y' ? { w: 2, sign: -1 } : { w: 1, sign: 1 };
}

/** Half extents of the clip box in the world cube; the longest is 1. */
export function halfExtents(layout: CloudLayout): Vec3 {
  const half: Vec3 = [0, 0, 0];
  for (const axis of AXES) {
    const [lo, hi] = layout.scales[axis].domain;
    half[worldAxis(layout.up, axis).w] = r4(((hi - lo) * layout.scale) / 2);
  }
  return half;
}

/** Share of the stage width and height the box's corners may fill at home; the rest holds labels and tools. */
export const FIT: readonly [number, number] = [0.84, 0.8];
/** How far below the stage's middle the box sits, as a share of its height: clear of the tools bar. */
export const DROP = 0.03;
/** How far ticks sit outside the box edges, in world units; the live overlay reads it from the config. */
const TICK_OFFSET = 0.045;
const THETA = 0.68;
const PHI = 1.08;

/**
 * The home orbit camera: the box's corners fill `FIT` of the stage, centred
 * `DROP` below the middle. Each pass finds the nearest radius whose view holds
 * the corners in that window, then slides the target in the view plane so the
 * projected box is centred in it.
 */
export function cloudCamera(half: Vec3): { orbit: OrbitCamera; target: Vec3 } {
  const corners: Vec3[] = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) corners.push([x * half[0], y * half[1], z * half[2]]);
  // The view plane's axes for this orbit: right and up, as the projector builds them.
  const back: Vec3 = [
    Math.sin(PHI) * Math.sin(THETA),
    Math.cos(PHI),
    Math.sin(PHI) * Math.cos(THETA),
  ];
  const rl = Math.hypot(back[0], back[2]);
  const right: Vec3 = [back[2] / rl, 0, -back[0] / rl];
  const up: Vec3 = [
    -(right[1] * back[2] - right[2] * back[1]),
    -(right[2] * back[0] - right[0] * back[2]),
    -(right[0] * back[1] - right[1] * back[0]),
  ];
  const middle = POSTER_H * (0.5 + DROP);
  let target: Vec3 = [0, 0, 0];
  let radius = 40;
  const bounds = (r: number) => {
    const at = orbitProjector({ theta: THETA, phi: PHI, radius: r, fov: FOV }, target);
    const p = corners.map(at);
    const xs = p.map((q) => q.x);
    const ys = p.map((q) => q.y);
    return {
      ok: p.every((q) => q.depth > 0),
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
      f: p[0]?.f ?? 1,
    };
  };
  for (let pass = 0; pass < 4; pass += 1) {
    const fits = (r: number) => {
      const b = bounds(r);
      return (
        b.ok &&
        b.x0 >= (POSTER_W * (1 - FIT[0])) / 2 &&
        b.x1 <= (POSTER_W * (1 + FIT[0])) / 2 &&
        b.y0 >= middle - (POSTER_H * FIT[1]) / 2 &&
        b.y1 <= middle + (POSTER_H * FIT[1]) / 2
      );
    };
    let lo = 0.2;
    let hi = 40;
    for (let k = 0; k < 40; k += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    radius = hi;
    const b = bounds(radius);
    const dx = ((b.x0 + b.x1) / 2 - POSTER_W / 2) * (radius / b.f);
    const dy = ((b.y0 + b.y1) / 2 - middle) * (radius / b.f);
    target = [0, 1, 2].map(
      (a) => (target[a] ?? 0) + (right[a] ?? 0) * dx - (up[a] ?? 0) * dy,
    ) as Vec3;
  }
  // A 1% margin absorbs the last slide, which moved the box after its radius was found.
  return {
    orbit: { theta: THETA, phi: PHI, radius: r4(radius * 1.01), fov: FOV },
    target: target.map(r4) as Vec3,
  };
}

const worldOf = (layout: CloudLayout, i: number): Vec3 =>
  toWorld(
    layout.up,
    ((layout.x[i] ?? 0) - layout.center[0]) * layout.scale,
    ((layout.y[i] ?? 0) - layout.center[1]) * layout.scale,
    ((layout.z[i] ?? 0) - layout.center[2]) * layout.scale,
  );

/** World coordinate of a data value along its world axis. */
function worldTick(layout: CloudLayout, axis: Axis, v: number): number {
  const a = AXES.indexOf(axis);
  return r4((v - (layout.center[a] ?? 0)) * layout.scale * worldAxis(layout.up, axis).sign);
}

/** The color bucket of a point: intensity when the cloud has it, else height. */
function colorScale(layout: CloudLayout): { scale: AxisScale; values: number[] } {
  if (layout.intensity && layout.intensityScale)
    return { scale: layout.intensityScale, values: layout.intensity };
  const upAxis: Axis = layout.up;
  return { scale: layout.scales[upAxis], values: layout[upAxis] };
}
function bucket(v: number, scale: AxisScale): number {
  const [lo, hi] = scale.domain;
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return Math.min(COLOR_STEPS - 1, Math.floor(t * COLOR_STEPS));
}

export function pointCloudConfig(node: IrNode, layout: CloudLayout): Record<string, JsonValue> {
  const half = halfExtents(layout);
  const { orbit, target } = cloudCamera(half);
  const axes: Record<string, JsonValue> = {};
  for (const axis of AXES) {
    const scale = layout.scales[axis];
    axes[axis] = {
      title: axisTitle(scale),
      unit: scale.unit,
      w: worldAxis(layout.up, axis).w,
      ticks: scale.ticks.map((t) => [worldTick(layout, axis, t), formatTick(t, scale)]),
    };
  }
  const color = colorScale(layout);
  const config: Record<string, JsonValue> = {
    count: layout.count,
    x: layout.x,
    y: layout.y,
    z: layout.z,
    up: layout.up,
    center: layout.center.map(r4),
    scale: layout.scale,
    half,
    order: layout.order,
    budget: layout.budget,
    clipped: layout.clippedCount,
    axes,
    color: {
      by: layout.intensity ? 'intensity' : 'height',
      domain: color.scale.domain,
      title: axisTitle(color.scale),
    },
    camera: {
      position: orbitPosition(orbit, target),
      target,
      fov: orbit.fov,
      fit: [...FIT],
      drop: DROP,
      tick: TICK_OFFSET,
    },
  };
  if (layout.intensity) config.intensity = layout.intensity;
  if (layout.ids) config.ids = layout.ids;
  if (typeof node.props.bind === 'string') config.bind = node.props.bind;
  return config;
}

/* ---------- static drawing: an even sample through the same camera ---------- */

/** A point beside the box's front-bottom edge of a world axis, `k` steps outward, for this camera. */
function edgePoint(world: 0 | 1 | 2, t: number, half: Vec3, k: number): Vec3 {
  const [hx, hy, hz] = half;
  const o = TICK_OFFSET * k;
  if (world === 0) return [t, -hy - o, hz + o];
  if (world === 1) return [hx + o, t, -hz - o];
  return [hx + o, -hy - o, t];
}

function posterFrame(layout: CloudLayout, half: Vec3, at: ReturnType<typeof orbitProjector>) {
  const [hx, hy, hz] = half;
  const line = (a: Vec3, b: Vec3, cls: string) => {
    const p = at(a);
    const q = at(b);
    return `<line class="${cls}" x1="${r1(p.x)}" y1="${r1(p.y)}" x2="${r1(q.x)}" y2="${r1(q.y)}"/>`;
  };
  const out: string[] = [];
  // A floor grid on the ticks of the two horizontal axes.
  for (const axis of AXES) {
    const { w } = worldAxis(layout.up, axis);
    if (w === 1) continue;
    for (const t of layout.scales[axis].ticks) {
      const v = worldTick(layout, axis, t);
      out.push(
        w === 0 ? line([v, -hy, -hz], [v, -hy, hz], 'g') : line([-hx, -hy, v], [hx, -hy, v], 'g'),
      );
    }
  }
  const corners: [Vec3, Vec3][] = [
    [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
    ],
    [
      [-hx, -hy, hz],
      [hx, -hy, hz],
    ],
    [
      [-hx, -hy, -hz],
      [-hx, -hy, hz],
    ],
    [
      [hx, -hy, -hz],
      [hx, -hy, hz],
    ],
    [
      [-hx, -hy, -hz],
      [-hx, hy, -hz],
    ],
    [
      [hx, -hy, -hz],
      [hx, hy, -hz],
    ],
    [
      [-hx, -hy, hz],
      [-hx, hy, hz],
    ],
    [
      [-hx, hy, -hz],
      [hx, hy, -hz],
    ],
    [
      [-hx, hy, -hz],
      [-hx, hy, hz],
    ],
  ];
  for (const [a, b] of corners) out.push(line(a, b, 'e'));
  return out.join('');
}

function posterLabels(layout: CloudLayout, half: Vec3, at: ReturnType<typeof orbitProjector>) {
  const labels: PosterLabel[] = [];
  for (const axis of AXES) {
    const scale = layout.scales[axis];
    const { w } = worldAxis(layout.up, axis);
    scale.ticks.forEach((t, k) => {
      const p = at(edgePoint(w, worldTick(layout, axis, t), half, 1));
      // The end ticks stay on a phone, where the inner ones would be too small to read.
      const end = k === 0 || k === scale.ticks.length - 1;
      labels.push({ x: p.x, y: p.y, text: formatTick(t, scale), title: false, end });
    });
    const p = at(edgePoint(w, w === 1 ? half[1] + 0.14 : 0, half, w === 1 ? 1 : 0.2 / TICK_OFFSET));
    labels.push({ x: p.x, y: p.y, text: axisTitle(scale), title: true });
  }
  return placeLabels(labels, 6)
    .map((l) => {
      if (!l.title)
        return `<text${l.end ? ' class="x"' : ''} x="${r1(l.x)}" y="${r1(l.y + 3)}">${escapeText(l.text)}</text>`;
      // A title near a side is anchored on its outer edge, so the larger phone type grows inward.
      const half = (l.text.length * 10 * 0.68) / 2;
      const side = l.x > POSTER_W * 0.6 ? 'e' : l.x < POSTER_W * 0.4 ? 's' : '';
      const x = side === 'e' ? l.x + half : side === 's' ? l.x - half : l.x;
      return `<text class="t${side ? ` t${side}` : ''}" x="${r1(x)}" y="${r1(l.y + 4)}">${escapeText(l.text)}</text>`;
    })
    .join('');
}

export function pointCloudPoster(layout: CloudLayout, label: string, selected: number): string {
  const half = halfExtents(layout);
  const { orbit, target } = cloudCamera(half);
  const at = orbitProjector(orbit, target);
  const color = colorScale(layout);
  const sample = layout.order.slice(0, POSTER_POINTS);
  const dots: { depth: number; svg: string }[] = [];
  for (const i of sample) {
    if (i === selected) continue;
    const p = at(worldOf(layout, i));
    const r = Math.max(0.6, (0.0085 * p.f) / p.depth);
    dots.push({
      depth: p.depth,
      svg: `<circle class="q${bucket(color.values[i] ?? 0, color.scale)}" cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(r)}"/>`,
    });
  }
  // Far to near, ties in sample order: a deterministic painter's order.
  dots.sort((a, b) => b.depth - a.depth);
  let pick = '';
  if (selected >= 0) {
    const p = at(worldOf(layout, selected));
    pick = `<g class="ak-pc-mark"><circle class="halo" cx="${r1(p.x)}" cy="${r1(p.y)}" r="9"/><circle class="q${bucket(
      color.values[selected] ?? 0,
      color.scale,
    )} s" cx="${r1(p.x)}" cy="${r1(p.y)}" r="4"/></g>`;
  }
  return `<svg class="ak-3d-poster ak-pc-poster" viewBox="0 0 ${POSTER_W} ${POSTER_H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet"><g class="ak-pc-frame">${posterFrame(layout, half, at)}</g><g class="ak-pc-dots">${dots
    .map((d) => d.svg)
    .join('')}</g>${pick}<g class="ak-pc-ticks">${posterLabels(layout, half, at)}</g></svg>`;
}

/* ---------- legend, status, selection and the tables ---------- */

function legend(layout: CloudLayout): string {
  const { scale } = colorScale(layout);
  const steps = Array.from({ length: COLOR_STEPS }, (_, i) => `<span class="q${i}"></span>`).join(
    '',
  );
  const key = layout.intensity ? axisTitle(scale) : `Height: ${axisTitle(scale)}`;
  return `<div class="ak-pc-legend"><span class="ak-pc-key">${escapeText(key)}</span><span>${escapeText(
    formatTick(scale.domain[0], scale),
  )}</span><span class="ak-pc-bar" aria-hidden="true">${steps}</span><span>${escapeText(
    formatTick(scale.domain[1], scale),
  )}</span></div>`;
}

export function staticStatus(layout: CloudLayout): string {
  const inBox = layout.count - layout.clippedCount;
  const clip =
    layout.clippedCount > 0
      ? `; ${formatCount(layout.clippedCount)} outside the clip box are hidden`
      : '';
  const sample =
    inBox > POSTER_POINTS
      ? ` This drawing shows an even sample of ${formatCount(POSTER_POINTS)} of the ${formatCount(inBox)} in the box.`
      : '';
  return `${formatCount(layout.count)} points${clip}.${sample}`;
}

const valueCells = (layout: CloudLayout, i: number) =>
  [layout.x[i], layout.y[i], layout.z[i], ...(layout.intensity ? [layout.intensity[i]] : [])].map(
    (v) => String(v ?? ''),
  );

function columnTitles(layout: CloudLayout): string[] {
  const titles = AXES.map((axis) => axisTitle(layout.scales[axis]));
  if (layout.intensityScale) titles.push(axisTitle(layout.intensityScale));
  return titles;
}

function selection(layout: CloudLayout, selected: number): string {
  if (selected < 0)
    return '<div class="ak-pc-pick" aria-live="polite"><p>No point selected. Pick one in the view.</p></div>';
  const titles = columnTitles(layout);
  const values = valueCells(layout, selected);
  const rows = titles
    .map((t, k) => `<div><dt>${escapeText(t)}</dt><dd>${escapeText(values[k] ?? '')}</dd></div>`)
    .join('');
  const clip = layout.clipped[selected] ? '<p class="ak-pc-clip">Outside the clip box</p>' : '';
  return `<div class="ak-pc-pick" aria-live="polite"><dl><div><dt>Selected</dt><dd>${escapeText(
    pointId(layout, selected),
  )}</dd></div>${rows}</dl>${clip}</div>`;
}

function statsTable(layout: CloudLayout): string {
  const columns: [string, number[], AxisScale][] = AXES.map((axis) => [
    axisTitle(layout.scales[axis]),
    layout[axis],
    layout.scales[axis],
  ]);
  if (layout.intensity && layout.intensityScale)
    columns.push([axisTitle(layout.intensityScale), layout.intensity, layout.intensityScale]);
  const rows = columns
    .map(([title, values, scale]) => {
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      let sum = 0;
      for (const v of values) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        sum += v;
      }
      const mean = (sum / Math.max(1, values.length)).toFixed(Math.min(6, scale.digits + 2));
      return `<tr><th scope="row">${escapeText(title)}</th><td>${lo}</td><td>${hi}</td><td>${mean}</td></tr>`;
    })
    .join('');
  return `<table class="ak-pc-stats"><caption>All ${formatCount(
    layout.count,
  )} points</caption><thead><tr><th scope="col">Column</th><th scope="col">Min</th><th scope="col">Max</th><th scope="col">Mean</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function sampleTable(layout: CloudLayout, selected: number): string {
  const shown = Math.min(TABLE_ROWS, layout.count);
  const indices = Array.from({ length: shown }, (_, i) => i);
  if (selected >= shown) indices.push(selected);
  const rows = indices
    .map((i) => {
      const id = pointId(layout, i);
      const mark = i === selected ? ' aria-selected="true"' : '';
      const clip = layout.clipped[i] ? ' <small class="ak-pc-clip">clipped</small>' : '';
      return `<tr data-ak-pc-point="${escapeAttribute(id)}"${mark}><th scope="row">${escapeText(
        id,
      )}${clip}</th>${valueCells(layout, i)
        .map((v) => `<td>${v}</td>`)
        .join('')}</tr>`;
    })
    .join('');
  const caption =
    shown < layout.count
      ? `First ${formatCount(shown)} of ${formatCount(layout.count)} points, in data order${
          selected >= shown ? ', and the selected point' : ''
        }`
      : `All ${formatCount(layout.count)} points`;
  return `<div class="ak-pc-table" role="region" tabindex="0" aria-label="${escapeAttribute(
    caption,
  )}"><table><caption>${escapeText(caption)}</caption><thead><tr><th scope="col">Point</th>${columnTitles(
    layout,
  )
    .map((h) => `<th scope="col">${escapeText(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function selectedIndex(
  node: IrNode,
  layout: CloudLayout,
  state: Record<string, JsonValue>,
): number {
  const path = stringProp(node, 'bind');
  const value = path.startsWith('state.') ? state[path.slice(6)] : undefined;
  if (typeof value !== 'string') return -1;
  if (layout.ids) return layout.ids.indexOf(value);
  const n = /^p([1-9]\d*)$/u.exec(value);
  const i = n ? Number(n[1]) - 1 : -1;
  return i < layout.count ? i : -1;
}

export function renderPointCloud(node: IrNode, context: RenderContext): string {
  const layout = cloudLayout(node, context.pointClouds?.get(node.id));
  const summary = stringProp(node, 'summary');
  const selected = selectedIndex(node, layout, context.ir.state);
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-pc',
      'data-ak-3d': 'pointcloud',
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(pointCloudConfig(node, layout)),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${pointCloudPoster(layout, summary, selected)}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}</figcaption>`,
      legend(layout),
      `<p class="ak-pc-status" aria-live="polite">${escapeText(staticStatus(layout))}</p>`,
      selection(layout, selected),
      `<div class="ak-pc-data">${statsTable(layout)}${sampleTable(layout, selected)}</div>`,
    ].join(''),
  );
}

export const pointCloud3dBlock: BlockModule = {
  definition: define({
    type: 'point-cloud-3d',
    category: 'data',
    tags: ['3d', 'chart'],
    useCases: ['LiDAR and scan data', 'spatial samples with intensity'],
    purpose: `3D point cloud of up to ${MAX_CLOUD_POINTS} points (${MAX_INLINE_POINTS} inline) at true proportions, with clip box, picking and level of detail.`,
    summary: 'Point cloud, clip and pick.',
    props: POINT_CLOUD_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A projected SVG sample, the selected point, column statistics and a data table render without JS or WebGL and in print; the view orbits and steps through points by keyboard.',
  }),
  render: renderPointCloud,
  check: checkPointCloud,
};
