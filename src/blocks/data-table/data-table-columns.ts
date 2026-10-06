/**
 * Data table columns: the authored column schema and the resolved column
 * model the cell renderers read.
 *
 * A column names one data field (`key`) and a semantic `type`; the type picks
 * the default value format and alignment, so an author states meaning and the
 * compiler decides presentation. When no columns are authored they are derived
 * from the data's fields.
 */

import { fieldValue, type MaterializedData } from '../../data/dataset-types.js';
import {
  FORMAT_FIELDS,
  type FormatSpec,
  VALUE_FORMATS,
  type ValueFormat,
} from '../../data/format-value.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import { enumStr, list, num, obj, str } from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';
import { objectListProp } from '../../render/block-helpers.js';

export const COLUMN_TYPES = [
  'text',
  'number',
  'percent',
  'currency',
  'date',
  'badge',
  'link',
  'progress',
  'sparkline',
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

/** Accepted spellings that resolve to a canonical type. */
const TYPE_ALIASES: Readonly<Record<string, ColumnType>> = { percentage: 'percent' };

export const BADGE_TONES = ['success', 'danger', 'warning', 'info', 'neutral'] as const;

export const COLUMN_ALIGNS = ['start', 'end', 'center'] as const;
export type ColumnAlign = (typeof COLUMN_ALIGNS)[number];

/** Columns shown when none are authored. */
export const DERIVED_COLUMN_LIMIT = 8;
export const MAX_COLUMNS = 12;

const FIELD = str({ maxLength: 64 });

const DEFAULT_FORMAT: Readonly<Record<ColumnType, ValueFormat>> = {
  text: 'text',
  number: 'number',
  percent: 'percent',
  currency: 'currency',
  date: 'date',
  badge: 'text',
  link: 'text',
  progress: 'number',
  sparkline: 'number',
};

const NUMERIC_TYPES: ReadonlySet<ColumnType> = new Set([
  'number',
  'percent',
  'currency',
  'progress',
  'sparkline',
]);

export const COLUMN_SCHEMA: PropSchema = obj({
  key: str({ required: true, maxLength: 64, description: 'Data field shown in this column.' }),
  label: str({ maxLength: 80, description: 'Header text; defaults to the key.' }),
  type: enumStr([...COLUMN_TYPES, ...Object.keys(TYPE_ALIASES)], {
    default: 'text',
    description: 'Picks the default format and alignment. percentage = percent.',
  }),
  // No default: an omitted format means "the type's format".
  format: {
    kind: 'string',
    enum: VALUE_FORMATS,
    description: 'Overrides the type format. percent takes 87 for 87%.',
  },
  unit: FORMAT_FIELDS.unit as PropSchema,
  currency: FORMAT_FIELDS.currency as PropSchema,
  decimals: FORMAT_FIELDS.decimals as PropSchema,
  align: enumStr(COLUMN_ALIGNS, { description: 'Default: end for numeric types.' }),
  hrefField: str({ maxLength: 64, description: 'link: field holding the URL; default key.' }),
  max: num({ min: 0, description: 'progress: scale maximum (default 100).' }),
  fields: list(FIELD, {
    minItems: 2,
    maxItems: 24,
    description: 'sparkline: numeric fields, oldest first.',
  }),
  tones: {
    kind: 'record',
    of: enumStr(BADGE_TONES),
    maxKeys: 12,
    description: 'badge: value to tone.',
  },
});

export interface DataColumn {
  key: string;
  label: string;
  type: ColumnType;
  format: FormatSpec;
  align: ColumnAlign;
  /** link: the field that holds each row's URL. */
  hrefField: string;
  /** progress: the scale maximum. */
  max: number;
  /** sparkline: the series fields. */
  fields: string[];
  /** badge: exact value to tone. */
  tones: Record<string, string>;
}

export function columnType(value: JsonValue | undefined): ColumnType {
  if (typeof value !== 'string') return 'text';
  if ((COLUMN_TYPES as readonly string[]).includes(value)) return value as ColumnType;
  return TYPE_ALIASES[value] ?? 'text';
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || typeof value === 'number';
}

/** A derived column is numeric when every present value is a number. */
function derivedType(data: MaterializedData, key: string): ColumnType {
  const values = data.rows.map((row) => fieldValue(row, key));
  const numeric = values.some((value) => value !== null) && values.every(isNumberOrNull);
  return numeric ? 'number' : 'text';
}

function stringList(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toneMap(value: JsonValue | undefined): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const tones: Record<string, string> = {};
  for (const [key, tone] of Object.entries(value)) {
    if (typeof tone === 'string') tones[key] = tone;
  }
  return tones;
}

function formatSpec(column: Record<string, JsonValue>, type: ColumnType): FormatSpec {
  const spec: FormatSpec = {
    format:
      typeof column.format === 'string' ? (column.format as ValueFormat) : DEFAULT_FORMAT[type],
  };
  if (typeof column.unit === 'string') spec.unit = column.unit;
  if (typeof column.currency === 'string') spec.currency = column.currency;
  if (typeof column.decimals === 'number') spec.decimals = column.decimals;
  return spec;
}

function resolveColumn(column: Record<string, JsonValue>): DataColumn {
  const key = typeof column.key === 'string' ? column.key : '';
  const type = columnType(column.type);
  const align = typeof column.align === 'string' ? (column.align as ColumnAlign) : undefined;
  const max = typeof column.max === 'number' && column.max > 0 ? column.max : 100;
  return {
    key,
    label: typeof column.label === 'string' && column.label !== '' ? column.label : key,
    type,
    format: formatSpec(column, type),
    align: align ?? (NUMERIC_TYPES.has(type) ? 'end' : 'start'),
    hrefField: typeof column.hrefField === 'string' ? column.hrefField : key,
    max,
    fields: stringList(column.fields),
    tones: toneMap(column.tones),
  };
}

/** The authored columns, or columns derived from the first fields of the data. */
export function resolveColumns(node: IrNode): DataColumn[] {
  const authored = objectListProp(node, 'columns');
  if (authored.length > 0) return authored.map(resolveColumn);
  const data = node.data;
  if (data === undefined) return [];
  return data.fields
    .slice(0, DERIVED_COLUMN_LIMIT)
    .map((key) => resolveColumn({ key, type: derivedType(data, key) }));
}
