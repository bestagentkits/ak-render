/**
 * Dataset types and limits.
 *
 * A dataset is a short, flat table of scalar rows declared once in the spec
 * envelope (`datasets`) or inline on a block (`data`). Blocks reference it by
 * name (`dataRef`) and may reshape it with a bounded transform, so a chart, a
 * table and a metric can share one copy of the numbers instead of repeating
 * them.
 */

/** The only cell values a dataset may hold. Objects and lists are rejected. */
export type DataScalar = string | number | boolean | null;

/** One dataset row: field name to scalar value. */
export type DataRow = Record<string, DataScalar>;

/** Bounds every dataset and inline `data` list must respect. */
export const DATA_LIMITS = {
  /** Named datasets in one spec. */
  maxDatasets: 20,
  /** Rows in one dataset or inline `data` list. */
  maxRows: 200,
  /** Distinct fields across the rows of one dataset. */
  maxFields: 32,
  /** Length of one string cell. */
  maxStringLength: 400,
  /**
   * Largest magnitude of a number cell, and the smallest non-zero one. Inside
   * these bounds no sum, range or scale a chart computes overflows to
   * Infinity, and no tick step underflows to 0.
   */
  maxMagnitude: 1e100,
  minMagnitude: 1e-100,
} as const;

/**
 * Why a number cannot be charted, or undefined when it can: it must be 0 or
 * have a magnitude between `DATA_LIMITS.minMagnitude` and `maxMagnitude`.
 */
export function numberMagnitudeProblem(value: number): string | undefined {
  const magnitude = Math.abs(value);
  if (
    value === 0 ||
    (magnitude >= DATA_LIMITS.minMagnitude && magnitude <= DATA_LIMITS.maxMagnitude)
  ) {
    return undefined;
  }
  return `number ${value} is out of range: use 0 or a magnitude from ${DATA_LIMITS.minMagnitude} to ${DATA_LIMITS.maxMagnitude}, so a chart can scale it (rescale the unit, e.g. store millions)`;
}

/**
 * Field keys: an identifier that may also contain dashes. Dataset names follow
 * the node id pattern (`NODE_ID_PATTERN`).
 */
// Object.prototype's own names are refused: a row is a plain object, and
// `__proto__` as a key would replace the row's prototype instead of naming a cell.
export const FIELD_KEY_PATTERN =
  /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/** Rows a block resolved from `dataRef` or `data`, after its transform. */
export interface MaterializedData {
  /** Dataset name, or null for inline `data`. */
  source: string | null;
  /**
   * Fields available to the block, in first-seen order. Derived from the
   * source rows and the transform stages (groupBy and select reshape it), so a
   * filter that removes every row does not also remove the field list.
   */
  fields: string[];
  rows: DataRow[];
  /** The `transform.rollup` total, kept apart from `rows`; only a block that shows totals takes one. */
  total?: DataRow;
}

export function isDataScalar(value: unknown): value is DataScalar {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  return type === 'number' && Number.isFinite(value as number);
}

/** Union of row keys in first-seen order. */
export function fieldsOf(rows: readonly DataRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return [...seen];
}

/** A row's value for a field; a missing field reads as null. */
export function fieldValue(row: DataRow, field: string): DataScalar {
  return Object.hasOwn(row, field) ? (row[field] ?? null) : null;
}
