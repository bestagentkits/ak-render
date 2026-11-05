/**
 * The 3D scatter IR: typed columns, numeric scales and the compile-time layout
 * that both the live runtime and the static fallback read.
 *
 * Scales are decided here, not in the browser: each axis gets a nice domain and
 * ticks, every point a clipped flag, and the runtime only maps domain to cube.
 */

import { pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import type { CheckContext } from '../../registry/block-module.js';
import { enumStr, list, num, obj, str } from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';
import { TONES } from './scene-ir.js';

export const MAX_POINTS = 20000;
export const MAX_GROUPS = 12;
/** Categorical tones in legend order, when a group names none. */
export const GROUP_TONES = ['accent', 'info', 'success', 'danger', 'warning', 'neutral'] as const;
/** Sequential color buckets of the `value` column, shared by the poster, legend and runtime. */
export const COLOR_STEPS = 8;
export const SIZE_RANGE: readonly [number, number] = [0.6, 1.8];

export const AXES = ['x', 'y', 'z'] as const;
export type Axis = (typeof AXES)[number];

const axisSchema = (name: string, required: boolean): PropSchema =>
  obj(
    {
      label: str({ required: true, maxLength: 80, description: `What ${name} measures.` }),
      unit: str({ maxLength: 24, description: 'Unit shown after the label and in the table.' }),
      min: num({ description: 'Lower bound; points below it are clipped. Omitted, a nice bound.' }),
      max: num({ description: 'Upper bound; points above it are clipped. Omitted, a nice bound.' }),
    },
    { required, description: `The ${name} encoding.` },
  );

const column = (description: string, required = false) =>
  list(num({ min: -1e12, max: 1e12 }), {
    maxItems: MAX_POINTS,
    description,
    ...(required ? { required, minItems: 1 } : {}),
  });

export const SCATTER_SCHEMAS = {
  axes: obj(
    {
      x: axisSchema('the x axis', true),
      y: axisSchema('the y axis', true),
      z: axisSchema('the z axis', true),
      size: axisSchema('point size (the `size` column)', false),
      color: axisSchema('point color (the `value` column)', false),
    },
    { required: true, description: 'Axis and encoding labels, units and optional clip bounds.' },
  ),
  data: obj(
    {
      x: column('X of every point.', true),
      y: column('Y of every point.', true),
      z: column('Z of every point.', true),
      size: column('Optional size encoding, one number per point.'),
      value: column('Optional sequential color encoding, one number per point.'),
      group: list(str({ maxLength: 64 }), {
        maxItems: MAX_POINTS,
        description: 'Optional category per point; colors points and drives the legend filter.',
      }),
      id: list(str({ maxLength: 64 }), {
        maxItems: MAX_POINTS,
        description: 'Optional point ids; a pick writes the id (default `p1`, `p2`, ...).',
      }),
    },
    {
      required: true,
      description: `Columns of equal length, at most ${MAX_POINTS} points.`,
    },
  ),
  groups: list(
    obj({
      value: str({ required: true, maxLength: 64, description: 'A value of the `group` column.' }),
      label: str({ maxLength: 80 }),
      tone: enumStr(TONES, { description: 'Theme color; omitted, the next legend tone.' }),
    }),
    { maxItems: MAX_GROUPS, description: 'Legend order, labels and tones of the groups.' },
  ),
};

export interface AxisScale {
  label: string;
  unit: string;
  domain: [number, number];
  ticks: number[];
  /** Decimal places that show every tick distinctly. */
  digits: number;
}

export interface ScatterGroup {
  value: string;
  label: string;
  tone: string;
}

export interface ScatterLayout {
  count: number;
  ids: string[];
  x: number[];
  y: number[];
  z: number[];
  size: number[] | null;
  value: number[] | null;
  group: number[] | null;
  groups: ScatterGroup[];
  scales: Record<Axis, AxisScale>;
  sizeScale: AxisScale | null;
  colorScale: AxisScale | null;
  clipped: boolean[];
  clippedCount: number;
}

/** An omitted column normalizes to an empty list; both read as absent. */
function numbers(raw: JsonValue | undefined): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0));
}
function strings(raw: JsonValue | undefined): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((v) => (typeof v === 'string' ? v : String(v)));
}
function record(raw: JsonValue | undefined): Record<string, JsonValue> {
  return isPlainObject(raw) ? (raw as Record<string, JsonValue>) : {};
}

