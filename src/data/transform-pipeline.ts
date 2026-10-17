/**
 * Bounded, deterministic dataset transforms.
 *
 * A transform is data, not an expression: a fixed pipeline of seven optional
 * stages that always run in the same order (filter → groupBy → derive → sort →
 * select → limit → rollup). Comparison never consults a locale, and sorting is
 * stable, so the same rows and the same transform always produce the same rows
 * in the same order. Derived fields come from a closed list of operations, never
 * from an expression.
 */

import type { PropSchema } from '../registry/prop-schema.js';
import { type DataRow, type DataScalar, fieldValue } from './dataset-types.js';

export type FilterOperator = 'equals' | 'notEquals' | 'in' | 'gt' | 'gte' | 'lt' | 'lte';
export const FILTER_OPERATORS: readonly FilterOperator[] = [
  'equals',
  'notEquals',
  'in',
  'gt',
  'gte',
  'lt',
  'lte',
];

export interface FilterClause {
  field: string;
  equals?: DataScalar;
  notEquals?: DataScalar;
  in?: DataScalar[];
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

export type Aggregate = 'count' | 'sum' | 'mean' | 'min' | 'max';
export const AGGREGATES: readonly Aggregate[] = ['count', 'sum', 'mean', 'min', 'max'];

export interface GroupBySpec {
  field: string;
  aggregate: Aggregate;
  /** Numeric field to aggregate; required for everything except `count`. */
  value?: string;
  /** Output field name; defaults to `count`, or to the `value` field name. */
  as?: string;
}

/**
 * Derived-field operations. `field` is the measure; `base` is the other operand.
 * `delta` and `percentChange` without `base` compare each row with the row
 * before it, in the order the earlier stages left.
 */
export type DeriveOperation =
  | 'ratio'
  | 'percentOf'
  | 'delta'
  | 'percentChange'
  | 'share'
  | 'cumulative';
export const DERIVE_OPERATIONS: readonly DeriveOperation[] = [
  'ratio',
  'percentOf',
  'delta',
  'percentChange',
  'share',
  'cumulative',
];
/** Operations that need `base`, and those that refuse it. */
export const DERIVE_NEEDS_BASE: readonly DeriveOperation[] = ['ratio', 'percentOf'];
export const DERIVE_REFUSES_BASE: readonly DeriveOperation[] = ['share', 'cumulative'];

export interface DeriveSpec {
  /** Name of the new field. */
  as: string;
  op: DeriveOperation;
  field: string;
  base?: string;
}

export type RollupAggregate = 'sum' | 'mean';
export const ROLLUP_AGGREGATES: readonly RollupAggregate[] = ['sum', 'mean'];

export interface RollupSpec {
  /** Numeric fields to total. */
  fields: string[];
  aggregate?: RollupAggregate;
  /** Text written into `labelField` on the total row; default `Total`. */
  label?: string;
  /** Field that carries the label; default the first field that is not totalled. */
  labelField?: string;
}

export interface SortKey {
  by: string;
  direction?: 'asc' | 'desc';
}

export interface TransformSpec {
  /** Up to 8 clauses, combined with AND; each has exactly one operator. */
  filter?: FilterClause[];
  groupBy?: GroupBySpec;
  /** Up to 8 derived fields, computed in order; a later one may read an earlier one. */
  derive?: DeriveSpec[];
  /** One key or up to 3 keys, applied in order. */
  sort?: SortKey | SortKey[];
  /** Fields to keep, in this order (up to 24). */
  select?: string[];
  /** Keep the first N rows (1–200). */
  limit?: number;
  /** One total row over the rows that remain, kept apart from them. */
  rollup?: RollupSpec;
}

export const TRANSFORM_LIMITS = {
  maxFilters: 8,
  maxSortKeys: 3,
  maxSelect: 24,
  maxDerive: 8,
  maxRollupFields: 12,
} as const;

export const DEFAULT_ROLLUP_LABEL = 'Total';

const SCALAR: PropSchema = {
  kind: 'json',
  description: 'A string, number, boolean, or null.',
  maxBytes: 1_000,
  schemaRef: '#/$defs/dataScalar',
};
const FIELD: PropSchema = { kind: 'string', required: true, maxLength: 64 };
const SORT_KEY: PropSchema = {
  kind: 'object',
  fields: {
    by: FIELD,
    direction: { kind: 'string', enum: ['asc', 'desc'], default: 'asc' },
  },
};

/** Prop schema for `transform`: used for validation, the JSON Schema, and describe. */
export const TRANSFORM_PROP_SCHEMA: PropSchema = {
  kind: 'object',
  description:
    'Bounded reshaping applied in a fixed order: filter, groupBy, derive, sort, select, limit, rollup. No expressions.',
  fields: {
    filter: {
      kind: 'list',
      minItems: 1,
      maxItems: TRANSFORM_LIMITS.maxFilters,
      description: 'Clauses combined with AND; each names a field and exactly one operator.',
      of: {
        kind: 'object',
        fields: {
          field: FIELD,
          equals: SCALAR,
          notEquals: SCALAR,
          in: { kind: 'list', of: SCALAR, minItems: 1, maxItems: 20 },
          gt: { kind: 'number' },
          gte: { kind: 'number' },
          lt: { kind: 'number' },
          lte: { kind: 'number' },
        },
      },
    },
    groupBy: {
      kind: 'object',
      description: 'One row per distinct value of `field`, in first-seen order.',
      fields: {
        field: FIELD,
        aggregate: { kind: 'string', required: true, enum: AGGREGATES },
        value: { kind: 'string', maxLength: 64, description: 'Numeric field to aggregate.' },
        as: { kind: 'string', maxLength: 64, description: 'Name of the aggregate field.' },
      },
    },
    derive: {
      kind: 'list',
      minItems: 1,
      maxItems: TRANSFORM_LIMITS.maxDerive,
      description:
        'New numeric fields, in order. ratio = field/base; percentOf = field/base*100; delta = field-base; percentChange = (field-base)/|base|*100; share = field/column total*100; cumulative = running sum. delta and percentChange without base use the previous row. A zero or missing operand gives null.',
      of: {
        kind: 'object',
        fields: {
          as: { kind: 'string', required: true, maxLength: 64, description: 'New field name.' },
          op: { kind: 'string', required: true, enum: DERIVE_OPERATIONS },
          field: FIELD,
          base: {
            kind: 'string',
            maxLength: 64,
            description:
              'Other operand; required by ratio and percentOf, refused by share and cumulative.',
          },
        },
      },
    },
    sort: {
      kind: 'oneOf',
      description: 'One sort key, or up to three applied in order. Sorting is stable.',
      options: [
        SORT_KEY,
        { kind: 'list', of: SORT_KEY, minItems: 1, maxItems: TRANSFORM_LIMITS.maxSortKeys },
      ],
    },
    select: {
      kind: 'list',
      of: { kind: 'string', maxLength: 64 },
      minItems: 1,
      maxItems: TRANSFORM_LIMITS.maxSelect,
      description: 'Fields to keep, in this order.',
    },
    limit: { kind: 'number', integer: true, min: 1, max: 200 },
    rollup: {
      kind: 'object',
      description:
        'One total row over the rows every other stage left. Only data-table shows it, in its footer, outside sorting and filtering.',
      fields: {
        fields: {
          kind: 'list',
          required: true,
          of: { kind: 'string', maxLength: 64 },
          minItems: 1,
          maxItems: TRANSFORM_LIMITS.maxRollupFields,
          description: 'Numeric fields to total; every other field is null on the total row.',
        },
        aggregate: { kind: 'string', enum: ROLLUP_AGGREGATES, default: 'sum' },
        label: { kind: 'string', maxLength: 40, default: DEFAULT_ROLLUP_LABEL },
        labelField: {
          kind: 'string',
          maxLength: 64,
          description: 'Field holding the label; default the first field not totalled.',
        },
      },
    },
  },
};

/** The output field name of a groupBy aggregate. */
export function aggregateField(groupBy: GroupBySpec): string {
  if (groupBy.as !== undefined) return groupBy.as;
  if (groupBy.aggregate === 'count' || groupBy.value === undefined) return 'count';
  return groupBy.value;
}

function typeRank(value: Exclude<DataScalar, null>): number {
  if (typeof value === 'number') return 0;
  if (typeof value === 'string') return 1;
  return 2;
}

/**
 * Compare two scalars for an ascending sort, ignoring nulls (callers place
 * nulls). Numbers compare numerically, strings by UTF-16 code unit, booleans
 * false before true, and across types number < string < boolean.
 */
function compareNonNull(left: Exclude<DataScalar, null>, right: Exclude<DataScalar, null>): number {
  const rankDifference = typeRank(left) - typeRank(right);
  if (rankDifference !== 0) return rankDifference;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (left === right) return 0;
  if (typeof left === 'boolean') return left ? 1 : -1;
  return left < right ? -1 : 1;
}

/** Comparator for one key: nulls sort last in both directions. */
export function compareScalars(
  left: DataScalar,
  right: DataScalar,
  direction: 'asc' | 'desc' = 'asc',
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const order = compareNonNull(left, right);
  return direction === 'desc' ? -order : order;
}

function matchesClause(row: DataRow, clause: FilterClause): boolean {
  const value = fieldValue(row, clause.field);
  if (clause.equals !== undefined) return value === clause.equals;
  if (clause.notEquals !== undefined) return value !== clause.notEquals;
  if (clause.in !== undefined) return clause.in.includes(value);
  if (typeof value !== 'number') return false;
  if (clause.gt !== undefined) return value > clause.gt;
  if (clause.gte !== undefined) return value >= clause.gte;
  if (clause.lt !== undefined) return value < clause.lt;
  if (clause.lte !== undefined) return value <= clause.lte;
  return true;
}

function numbersOf(rows: readonly DataRow[], field: string): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const value = fieldValue(row, field);
    if (typeof value === 'number') values.push(value);
  }
  return values;
}

