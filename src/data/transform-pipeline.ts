/**
 * Bounded, deterministic dataset transforms.
 *
 * A transform is data, not an expression: a fixed pipeline of five optional
 * stages that always run in the same order (filter → groupBy → sort → select →
 * limit). Comparison never consults a locale, and sorting is stable, so the same
 * rows and the same transform always produce the same rows in the same order.
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

export interface SortKey {
  by: string;
  direction?: 'asc' | 'desc';
}

export interface TransformSpec {
  /** Up to 8 clauses, combined with AND; each has exactly one operator. */
  filter?: FilterClause[];
  groupBy?: GroupBySpec;
  /** One key or up to 3 keys, applied in order. */
  sort?: SortKey | SortKey[];
  /** Fields to keep, in this order (up to 24). */
  select?: string[];
  /** Keep the first N rows (1–200). */
  limit?: number;
}

export const TRANSFORM_LIMITS = { maxFilters: 8, maxSortKeys: 3, maxSelect: 24 } as const;

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
    'Bounded reshaping applied in a fixed order: filter, groupBy, sort, select, limit. No expressions.',
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
  if (groupBy.aggregate === 'sum') return values.reduce((total, value) => total + value, 0);
  if (values.length === 0) return null;
  if (groupBy.aggregate === 'mean') {
    // IEEE arithmetic, unrounded: only formatting rounds.
    return values.reduce((total, value) => total + value, 0) / values.length;
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

function selectFields(rows: readonly DataRow[], fields: readonly string[]): DataRow[] {
  return rows.map((row) => {
    const selected: DataRow = {};
    for (const field of fields) selected[field] = fieldValue(row, field);
    return selected;
  });
}

/**
 * Apply a validated transform. Pure: the input rows are never mutated.
 * Fixed order: filter → groupBy → sort → select → limit.
 */
export function applyTransform(rows: DataRow[], spec: TransformSpec): DataRow[] {
  let result: DataRow[] = [...rows];
  if (spec.filter !== undefined && spec.filter.length > 0) {
    const clauses = spec.filter;
    result = result.filter((row) => clauses.every((clause) => matchesClause(row, clause)));
  }
  if (spec.groupBy !== undefined) result = groupRows(result, spec.groupBy);
  const keys = sortKeys(spec.sort);
  if (keys.length > 0) result = sortRows(result, keys);
  if (spec.select !== undefined) result = selectFields(result, spec.select);
  if (spec.limit !== undefined) result = result.slice(0, spec.limit);
  return result;
}
