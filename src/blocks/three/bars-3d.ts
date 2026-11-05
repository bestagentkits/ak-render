/** Bars 3D: grouped or stacked categorical bars on a true zero baseline, with a full data table. */

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
import { type BarsMode, barExtents, type Extent, niceTicks, valueDomain } from './bars-layout.js';
import { TONES } from './scene-ir.js';

export const MAX_CATEGORIES = 100;
export const MAX_SERIES = 12;
export const MAX_BARS = 1000;
/** Series take theme tones in this order unless they name one. */
const SERIES_TONES = ['accent', 'info', 'success', 'warning', 'danger', 'neutral'] as const;
/** Bar footprint inside its unit cell, and the tallest stack in scene units relative to width. */
const BAR_WIDTH = 0.62;
const STACK_DEPTH = 0.9;

const statePath = (description: string) =>
  str({ maxLength: 128, description: `${description} A state path such as \`state.bar\`.` });

export const BARS_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the chart shows, in words; the caption and the text alternative.',
  }),
  mode: enumStr(['grouped', 'stacked'], {
    default: 'grouped',
    description: '`grouped` puts each series in its own row; `stacked` stacks them per category.',
  }),
  categories: list(obj({ id: { ...idProp('Category id.'), required: true }, label: LABEL }), {
    required: true,
    minItems: 1,
    maxItems: MAX_CATEGORIES,
  }),
  series: list(
    obj({
      id: { ...idProp('Series id; a filter state value selects it.'), required: true },
      label: LABEL,
      tone: enumStr(TONES, {
        description: 'Theme color; series cycle the theme tones by default.',
      }),
    }),
    { required: true, minItems: 1, maxItems: MAX_SERIES },
  ),
  values: list(list(num({ min: -1e12, max: 1e12 }), { minItems: 1, maxItems: MAX_SERIES }), {
    required: true,
    minItems: 1,
    maxItems: MAX_CATEGORIES,
    description: 'One row per category, one value per series, in the listed order.',
  }),
  unit: str({
    maxLength: 16,
    description: 'Suffix shown after every value, such as `%` or ` ms`.',
  }),
  bind: statePath('The picked bar id (`category/series`) is written here and read back.'),
  filterBind: statePath('A series id shows only that series; any other value shows all.'),
  on: onProp('Bindings fired with `{ value }` (the bar id) when a bar is selected.'),
  ...anchorProps,
};

interface Entry {
  id: string;
  label: string;
  tone: string;
}

function entries(node: IrNode, key: string): Entry[] {
  const raw = node.props[key];
  if (!Array.isArray(raw)) return [];
  return (raw.filter(isPlainObject) as Record<string, JsonValue>[]).map((item, i) => ({
    id: String(item.id),
    label: typeof item.label === 'string' ? item.label : String(item.id),
    tone:
      typeof item.tone === 'string' ? item.tone : (SERIES_TONES[i % SERIES_TONES.length] as string),
  }));
}

function matrix(node: IrNode): number[][] {
  const raw = node.props.values;
  if (!Array.isArray(raw)) return [];
  return raw.map((row) =>
    Array.isArray(row) ? row.map((v) => (typeof v === 'number' ? v : 0)) : [],
  );
}

function modeOf(node: IrNode): BarsMode {
  return node.props.mode === 'stacked' ? 'stacked' : 'grouped';
}

/** Deterministic number text: integers as is, others to at most two decimals. */
export function formatValue(value: number, unit = ''): string {
  const text = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `${text}${unit}`;
}

const round = (value: number) => Number(value.toFixed(4));
const DEG = Math.PI / 180;
/** Stage aspect the framing fits: between the 16:9 desktop stage and the 4:3 phone stage. */
const FIT_ASPECT = 1.5;

/**
 * A fixed three-quarter view from the front right, moved in until the chart's
 * box (labels included) fills the frame. Arithmetic only, so it is deterministic.
 */
