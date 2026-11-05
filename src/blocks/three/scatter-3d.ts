/** Scatter 3D: numeric x/y/z axes, size and color encodings, legend filter, pick and brush. */

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
  AXES,
  type Axis,
  type AxisScale,
  axisTitle,
  COLOR_STEPS,
  checkScatter,
  colorStep,
  formatTick,
  MAX_POINTS,
  SCATTER_SCHEMAS,
  type ScatterLayout,
  scatterLayout,
  sizeFactor,
  unit,
} from './scatter-ir.js';

type Vec3 = [number, number, number];

const statePath = (description: string) =>
  str({ maxLength: 128, description: `${description} A state path such as \`state.point\`.` });

export const SCATTER_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the points show, in words; the caption and the text alternative.',
  }),
  ...SCATTER_SCHEMAS,
  bind: statePath('The picked point id is written here; a point id in state selects it.'),
  filterBind: statePath('A group value here shows only that group; any other value shows all.'),
  on: onProp(
    'Bindings fired with `{ value }`: the point id on `select`, the brushed count on `brush`.',
  ),
  ...anchorProps,
};

/** The orbit camera the runtime starts from and the poster projects through. */
export const SCATTER_CAMERA = { theta: 0.72, phi: 1.2, radius: 5.8, fov: 30 } as const;
/** Aimed a little below the cube's centre, so the tick labels under the floor stay in frame. */
export const SCATTER_TARGET: Vec3 = [0, -0.32, 0];

export function cameraPosition(): Vec3 {
  const { theta, phi, radius } = SCATTER_CAMERA;
  return [
    radius * Math.sin(phi) * Math.sin(theta),
    SCATTER_TARGET[1] + radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.cos(theta),
  ].map((n) => Math.round(n * 1e4) / 1e4) as Vec3;
}

/** Domain to the [-1, 1] cube the runtime draws in. */
const cube = (v: number, scale: AxisScale) => unit(v, scale) * 2 - 1;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

export function scatterConfig(node: IrNode, layout: ScatterLayout): Record<string, JsonValue> {
  const positions: number[] = [];
  for (let i = 0; i < layout.count; i += 1) {
    positions.push(
      r4(cube(layout.x[i] ?? 0, layout.scales.x)),
      r4(cube(layout.y[i] ?? 0, layout.scales.y)),
      r4(cube(layout.z[i] ?? 0, layout.scales.z)),
    );
  }
  const { sizeScale, colorScale } = layout;
  const axes: Record<string, JsonValue> = {};
  for (const axis of AXES) {
    const scale = layout.scales[axis];
    axes[axis] = {
      title: axisTitle(scale),
      ticks: scale.ticks.map((t) => [r4(cube(t, scale)), formatTick(t, scale)]),
    };
  }
  const config: Record<string, JsonValue> = {
    count: layout.count,
    ids: layout.ids,
    positions,
    clipped: layout.clipped.flatMap((out, i) => (out ? [i] : [])),
    axes,
    camera: { position: cameraPosition(), target: SCATTER_TARGET, fov: SCATTER_CAMERA.fov },
  };
  if (layout.size && sizeScale) config.sizes = layout.size.map((v) => r4(sizeFactor(v, sizeScale)));
  if (layout.group) {
    config.colors = layout.group;
    config.palette = layout.groups.map((g) => g.tone);
    config.groups = layout.groups.map((g) => g.value);
  } else if (layout.value && colorScale) {
    config.colors = layout.value.map((v) => colorStep(v, colorScale));
    config.palette = 'sequential';
  }
  for (const key of ['bind', 'filterBind'] as const) {
    const value = node.props[key];
    if (value !== undefined) config[key] = value;
  }
  return config;
}

/* ---------- static poster: the same camera, projected at compile time ---------- */

const W = 640;
const H = 360;

function projector() {
  const eye = cameraPosition();
  const look: Vec3 = [
    SCATTER_TARGET[0] - eye[0],
    SCATTER_TARGET[1] - eye[1],
    SCATTER_TARGET[2] - eye[2],
  ];
  const length = Math.hypot(...look);
  const forward: Vec3 = [look[0] / length, look[1] / length, look[2] / length];
  const rl = Math.hypot(forward[2], forward[0]);
  const right: Vec3 = [-forward[2] / rl, 0, forward[0] / rl];
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const f = H / 2 / Math.tan((SCATTER_CAMERA.fov * Math.PI) / 360);
  return (p: Vec3) => {
    const d: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const depth = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
    const sx = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    const sy = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    return { x: W / 2 + (sx * f) / depth, y: H / 2 - (sy * f) / depth, depth, f };
  };
}

