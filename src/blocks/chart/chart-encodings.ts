/**
 * Reading a chart's encoding props: the authored `x`/`y`/`value` objects, the
 * `{ field }` series form, and which encoding carries the plotted magnitude.
 */

import type { FormatSpec } from '../../data/format-value.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject } from '../../json.js';
import { stringProp } from '../../render/block-helpers.js';
import type { AxisSpec } from '../../render/chart-types.js';

/** An encoding prop as authored (after schema validation). */
export interface EncodingProp {
  field?: string;
  label?: string;
  format?: string;
  unit?: string;
  currency?: string;
  decimals?: number;
  min?: number;
  max?: number;
}

export function encodingProp(node: IrNode, key: string): EncodingProp | undefined {
  const value = node.props[key];
  return isPlainObject(value) ? (value as unknown as EncodingProp) : undefined;
}

/** The series field when `series` is the `{ field }` form. */
export function seriesField(node: IrNode): string | undefined {
  const value = node.props.series;
  return isPlainObject(value) && typeof value.field === 'string' ? value.field : undefined;
}

/** Kinds whose magnitude comes from `value` (falling back to `y`) rather than the y axis. */
const VALUE_KINDS: readonly string[] = ['pie', 'donut', 'progress', 'funnel', 'gauge', 'treemap'];

/** The encoding that carries the plotted magnitude, with its prop key. */
export function magnitudeEncoding(node: IrNode): { key: string; prop?: EncodingProp } {
  const kind = stringProp(node, 'kind');
  const y = encodingProp(node, 'y');
  const value = encodingProp(node, 'value');
  if (kind === 'heatmap') return { key: 'value', ...(value === undefined ? {} : { prop: value }) };
  if (VALUE_KINDS.includes(kind)) {
    if (value !== undefined || y === undefined) {
      return { key: 'value', ...(value === undefined ? {} : { prop: value }) };
    }
    return { key: 'y', prop: y };
  }
  if (y === undefined && value !== undefined && kind === 'waterfall') {
    return { key: 'value', prop: value };
  }
  return { key: 'y', ...(y === undefined ? {} : { prop: y }) };
}

export function formatSpec(prop: EncodingProp | undefined): FormatSpec {
  const spec: FormatSpec = {};
  if (prop === undefined) return spec;
  if (prop.format !== undefined) spec.format = prop.format as NonNullable<FormatSpec['format']>;
  if (prop.unit !== undefined) spec.unit = prop.unit;
  if (prop.currency !== undefined) spec.currency = prop.currency;
  if (prop.decimals !== undefined) spec.decimals = prop.decimals;
  return spec;
}

export function axisSpec(prop: EncodingProp | undefined, fallbackLabel?: string): AxisSpec {
  const label = prop?.label ?? fallbackLabel;
  return {
    format: formatSpec(prop),
    ...(label === undefined ? {} : { label }),
    ...(prop?.min === undefined ? {} : { min: prop.min }),
    ...(prop?.max === undefined ? {} : { max: prop.max }),
  };
}