export function fitCamera(halfX: number, halfZ: number, yLo: number, yHi: number) {
  const fov = 30;
  const az = 20 * DEG;
  const el = 26 * DEG;
  const target = [0, round((yLo + yHi) / 2), 0];
  const dir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  // Camera basis: forward toward the target, right and up perpendicular to it.
  const forward = dir.map((v) => -v);
  const right = [Math.cos(az), 0, -Math.sin(az)];
  // up = right x forward, written out with right's zero y.
  const [fx = 0, fy = 0, fz = 0] = forward;
  const up = [Math.sin(az) * fy, -Math.sin(az) * fx - Math.cos(az) * fz, Math.cos(az) * fy];
  const tanV = Math.tan((fov / 2) * DEG) * 0.92;
  const tanH = tanV * FIT_ASPECT;
  const corners: number[][] = [];
  for (const x of [-halfX, halfX])
    for (const y of [yLo, yHi]) for (const z of [-halfZ, halfZ]) corners.push([x, y, z]);
  const at = (d: number) => dir.map((v, i) => (target[i] as number) + v * d);
  const fits = (d: number) => {
    const eye = at(d);
    return corners.every((corner) => {
      const rel = corner.map((v, i) => v - (eye[i] as number));
      const dot = (a: number[]) => rel.reduce((sum, v, i) => sum + v * (a[i] as number), 0);
      const depth = dot(forward);
      return (
        depth > 0.1 && Math.abs(dot(right)) <= tanH * depth && Math.abs(dot(up)) <= tanV * depth
      );
    });
  };
  let near = 0.5;
  let far = 4000;
  for (let step = 0; step < 40; step += 1) {
    const mid = (near + far) / 2;
    if (fits(mid)) far = mid;
    else near = mid;
  }
  return { position: at(far).map(round), target, fov };
}
export const barId = (category: string, series: string) => `${category}/${series}`;

interface BarsModel {
  mode: BarsMode;
  categories: Entry[];
  series: Entry[];
  values: number[][];
  extents: Extent[][];
  domain: Extent;
  ticks: number[];
}

export function barsModel(node: IrNode): BarsModel {
  const categories = entries(node, 'categories');
  const series = entries(node, 'series');
  const values = matrix(node);
  const mode = modeOf(node);
  const extents = barExtents(values, mode);
  const ticks = niceTicks(valueDomain(extents));
  // The axis runs tick to tick, so the tallest bar and the deepest one stay inside it.
  const domain: Extent = [Math.min(0, ticks[0] ?? 0), Math.max(0, ticks[ticks.length - 1] ?? 0)];
  return { mode, categories, series, values, extents, domain, ticks };
}

/** The data the runtime mounts: one box per bar plus the axis and filter layouts. */
export function barsConfig(node: IrNode): Record<string, JsonValue> {
  const model = barsModel(node);
  const { mode, categories, series, values } = model;
  const rows = mode === 'grouped' ? series.length : 1;
  const span = model.domain[1] - model.domain[0] || 1;
  // Height grows with the footprint so a wide chart does not read as a flat strip.
  const height = Math.min(18, Math.max(3, Math.max(categories.length, rows) * 0.36));
  const k = height / span;
  const x0 = -(categories.length - 1) / 2;
  const z0 = -(rows - 1) / 2;
  const depth = mode === 'grouped' ? BAR_WIDTH : STACK_DEPTH;
  const unit = stringProp(node, 'unit');

  const layoutFor = (visible: (s: number) => boolean): JsonValue =>
    barExtents(values, mode, visible).flatMap((row) =>
      row.map(([bottom, top]) => [round(bottom * k), round(top * k)]),
    );
  const layouts: Record<string, JsonValue> = { '': layoutFor(() => true) };
  series.forEach((entry, s) => {
    layouts[entry.id] = layoutFor((i) => i === s);
  });

  const objects: JsonValue[] = [];
  categories.forEach((category, c) => {
    series.forEach((entry, s) => {
      const value = values[c]?.[s] ?? 0;
      const [bottom, top] = model.extents[c]?.[s] ?? [0, 0];
      const h = Math.max((top - bottom) * k, 0.001);
      objects.push({
        id: barId(category.id, entry.id),
        label: `${category.label} · ${entry.label}: ${formatValue(value, unit)}`,
        shape: 'box',
        position: [
          round(x0 + c),
          round(bottom * k + h / 2),
          round(mode === 'grouped' ? z0 + s : 0),
        ],
        scale: [BAR_WIDTH, round(h), depth],
        tone: entry.tone,
      });
    });
  });

  const halfX = categories.length / 2;
  const halfZ = rows / 2;
  const yLo = model.domain[0] * k;
  const yHi = model.domain[1] * k;
  const camera = fitCamera(halfX + 0.6, halfZ + 0.8, yLo - 0.6, yHi);

  const config: Record<string, JsonValue> = {
    objects,
    camera,
    lighting: 'studio',
    bars: {
      mode,
      series: series.map((entry) => entry.id),
      layouts,
      ticks: model.ticks.map((tick) => [round(tick * k), formatValue(tick, unit)]),
      categories: categories.map((category, c) => [round(x0 + c), category.label]),
      rows: mode === 'grouped' ? series.map((entry, s) => [round(z0 + s), entry.label]) : [],
      extent: [round(-halfX), round(halfX), round(-halfZ), round(halfZ)],
      shades: series.map((_, s) => Math.floor(s / SERIES_TONES.length)),
      ...(typeof node.props.filterBind === 'string' ? { filterBind: node.props.filterBind } : {}),
    },
  };
  if (typeof node.props.bind === 'string') config.bind = node.props.bind;
  return config;
}