/** Where each axis' ticks and title sit for the default camera (front-bottom edges). */
const EDGE: Record<Axis, (t: number) => Vec3> = {
  x: (t) => [t, -1, 1],
  y: (t) => [1, t, -1],
  z: (t) => [1, -1, t],
};
const OUTWARD: Record<Axis, Vec3> = {
  x: [0, -0.16, 0.16],
  y: [0.16, 0, -0.16],
  z: [0.16, -0.16, 0],
};

function posterGrid(layout: ScatterLayout, at: ReturnType<typeof projector>): string {
  const line = (a: Vec3, b: Vec3, cls: string) => {
    const p = at(a);
    const q = at(b);
    return `<line class="${cls}" x1="${r1(p.x)}" y1="${r1(p.y)}" x2="${r1(q.x)}" y2="${r1(q.y)}"/>`;
  };
  const out: string[] = [];
  // Back walls for this camera: the floor (y=-1), x=-1 and z=-1.
  const tx = layout.scales.x.ticks.map((t) => cube(t, layout.scales.x));
  const ty = layout.scales.y.ticks.map((t) => cube(t, layout.scales.y));
  const tz = layout.scales.z.ticks.map((t) => cube(t, layout.scales.z));
  for (const v of tx)
    out.push(line([v, -1, -1], [v, -1, 1], 'g'), line([v, -1, -1], [v, 1, -1], 'g'));
  for (const v of tz)
    out.push(line([-1, -1, v], [1, -1, v], 'g'), line([-1, -1, v], [-1, 1, v], 'g'));
  for (const v of ty)
    out.push(line([-1, v, -1], [1, v, -1], 'g'), line([-1, v, -1], [-1, v, 1], 'g'));
  const box: [Vec3, Vec3][] = [
    [
      [-1, -1, -1],
      [1, -1, -1],
    ],
    [
      [-1, -1, -1],
      [-1, 1, -1],
    ],
    [
      [-1, -1, -1],
      [-1, -1, 1],
    ],
    [
      [1, -1, -1],
      [1, -1, 1],
    ],
    [
      [-1, -1, 1],
      [1, -1, 1],
    ],
    [
      [1, -1, -1],
      [1, 1, -1],
    ],
    [
      [-1, 1, -1],
      [1, 1, -1],
    ],
    [
      [-1, 1, -1],
      [-1, 1, 1],
    ],
    [
      [-1, -1, 1],
      [-1, 1, 1],
    ],
  ];
  for (const [a, b] of box) out.push(line(a, b, 'e'));
  return out.join('');
}

type PosterLabel = { x: number; y: number; text: string; title: boolean };

/** Same rule as the live overlay: titles are pulled inside the frame first, then ticks that
 * would leave it or overlap a placed label are dropped. Widths are estimated from the font size. */
function placeLabels(labels: PosterLabel[]): PosterLabel[] {
  const inset = 4;
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const kept: PosterLabel[] = [];
  for (const label of [...labels.filter((l) => l.title), ...labels.filter((l) => !l.title)]) {
    const size = label.title ? 10 : 9;
    const w = label.text.length * size * 0.6;
    const h = size * 1.2;
    let { x, y } = label;
    const outside =
      x - w / 2 < inset || x + w / 2 > W - inset || y - h / 2 < inset || y + h / 2 > H - inset;
    if (label.title) {
      x = Math.min(Math.max(x, w / 2 + inset), W - w / 2 - inset);
      y = Math.min(Math.max(y, h / 2 + inset), H - h / 2 - inset);
    } else if (outside) continue;
    const box = { x0: x - w / 2 - 2, x1: x + w / 2 + 2, y0: y - h / 2, y1: y + h / 2 };
    if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0))
      continue;
    placed.push(box);
    kept.push({ ...label, x, y });
  }
  return kept;
}

