/**
 * The point cloud IR: coordinate and intensity columns (inline or from a local
 * file), the clip box, a uniform scale that keeps the cloud's true shape, and
 * a level-of-detail order decided at compile time.
 *
 * Every point stays in the data. The clip box hides points by an explicit,
 * counted rule; level of detail only chooses which points a bounded draw uses
 * first, and the page says how many it draws. Nothing is dropped silently.
 */

import type { PointCloudColumns } from '../../assets/point-cloud-assets.js';
import { MAX_CLOUD_POINTS } from '../../assets/point-cloud-assets.js';
import { pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import type { CheckContext } from '../../registry/block-module.js';
import { enumStr, list, num, obj, str } from '../../registry/define-helpers.js';
import { LIMITS } from '../../spec/bounds.js';
import { AXES, type Axis, type AxisScale, axisScale } from './scatter-ir.js';

export { MAX_CLOUD_POINTS };
/** Inline columns share the document's column bound; larger clouds come from a file. */
export const MAX_INLINE_POINTS = LIMITS.maxColumnValues;
/** Points the static drawing samples, in level-of-detail order. */
export const POSTER_POINTS = 5000;
/** Rows of the fallback table, in data order; the selected point is always added. */
export const TABLE_ROWS = 100;
export const MIN_BUDGET = 1000;

const axisSchema = (name: string) =>
  obj(
    {
      label: str({ required: true, maxLength: 80, description: `What ${name} measures.` }),
      unit: str({ maxLength: 24, description: 'Unit shown after the label and in the tables.' }),
      min: num({ description: 'Clip box lower bound; points below it are hidden and counted.' }),
      max: num({ description: 'Clip box upper bound; points above it are hidden and counted.' }),
    },
    { description: `The ${name} column: label, unit and optional clip bounds.` },
  );

const column = (description: string) =>
  list(num({ min: -1e12, max: 1e12 }), { maxItems: MAX_INLINE_POINTS, description });

export const POINT_CLOUD_SCHEMAS = {
  src: str({
    maxLength: 512,
    description: `A local .xyz, .csv or .txt file beside the spec, one "x y z [intensity]" point per line, up to ${MAX_CLOUD_POINTS} points. Use src or data.`,
  }),
  data: obj(
    {
      x: column('X of every point.'),
      y: column('Y of every point.'),
      z: column('Z of every point.'),
      intensity: column('Optional return intensity per point; colors the cloud.'),
      id: list(str({ maxLength: 64 }), {
        maxItems: MAX_INLINE_POINTS,
        description: 'Optional point ids; a pick writes the id (default `p1`, `p2`, ...).',
      }),
    },
    {
      description: `Inline columns of equal length, up to ${MAX_INLINE_POINTS} points. Use src or data.`,
    },
  ),
  axes: obj(
    {
      x: axisSchema('x'),
      y: axisSchema('y'),
      z: axisSchema('z'),
      intensity: obj(
        {
          label: str({ required: true, maxLength: 80 }),
          unit: str({ maxLength: 24 }),
        },
        { description: 'Label and unit of the intensity column.' },
      ),
    },
    { description: 'Labels, units and the clip box. Omitted: x, y, z in the data units.' },
  ),
  up: enumStr(['z', 'y'], {
    description: 'Which column points up: `z` (survey and LiDAR files, the default) or `y`.',
  }),
  budget: num({
    min: MIN_BUDGET,
    max: MAX_CLOUD_POINTS,
    integer: true,
    description:
      'Most points the live view draws, in level-of-detail order; the page states the count. Default: all.',
  }),
};

export type Vec3 = [number, number, number];

export interface CloudLayout {
  count: number;
  /** Authored ids, or null for the default `p1`, `p2`, ... */
  ids: string[] | null;
  x: number[];
  y: number[];
  z: number[];
  intensity: number[] | null;
  intensityScale: AxisScale | null;
  scales: Record<Axis, AxisScale>;
  up: 'y' | 'z';
  /** Hidden by the clip box. */
  clipped: Uint8Array;
  clippedCount: number;
  /** In-clip point indices in level-of-detail order: every prefix is spread over the cloud. */
  order: number[];
  /** Data-unit centre of the box and the uniform data-to-cube factor. */
  center: Vec3;
  scale: number;
  /** Live draw budget before the device's quality profile. */
  budget: number;
}

export const pointId = (layout: CloudLayout, i: number) => layout.ids?.[i] ?? `p${i + 1}`;

function record(raw: JsonValue | undefined): Record<string, JsonValue> {
  return isPlainObject(raw) ? (raw as Record<string, JsonValue>) : {};
}
function numbers(raw: JsonValue | undefined): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0));
}

/** Data columns of the block: the resolved file when `src` is set, else the inline columns. */
export function cloudColumns(node: IrNode, file: PointCloudColumns | undefined): PointCloudColumns {
  if (file) return file;
  const data = record(node.props.data);
  return {
    x: numbers(data.x) ?? [],
    y: numbers(data.y) ?? [],
    z: numbers(data.z) ?? [],
    intensity: numbers(data.intensity),
  };
}

/** Data (x, y, z) to world (right, up, toward the viewer), before the uniform scale. */
export function toWorld(up: 'y' | 'z', x: number, y: number, z: number): Vec3 {
  return up === 'z' ? [x, z, -y] : [x, y, z];
}