function aggregate(rows: readonly DataRow[], groupBy: GroupBySpec): DataScalar {
  if (groupBy.aggregate === 'count') return rows.length;
  const values = numbersOf(rows, groupBy.value ?? '');
  if (groupBy.aggregate === 'sum') {
    return finiteOrNull(values.reduce((total, value) => total + value, 0));
  }
  if (values.length === 0) return null;
  if (groupBy.aggregate === 'mean') {
    // IEEE arithmetic, unrounded: only formatting rounds.
    return finiteOrNull(values.reduce((total, value) => total + value, 0) / values.length);
  }
  return groupBy.aggregate === 'min' ? Math.min(...values) : Math.max(...values);
}

function groupRows(rows: readonly DataRow[], groupBy: GroupBySpec): DataRow[] {
  const groups = new Map<string, { key: DataScalar; rows: DataRow[] }>();
  for (const row of rows) {
    const key = fieldValue(row, groupBy.field);
    // Type-tagged so the number 1 and the string "1" stay separate groups.
    const tag = `${key === null ? 'null' : typeof key}:${String(key)}`;
    const group = groups.get(tag);
    if (group === undefined) groups.set(tag, { key, rows: [row] });
    else group.rows.push(row);
  }
  const output = aggregateField(groupBy);
  return [...groups.values()].map((group) => ({
    [groupBy.field]: group.key,
    [output]: aggregate(group.rows, groupBy),
  }));
}