/** 1, 2 or 5 times a power of ten, the step that gives about `target` intervals. */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit < 1.5 ? 1 : unit < 3 ? 2 : unit < 7 ? 5 : 10;
  return nice * power;
}

/** Ticks rounded to the step's precision, so 0.1 + 0.2 never prints as 0.30000000000000004. */
export function niceTicks(lo: number, hi: number, target = 5): { ticks: number[]; digits: number } {
  const step = niceStep(hi - lo, target);
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks: number[] = [];
  const first = Math.ceil(lo / step - 1e-9);
  for (let k = first; k * step <= hi + step * 1e-9; k += 1) {
    ticks.push(Number((k * step).toFixed(digits)));
  }
  return { ticks, digits };
}

/** The axis domain: explicit bounds win, otherwise the data extent widened to whole ticks. */
export function axisScale(values: readonly number[], axis: Record<string, JsonValue>): AxisScale {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
  if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
  const step = niceStep(hi - lo);
  const stepDigits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const snap = (v: number) => Number(v.toFixed(stepDigits));
  const min = typeof axis.min === 'number' ? axis.min : snap(Math.floor(lo / step + 1e-9) * step);
  const max = typeof axis.max === 'number' ? axis.max : snap(Math.ceil(hi / step - 1e-9) * step);
  const domain: [number, number] = max > min ? [min, max] : [min, min + 1];
  const { ticks, digits } = niceTicks(domain[0], domain[1]);
  return {
    label: typeof axis.label === 'string' ? axis.label : '',
    unit: typeof axis.unit === 'string' ? axis.unit : '',
    domain,
    ticks,
    digits,
  };
}

/** Position of `v` in the domain, 0 at the lower bound and 1 at the upper. */
export function unit(v: number, scale: AxisScale): number {
  const [lo, hi] = scale.domain;
  return (v - lo) / (hi - lo);
}

export function formatTick(v: number, scale: AxisScale): string {
  return v.toFixed(scale.digits);
}

export function axisTitle(scale: AxisScale): string {
  return scale.unit ? `${scale.label} (${scale.unit})` : scale.label;
}

/** The sequential bucket (0 .. COLOR_STEPS - 1) of a color value. */
export function colorStep(v: number, scale: AxisScale): number {
  const t = Math.min(1, Math.max(0, unit(v, scale)));
  return Math.min(COLOR_STEPS - 1, Math.floor(t * COLOR_STEPS));
}

/** Point radius factor in SIZE_RANGE, by area so a doubled value reads as twice the ink. */
export function sizeFactor(v: number, scale: AxisScale): number {
  const t = Math.min(1, Math.max(0, unit(v, scale)));
  const [a, b] = SIZE_RANGE;
  return Math.sqrt(a * a + (b * b - a * a) * t);
}