function posterLabels(layout: ScatterLayout, at: ReturnType<typeof projector>): string {
  const labels: PosterLabel[] = [];
  for (const axis of AXES) {
    const scale = layout.scales[axis];
    const [ox, oy, oz] = OUTWARD[axis];
    for (const t of scale.ticks) {
      const [x, y, z] = EDGE[axis](cube(t, scale));
      const p = at([x + ox, y + oy, z + oz]);
      labels.push({ x: p.x, y: p.y, text: formatTick(t, scale), title: false });
    }
    const [x, y, z] = axis === 'y' ? EDGE.y(1.2) : EDGE[axis](0);
    const k = axis === 'y' ? 1 : 2.2;
    const p = at([x + ox * k, y + oy * k, z + oz * k]);
    labels.push({ x: p.x, y: p.y, text: axisTitle(scale), title: true });
  }
  return placeLabels(labels)
    .map(
      (l) =>
        `<text${l.title ? ' class="t"' : ''} x="${r1(l.x)}" y="${r1(l.y + (l.title ? 4 : 3))}">${escapeText(l.text)}</text>`,
    )
    .join('');
}

function dotClass(layout: ScatterLayout, i: number): string {
  if (layout.group) return `t-${layout.groups[layout.group[i] ?? 0]?.tone ?? 'accent'}`;
  if (layout.value && layout.colorScale)
    return `q${colorStep(layout.value[i] ?? 0, layout.colorScale)}`;
  return 't-accent';
}

export function scatterPoster(layout: ScatterLayout, label: string, selected: string): string {
  const at = projector();
  const dots: { depth: number; svg: string }[] = [];
  for (let i = 0; i < layout.count; i += 1) {
    if (layout.clipped[i]) continue;
    const p = at([
      cube(layout.x[i] ?? 0, layout.scales.x),
      cube(layout.y[i] ?? 0, layout.scales.y),
      cube(layout.z[i] ?? 0, layout.scales.z),
    ]);
    const factor =
      layout.size && layout.sizeScale ? sizeFactor(layout.size[i] ?? 0, layout.sizeScale) : 1;
    // Fewer, larger points read as marks; a dense cloud reads as density.
    const base = layout.count > 2000 ? 0.012 : layout.count > 300 ? 0.022 : 0.04;
    const r = Math.max(0.6, (base * factor * p.f) / p.depth);
    const picked = layout.ids[i] === selected ? ' s' : '';
    dots.push({
      depth: p.depth,
      svg: `<circle class="${dotClass(layout, i)}${picked}" cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(r)}"/>`,
    });
  }
  // Far to near, ties in data order: deterministic painter's order.
  dots.sort((a, b) => b.depth - a.depth);
  return `<svg class="ak-3d-poster ak-sc-poster" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet"><g class="ak-sc-grid">${posterGrid(layout, at)}</g><g class="ak-sc-dots">${dots
    .map((d) => d.svg)
    .join('')}</g><g class="ak-sc-ticks">${posterLabels(layout, at)}</g></svg>`;
}

/* ---------- legend, status and the full data table ---------- */

function legend(layout: ScatterLayout, filter: string): string {
  const parts: string[] = [];
  if (layout.group) {
    const counts = layout.groups.map(() => 0);
    for (const g of layout.group) counts[g] = (counts[g] ?? 0) + 1;
    const items = layout.groups
      .map((g, i) => {
        const pressed = filter === '' || filter === g.value ? 'true' : 'false';
        return `<li><button type="button" disabled data-ak-sc-group="${escapeAttribute(
          g.value,
        )}" aria-pressed="${pressed}"><span class="ak-sc-swatch t-${g.tone}" aria-hidden="true"></span>${escapeText(
          g.label,
        )}<span class="ak-sc-count">${formatCount(counts[i] ?? 0)}</span></button></li>`;
      })
      .join('');
    parts.push(`<ul class="ak-sc-groups" aria-label="Groups">${items}</ul>`);
  } else if (layout.value && layout.colorScale) {
    const scale = layout.colorScale;
    const steps = Array.from({ length: COLOR_STEPS }, (_, i) => `<span class="q${i}"></span>`).join(
      '',
    );
    parts.push(
      `<div class="ak-sc-ramp"><span class="ak-sc-key">${escapeText(axisTitle(scale))}</span><span class="ak-sc-min">${escapeText(
        formatTick(scale.domain[0], scale),
      )}</span><span class="ak-sc-bar" aria-hidden="true">${steps}</span><span class="ak-sc-max">${escapeText(
        formatTick(scale.domain[1], scale),
      )}</span></div>`,
    );
  }
  if (layout.size && layout.sizeScale) {
    const scale = layout.sizeScale;
    const marks = [scale.domain[0], (scale.domain[0] + scale.domain[1]) / 2, scale.domain[1]]
      .map(
        (v, i) =>
          `<span class="ak-sc-size"><i class="r${i}" aria-hidden="true"></i>${escapeText(
            formatTick(v, scale),
          )}</span>`,
      )
      .join('');
    parts.push(
      `<div class="ak-sc-sizes"><span class="ak-sc-key">${escapeText(axisTitle(scale))}</span>${marks}</div>`,
    );
  }
  return parts.length ? `<div class="ak-sc-legend">${parts.join('')}</div>` : '';
}