export function sortKeys(sort: TransformSpec['sort']): SortKey[] {
  if (sort === undefined) return [];
  return Array.isArray(sort) ? sort : [sort];
}

function sortRows(rows: readonly DataRow[], keys: readonly SortKey[]): DataRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      for (const key of keys) {
        const order = compareScalars(
          fieldValue(left.row, key.by),
          fieldValue(right.row, key.by),
          key.direction ?? 'asc',
        );
        if (order !== 0) return order;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

/**
 * Arithmetic on large finite inputs can overflow to Infinity, which is not a
 * dataset value; it reads as null like any other result that has no number.
 */
function finiteOrNull(value: DataScalar): DataScalar {
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

function numberOrNull(value: DataScalar): number | null {
  return typeof value === 'number' ? value : null;
}

/** Divide, or null when either operand is missing or the divisor is zero. */
function quotient(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function deriveValue(
  spec: DeriveSpec,
  row: DataRow,
  previous: DataRow | undefined,
  context: { total: number | null; running: number },
): DataScalar {
  const value = numberOrNull(fieldValue(row, spec.field));
  switch (spec.op) {
    case 'ratio':
      return quotient(value, numberOrNull(fieldValue(row, spec.base ?? '')));
    case 'percentOf': {
      const ratio = quotient(value, numberOrNull(fieldValue(row, spec.base ?? '')));
      return ratio === null ? null : ratio * 100;
    }
    case 'delta':
    case 'percentChange': {
      const baseRow = spec.base === undefined ? previous : row;
      const baseField = spec.base ?? spec.field;
      const base = baseRow === undefined ? null : numberOrNull(fieldValue(baseRow, baseField));
      if (value === null || base === null) return null;
      if (spec.op === 'delta') return value - base;
      const change = quotient(value - base, Math.abs(base));
      return change === null ? null : change * 100;
    }
    case 'share': {
      const share = quotient(value, context.total);
      return share === null ? null : share * 100;
    }
    default:
      // cumulative: a missing value adds nothing but keeps the running total.
      context.running += value ?? 0;
      return context.running;
  }
}

function deriveFields(rows: readonly DataRow[], specs: readonly DeriveSpec[]): DataRow[] {
  let result = rows.map((row) => ({ ...row }));
  for (const spec of specs) {
    const values = numbersOf(result, spec.field);
    const context = {
      total: values.length === 0 ? null : values.reduce((total, value) => total + value, 0),
      running: 0,
    };
    result = result.map((row, index) => {
      const value = finiteOrNull(deriveValue(spec, row, result[index - 1], context));
      // A computed key always defines an own property, and `as` is a validated field key.
      return { ...row, [spec.as]: value };
    });
  }
  return result;
}

/** The field that carries the total row's label. */
export function rollupLabelField(
  rollup: RollupSpec,
  fields: readonly string[],
): string | undefined {
  return rollup.labelField ?? fields.find((field) => !rollup.fields.includes(field));
}

/**
 * The total row a `rollup` describes, over the rows the other stages left. It
 * is kept apart from the rows, so sorting, searching and filtering never move
 * or hide it, and only a block that shows totals renders it.
 */
export function rollupRow(
  rows: readonly DataRow[],
  rollup: RollupSpec,
  fields: readonly string[],
): DataRow {
  const total: DataRow = Object.fromEntries(fields.map((field) => [field, null])) as DataRow;
  const labelField = rollupLabelField(rollup, fields);
  if (labelField !== undefined) total[labelField] = rollup.label ?? DEFAULT_ROLLUP_LABEL;
  for (const field of rollup.fields) {
    const values = numbersOf(rows, field);
    const sum = values.reduce((sum, value) => sum + value, 0);
    if (values.length === 0) total[field] = null;
    else total[field] = finiteOrNull(rollup.aggregate === 'mean' ? sum / values.length : sum);
  }
  return total;
}

function selectFields(rows: readonly DataRow[], fields: readonly string[]): DataRow[] {
  // fromEntries defines own properties, so no field name can reach a prototype.
  return rows.map(
    (row) => Object.fromEntries(fields.map((field) => [field, fieldValue(row, field)])) as DataRow,
  );
}

/**
 * Apply a validated transform. Pure: the input rows are never mutated.
 * Fixed order: filter → groupBy → derive → sort → select → limit. The
 * `rollup` total is not a row: `rollupRow` computes it apart.
 */
export function applyTransform(rows: DataRow[], spec: TransformSpec): DataRow[] {
  let result: DataRow[] = [...rows];
  if (spec.filter !== undefined && spec.filter.length > 0) {
    const clauses = spec.filter;
    result = result.filter((row) => clauses.every((clause) => matchesClause(row, clause)));
  }
  if (spec.groupBy !== undefined) result = groupRows(result, spec.groupBy);
  if (spec.derive !== undefined && spec.derive.length > 0)
    result = deriveFields(result, spec.derive);
  const keys = sortKeys(spec.sort);
  if (keys.length > 0) result = sortRows(result, keys);
  if (spec.select !== undefined) result = selectFields(result, spec.select);
  if (spec.limit !== undefined) result = result.slice(0, spec.limit);
  return result;
}