const W = 960;
const H = 540;
const PAD = { left: 72, right: 24, top: 24, bottom: 56 };

/** A flat, labelled bar chart of the same data: the no-JS, no-WebGL and print view. */
export function barsPoster(model: BarsModel, label: string, unit: string): string {
  const { mode, categories, series, extents, domain, ticks } = model;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const span = domain[1] - domain[0] || 1;
  const y = (v: number) => round(PAD.top + ((domain[1] - v) / span) * plotH);
  const band = plotW / categories.length;
  const inner = band * 0.78;
  const slot = mode === 'grouped' ? inner / series.length : inner;
  const parts: string[] = [];
  for (const tick of ticks) {
    parts.push(
      `<line class="ak-bars-grid${tick === 0 ? ' ak-bars-zero' : ''}" x1="${PAD.left}" x2="${
        W - PAD.right
      }" y1="${y(tick)}" y2="${y(tick)}"/><text class="ak-bars-tick" x="${PAD.left - 8}" y="${
        y(tick) + 4
      }">${escapeText(formatValue(tick, unit))}</text>`,
    );
  }
  const every = Math.ceil(categories.length / 12);
  categories.forEach((category, c) => {
    const left = PAD.left + c * band + (band - inner) / 2;
    series.forEach((entry, s) => {
      const [bottom, top] = extents[c]?.[s] ?? [0, 0];
      if (top === bottom) return;
      const x = mode === 'grouped' ? left + s * slot : left;
      parts.push(
        `<rect class="ak-3d-mark" data-tone="${escapeAttribute(entry.tone)}"${shadeOf(s)} x="${round(
          x,
        )}" y="${y(top)}" width="${round(Math.max(slot - 1, 0.5))}" height="${round(
          y(bottom) - y(top),
        )}"/>`,
      );
    });
    if (c % every === 0)
      parts.push(
        `<text class="ak-bars-cat" x="${round(PAD.left + (c + 0.5) * band)}" y="${
          H - PAD.bottom + 22
        }">${escapeText(category.label)}</text>`,
      );
  });
  parts.push(
    `<line class="ak-bars-zero" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(0)}" y2="${y(0)}"/>`,
  );
  return `<svg class="ak-3d-poster ak-bars-poster" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
}

/** Every value, readable without JS and in print; each cell picks its bar once the runtime runs. */
export function barsTable(
  model: BarsModel,
  caption: string,
  unit: string,
  selected: string,
): string {
  const { mode, categories, series, values } = model;
  const head = series.map(
    (entry) => `<th scope="col" class="ak-num">${escapeText(entry.label)}</th>`,
  );
  if (mode === 'stacked') head.push('<th scope="col" class="ak-num">Total</th>');
  const body = categories
    .map((category, c) => {
      const row = values[c] ?? [];
      const cells = series.map((entry, s) => {
        const id = barId(category.id, entry.id);
        return `<td class="ak-num"><button type="button" disabled data-ak-3d-pick="${escapeAttribute(
          id,
        )}" aria-pressed="${id === selected ? 'true' : 'false'}">${escapeText(
          formatValue(row[s] ?? 0, unit),
        )}</button></td>`;
      });
      if (mode === 'stacked')
        cells.push(
          `<td class="ak-num">${escapeText(
            formatValue(
              row.reduce((a, b) => a + b, 0),
              unit,
            ),
          )}</td>`,
        );
      return `<tr><th scope="row">${escapeText(category.label)}</th>${cells.join('')}</tr>`;
    })
    .join('');
  return `<div class="ak-table-wrap ak-bars-data"><table><caption class="ak-sr">${escapeText(
    caption,
  )}</caption><thead><tr><th scope="col">Category</th>${head.join(
    '',
  )}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Series past the sixth reuse a tone, so they take a deeper shade of it. */