function statusText(layout: ScatterLayout): string {
  const shown = layout.count - layout.clippedCount;
  const clipped =
    layout.clippedCount > 0
      ? `; ${formatCount(layout.clippedCount)} outside the axis bounds are clipped`
      : '';
  return `${formatCount(shown)} of ${formatCount(layout.count)} points plotted${clipped}.`;
}

function table(layout: ScatterLayout, selected: string): string {
  const head = ['Point', ...AXES.map((axis) => axisTitle(layout.scales[axis]))];
  if (layout.size && layout.sizeScale) head.push(axisTitle(layout.sizeScale));
  if (layout.value && layout.colorScale) head.push(axisTitle(layout.colorScale));
  if (layout.group) head.push('Group');
  const rows: string[] = [];
  for (let i = 0; i < layout.count; i += 1) {
    const id = layout.ids[i] ?? '';
    const cells = [
      `<th scope="row">${escapeText(id)}${
        layout.clipped[i] ? ' <small class="ak-sc-clip">clipped</small>' : ''
      }</th>`,
      `<td>${layout.x[i]}</td><td>${layout.y[i]}</td><td>${layout.z[i]}</td>`,
    ];
    if (layout.size && layout.sizeScale) cells.push(`<td>${layout.size[i]}</td>`);
    if (layout.value && layout.colorScale) cells.push(`<td>${layout.value[i]}</td>`);
    if (layout.group)
      cells.push(`<td>${escapeText(layout.groups[layout.group[i] ?? 0]?.label ?? '')}</td>`);
    const mark = id === selected ? ' aria-selected="true"' : '';
    rows.push(`<tr data-ak-sc-point="${escapeAttribute(id)}"${mark}>${cells.join('')}</tr>`);
  }
  return `<div class="ak-sc-table" role="region" tabindex="0" aria-label="Data: ${formatCount(
    layout.count,
  )} points"><table><thead><tr>${head
    .map((h) => `<th scope="col">${escapeText(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function stateValue(node: IrNode, key: string, state: Record<string, JsonValue>): string {
  const path = stringProp(node, key);
  const value = path.startsWith('state.') ? state[path.slice(6)] : undefined;
  return typeof value === 'string' ? value : '';
}

export function renderScatter(node: IrNode, context: RenderContext): string {
  const layout = scatterLayout(node);
  const summary = stringProp(node, 'summary');
  const selected = stateValue(node, 'bind', context.ir.state);
  const filterValue = stateValue(node, 'filterBind', context.ir.state);
  const filter = layout.groups.some((g) => g.value === filterValue) ? filterValue : '';
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-sc',
      'data-ak-3d': 'scatter',
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(scatterConfig(node, layout)),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${scatterPoster(layout, summary, selected)}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}</figcaption>`,
      legend(layout, filter),
      `<p class="ak-sc-status" aria-live="polite">${statusText(layout)}</p>`,
      table(layout, selected),
    ].join(''),
  );
}

export const scatter3dBlock: BlockModule = {
  definition: define({
    type: 'scatter-3d',
    category: 'data',
    tags: ['3d', 'webgl', 'three', 'scatter', 'chart', 'interactive'],
    useCases: ['explore three numeric variables at once', 'find clusters and outliers'],
    purpose: `3D scatter plot of up to ${MAX_POINTS} points with real axes and units.`,
    summary:
      'Scatter 3D: x/y/z columns, size and color encodings, legend filter, pick and brush write state.',
    props: SCATTER_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A projected SVG plot and a table of every value render without JS or WebGL and in print; the legend filters by keyboard.',
  }),
  render: renderScatter,
  check: checkScatter,
};
