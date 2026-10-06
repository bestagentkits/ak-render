/**
 * Shared pieces for the evidence widgets: number formatting for measured
 * values, and reading a block's rows either from an authored list or from its
 * bound data through a `fields` mapping.
 */

import { fieldValue, type MaterializedData } from '../../data/dataset-types.js';
import {
  FORMAT_FIELDS,
  type FormatSpec,
  formatValue,
  type ValueFormat,
} from '../../data/format-value.js';
import { reportUnknownField } from '../../data/resolve-block-data.js';
import { pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import type { CheckContext } from '../../registry/block-module.js';
import type { PropSchema } from '../../registry/prop-schema.js';

/**
 * `FORMAT_FIELDS` without defaults, for an item that overrides the block's
 * format: an absent field must read as "inherit", not as the default.
 */
export const FORMAT_OVERRIDE_FIELDS: Record<string, PropSchema> = Object.fromEntries(
  Object.entries(FORMAT_FIELDS).map(([key, schema]) => {
    const { default: _default, ...rest } = schema as PropSchema & { default?: unknown };
    return [key, rest as PropSchema];
  }),
);

/** The format fields set on a props record (block or item). */
export function formatSpecOf(source: Record<string, JsonValue>): FormatSpec {
  const spec: FormatSpec = {};
  if (typeof source.format === 'string') spec.format = source.format as ValueFormat;
  if (typeof source.unit === 'string') spec.unit = source.unit;
  if (typeof source.currency === 'string') spec.currency = source.currency;
  if (typeof source.decimals === 'number') spec.decimals = source.decimals;
  return spec;
}

/**
 * Format a measured number. These widgets only hold numbers, so the `text`
 * format (the schema default) reads as `number`: grouped digits, trimmed
 * decimals and no floating-point noise.
 */
export function formatMeasure(value: number, spec: FormatSpec): string {
  const format = spec.format === undefined || spec.format === 'text' ? 'number' : spec.format;
  return formatValue(value, { ...spec, format });
}

/** A `fields` prop: which data field feeds each logical column. */
export function fieldMap(node: IrNode, defaults: Record<string, string>): Record<string, string> {
  const authored = isPlainObject(node.props.fields) ? node.props.fields : {};
  const map: Record<string, string> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = authored[key];
    map[key] = typeof value === 'string' ? value : fallback;
  }
  return map;
}

/**
 * Report every mapped field the data does not have. `optional` keys are only
 * checked when the author named them explicitly.
 */
export function checkFieldMap(
  node: IrNode,
  data: MaterializedData,
  map: Record<string, string>,
  optional: readonly string[],
  bag: CheckContext['bag'],
): boolean {
  const authored = isPlainObject(node.props.fields) ? node.props.fields : {};
  let ok = true;
  for (const [key, field] of Object.entries(map)) {
    if (data.fields.includes(field)) continue;
    if (optional.includes(key) && typeof authored[key] !== 'string') continue;
    reportUnknownField(field, data, pathKey(pathKey(node.path, 'fields'), key), bag, node.id);
    ok = false;
  }
  return ok;
}

/** One data row projected through a field map; absent fields read as null. */
export function projectRow(
  row: MaterializedData['rows'][number],
  map: Record<string, string>,
): Record<string, JsonValue> {
  const projected: Record<string, JsonValue> = {};
  for (const [key, field] of Object.entries(map)) projected[key] = fieldValue(row, field);
  return projected;
}

/**
 * Whether normalization already reported a problem with the block's data
 * binding, so a check does not add a second error for the same cause.
 */
export function dataBindingFailed(node: IrNode, bag: CheckContext['bag']): boolean {
  const prefixes = ['dataRef', 'data', 'transform'].map((key) => pathKey(node.path, key));
  return bag
    .errors()
    .some((diagnostic) =>
      prefixes.some(
        (prefix) =>
          diagnostic.path === prefix ||
          diagnostic.path.startsWith(`${prefix}.`) ||
          diagnostic.path.startsWith(`${prefix}[`),
      ),
    );
}