const shadeOf = (s: number) =>
  s >= SERIES_TONES.length ? ` data-shade="${Math.floor(s / SERIES_TONES.length)}"` : '';

function legend(series: Entry[]): string {
  const items = series
    .map(
      (entry, s) =>
        `<button type="button" disabled data-ak-bars-filter="${escapeAttribute(
          entry.id,
        )}" aria-pressed="false"><span class="ak-3d-mark ak-bars-swatch" data-tone="${escapeAttribute(
          entry.tone,
        )}"${shadeOf(s)}></span>${escapeText(entry.label)}</button>`,
    )
    .join('');
  return `<div class="ak-bars-legend" role="group" aria-label="Series"><button type="button" disabled data-ak-bars-filter="" aria-pressed="true">All</button>${items}</div>`;
}

function renderBars(node: IrNode, context: RenderContext): string {
  const model = barsModel(node);
  const summary = stringProp(node, 'summary');
  const unit = stringProp(node, 'unit');
  const bind = stringProp(node, 'bind');
  const initial = bind.startsWith('state.') ? context.ir.state[bind.slice(6)] : undefined;
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-bars',
      'data-ak-3d': 'bars',
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(barsConfig(node)),
    }),
    [
      titleHeader(node),
      legend(model.series),
      `<div class="ak-3d-stage">${barsPoster(model, summary, unit)}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}</figcaption>`,
      barsTable(model, summary, unit, typeof initial === 'string' ? initial : ''),
    ].join(''),
  );
}

/** Matrix shape against the lists, unique ids and the bar budget. */
export function checkBars(node: IrNode, { bag }: CheckContext): void {
  const report = (path: string, message: string) =>
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, nodeId: node.id, message });
  for (const key of ['categories', 'series']) {
    const seen = new Set<string>();
    entries(node, key).forEach((entry, i) => {
      if (seen.has(entry.id))
        report(
          pathKey(pathIndex(pathKey(node.path, key), i), 'id'),
          `id "${entry.id}" is used twice`,
        );
      seen.add(entry.id);
    });
  }
  const categories = entries(node, 'categories').length;
  const series = entries(node, 'series').length;
  const raw = Array.isArray(node.props.values) ? node.props.values : [];
  const valuesPath = pathKey(node.path, 'values');
  if (raw.length !== categories)
    report(valuesPath, `values has ${raw.length} rows; categories lists ${categories}`);
  raw.forEach((row, i) => {
    if (Array.isArray(row) && row.length !== series)
      report(pathIndex(valuesPath, i), `row has ${row.length} values; series lists ${series}`);
  });
  if (categories * series > MAX_BARS)
    report(valuesPath, `${categories * series} bars exceed the limit of ${MAX_BARS}`);
}

export const bars3dBlock: BlockModule = {
  definition: define({
    type: 'bars-3d',
    category: 'data',
    tags: ['3d', 'webgl', 'three', 'chart', 'bars', 'interactive'],
    useCases: ['compare series per category', 'stacked totals with negatives'],
    purpose: 'Grouped or stacked 3D bars on a zero baseline, with axes, filter and pick.',
    summary: 'Bars 3D: categories x series matrix; grouped or stacked; pick writes state.',
    props: BARS_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A flat SVG chart and a full data table render without JS or WebGL; each table value is a button that selects its bar by keyboard, pointer or touch.',
  }),
  render: renderBars,
  check: checkBars,
};