/** Spread the low 10 bits of `v` to every third bit. */
function spread(v: number): number {
  let n = v & 0x3ff;
  n = (n | (n << 16)) & 0x30000ff;
  n = (n | (n << 8)) & 0x300f00f;
  n = (n | (n << 4)) & 0x30c30c3;
  n = (n | (n << 2)) & 0x9249249;
  return n;
}

function reverseBits(k: number, bits: number): number {
  let r = 0;
  for (let b = 0; b < bits; b += 1) r = (r << 1) | ((k >> b) & 1);
  return r;
}

/**
 * Level-of-detail order: sort by Morton code (neighbours in space stay near in
 * the list), then walk that list in bit-reversed rank, so any prefix samples
 * the whole cloud evenly. Ties keep data order, so the order is deterministic.
 */
export function lodOrder(indices: readonly number[], cube: (i: number) => Vec3): number[] {
  const keyed = indices.map((i) => {
    const [a, b, c] = cube(i);
    const q = (v: number) => Math.min(1023, Math.max(0, Math.floor((v + 1) * 512)));
    return { i, code: spread(q(a)) | (spread(q(b)) << 1) | (spread(q(c)) << 2) };
  });
  keyed.sort((p, q) => p.code - q.code || p.i - q.i);
  const n = keyed.length;
  const bits = n <= 1 ? 0 : Math.ceil(Math.log2(n));
  const out: number[] = [];
  for (let k = 0; k < 2 ** bits; k += 1) {
    const r = reverseBits(k, bits);
    if (r < n) out.push((keyed[r] as { i: number }).i);
  }
  return out;
}

export function cloudLayout(node: IrNode, file: PointCloudColumns | undefined): CloudLayout {
  const columns = cloudColumns(node, file);
  const count = Math.min(columns.x.length, columns.y.length, columns.z.length);
  const axes = record(node.props.axes);
  const up = node.props.up === 'y' ? 'y' : 'z';
  const scales = {} as Record<Axis, AxisScale>;
  for (const axis of AXES) {
    scales[axis] = axisScale(columns[axis].slice(0, count), {
      label: axis,
      ...record(axes[axis]),
    });
  }
  const intensity = columns.intensity ? columns.intensity.slice(0, count) : null;
  const intensityScale = intensity
    ? axisScale(intensity, { label: 'Intensity', ...record(axes.intensity) })
    : null;

  const clipped = new Uint8Array(count);
  let clippedCount = 0;
  const inClip: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const out = AXES.some((axis) => {
      const v = columns[axis][i] ?? 0;
      const [lo, hi] = scales[axis].domain;
      return v < lo || v > hi;
    });
    if (out) {
      clipped[i] = 1;
      clippedCount += 1;
    } else inClip.push(i);
  }

  const mid = (axis: Axis) => (scales[axis].domain[0] + scales[axis].domain[1]) / 2;
  const span = (axis: Axis) => scales[axis].domain[1] - scales[axis].domain[0];
  const center: Vec3 = [mid('x'), mid('y'), mid('z')];
  const scale = 2 / Math.max(span('x'), span('y'), span('z'));
  const cube = (i: number) =>
    toWorld(
      up,
      ((columns.x[i] ?? 0) - center[0]) * scale,
      ((columns.y[i] ?? 0) - center[1]) * scale,
      ((columns.z[i] ?? 0) - center[2]) * scale,
    );
  const ids = file
    ? null
    : (() => {
        const raw = record(node.props.data).id;
        return Array.isArray(raw) && raw.length > 0 ? raw.slice(0, count).map(String) : null;
      })();
  const budgetProp = node.props.budget;
  return {
    count,
    ids,
    x: columns.x.slice(0, count),
    y: columns.y.slice(0, count),
    z: columns.z.slice(0, count),
    intensity,
    intensityScale,
    scales,
    up,
    clipped,
    clippedCount,
    order: lodOrder(inClip, cube),
    center,
    scale,
    budget: Math.min(
      count - clippedCount,
      typeof budgetProp === 'number' ? budgetProp : MAX_CLOUD_POINTS,
    ),
  };
}

/** One input source, equal column lengths, unique ids and a clip box in order. */
export function checkPointCloud(node: IrNode, { bag }: CheckContext): void {
  const report = (path: string, message: string) =>
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, nodeId: node.id, message });
  const hasSrc = typeof node.props.src === 'string' && node.props.src !== '';
  const data = record(node.props.data);
  const hasData = Object.values(data).some((v) => Array.isArray(v) && v.length > 0);
  if (hasSrc === hasData) {
    report(
      node.path,
      hasSrc
        ? 'set either src or data, not both'
        : 'needs points: a src file or data columns x, y and z',
    );
  }
  if (hasData) {
    const dataPath = pathKey(node.path, 'data');
    const length = Array.isArray(data.x) ? data.x.length : 0;
    if (length === 0) report(pathKey(dataPath, 'x'), 'column "x" needs at least one value');
    for (const key of ['y', 'z', 'intensity', 'id']) {
      const values = data[key];
      const required = key === 'y' || key === 'z';
      const n = Array.isArray(values) ? values.length : 0;
      if ((required || n > 0) && n !== length)
        report(pathKey(dataPath, key), `column "${key}" has ${n} values; x has ${length}`);
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
  }
  const axes = record(node.props.axes);
  for (const axis of AXES) {
    const bounds = record(axes[axis]);
    if (
      typeof bounds.min === 'number' &&
      typeof bounds.max === 'number' &&
      bounds.min >= bounds.max
    )
      report(pathKey(pathKey(node.path, 'axes'), axis), 'min must be below max');
  }
}