export function scatterLayout(node: IrNode): ScatterLayout {
  const data = record(node.props.data);
  const axes = record(node.props.axes);
  const x = numbers(data.x) ?? [];
  const y = numbers(data.y) ?? [];
  const z = numbers(data.z) ?? [];
  const count = Math.min(x.length, y.length, z.length);
  const size = numbers(data.size);
  const value = numbers(data.value);
  const rawGroups = strings(data.group);
  const ids = strings(data.id) ?? Array.from({ length: count }, (_, i) => `p${i + 1}`);

  const declared = Array.isArray(node.props.groups)
    ? node.props.groups.filter(isPlainObject).map((g) => g as Record<string, JsonValue>)
    : [];
  const groups: ScatterGroup[] = declared.map((g, i) => ({
    value: String(g.value),
    label: typeof g.label === 'string' ? g.label : String(g.value),
    tone: typeof g.tone === 'string' ? g.tone : (GROUP_TONES[i % GROUP_TONES.length] ?? 'accent'),
  }));
  let group: number[] | null = null;
  if (rawGroups) {
    const index = new Map(groups.map((g, i) => [g.value, i]));
    group = rawGroups.slice(0, count).map((v) => {
      let at = index.get(v);
      if (at === undefined) {
        at = groups.length;
        index.set(v, at);
        groups.push({ value: v, label: v, tone: GROUP_TONES[at % GROUP_TONES.length] ?? 'accent' });
      }
      return at;
    });
  }

  const scales = {
    x: axisScale(x.slice(0, count), record(axes.x)),
    y: axisScale(y.slice(0, count), record(axes.y)),
    z: axisScale(z.slice(0, count), record(axes.z)),
  };
  const sizeScale = size ? axisScale(size, { label: 'Size', ...record(axes.size) }) : null;
  const colorScale = value ? axisScale(value, { label: 'Value', ...record(axes.color) }) : null;
  const clipped: boolean[] = [];
  let clippedCount = 0;
  for (let i = 0; i < count; i += 1) {
    const out = AXES.some((axis) => {
      const v = (axis === 'x' ? x : axis === 'y' ? y : z)[i] ?? 0;
      const [lo, hi] = scales[axis].domain;
      return v < lo || v > hi;
    });
    clipped.push(out);
    if (out) clippedCount += 1;
  }
  return {
    count,
    ids: ids.slice(0, count),
    x: x.slice(0, count),
    y: y.slice(0, count),
    z: z.slice(0, count),
    size: size ? size.slice(0, count) : null,
    value: value ? value.slice(0, count) : null,
    group,
    groups,
    scales,
    sizeScale,
    colorScale,
    clipped,
    clippedCount,
  };
}

/** Equal column lengths, unique ids, group values the legend knows, bounds in order. */
export function checkScatter(node: IrNode, { bag }: CheckContext): void {
  const report = (path: string, message: string) =>
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, nodeId: node.id, message });
  const data = record(node.props.data);
  const dataPath = pathKey(node.path, 'data');
  const length = Array.isArray(data.x) ? data.x.length : 0;
  for (const key of ['y', 'z', 'size', 'value', 'group', 'id']) {
    const columnValue = data[key];
    if (Array.isArray(columnValue) && columnValue.length > 0 && columnValue.length !== length) {
      report(
        pathKey(dataPath, key),
        `column "${key}" has ${columnValue.length} values; x has ${length}`,
      );
    }
  }
  if (Array.isArray(data.id)) {
    const seen = new Set<string>();
    data.id.forEach((id, i) => {
      const value = String(id);
      if (seen.has(value))
        report(`${pathKey(dataPath, 'id')}[${i}]`, `point id "${value}" is used twice`);
      seen.add(value);
    });
  }
  const groups = Array.isArray(node.props.groups) ? node.props.groups.filter(isPlainObject) : [];
  const known = new Set(groups.map((g) => String((g as Record<string, JsonValue>).value)));
  if (groups.length > 0 && Array.isArray(data.group)) {
    const unknown = [...new Set(data.group.map(String))].filter((v) => !known.has(v));
    if (unknown.length > 0) {
      report(
        pathKey(dataPath, 'group'),
        `group "${unknown[0]}" is not listed in groups (${unknown.length} unknown)`,
      );
    }
  } else if (Array.isArray(data.group) && new Set(data.group.map(String)).size > MAX_GROUPS) {
    report(pathKey(dataPath, 'group'), `at most ${MAX_GROUPS} distinct groups`);
  }
  const axes = record(node.props.axes);
  for (const axis of [...AXES, 'size', 'color']) {
    const bounds = record(axes[axis]);
    if (
      typeof bounds.min === 'number' &&
      typeof bounds.max === 'number' &&
      bounds.min >= bounds.max
    ) {
      report(pathKey(pathKey(node.path, 'axes'), axis), `min must be below max`);
    }
  }
}
