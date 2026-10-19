/**
 * KPI citations: a metric card that names the dataset its number comes from.
 *
 * A KPI item may carry `cite: { dataRef, field, aggregate, transform, format }`.
 * The compiler reads the cited rows through the same bounded transform every
 * data-bound block uses, reduces one field with a closed aggregate, and then
 * either fills the card's `value` (when the author left it out) or checks the
 * authored `value` against it. A disagreement is a warning, never a silent
 * rewrite: the author decides which side is wrong.
 *
 * Nothing here evaluates an expression or guesses: each number in the authored
 * text is read with an optional scale suffix, and the text agrees when any of
 * them equals the cited value to the precision the author wrote. Reading every
 * number keeps a label such as "FY24 $1.2M" from being judged by its year.
 */

import { type DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import type { IrNode } from '../ir.js';
import { isPlainObject, type JsonValue } from '../json.js';
import type { PropSchema } from '../registry/prop-schema.js';
import { type DataRow, type DataScalar, fieldValue } from './dataset-types.js';
import { FORMAT_FIELDS, type FormatSpec, formatValue, type ValueFormat } from './format-value.js';
import { reportUnknownField, resolveBlockData } from './resolve-block-data.js';

export type CiteAggregate = 'last' | 'first' | 'sum' | 'mean' | 'min' | 'max' | 'count';
export const CITE_AGGREGATES: readonly CiteAggregate[] = [
  'last',
  'first',
  'sum',
  'mean',
  'min',
  'max',
  'count',
];

/** Prop schema for a KPI item's `cite`. */
export const KPI_CITE_SCHEMA: PropSchema = {
  kind: 'object',
  description:
    'Dataset this value comes from. Omit value to have the compiler fill it; set both to get a warning when they disagree.',
  fields: {
    dataRef: { kind: 'string', required: true, maxLength: 64, description: 'Dataset name.' },
    field: { kind: 'string', required: true, maxLength: 64, description: 'Field to read.' },
    aggregate: {
      kind: 'string',
      enum: CITE_AGGREGATES,
      default: 'last',
      description: 'How the rows reduce to one number; last = the final row.',
    },
    // Opaque here so describe stays short; resolveBlockData validates it
    // against the same schema a data block's own transform uses.
    transform: {
      kind: 'json',
      description: 'The bounded transform a data block takes, applied before the aggregate.',
      maxBytes: 8_000,
      schemaRef: '#/$defs/transform',
    },
    ...FORMAT_FIELDS,
    format: { ...(FORMAT_FIELDS.format as PropSchema), default: 'number' } as PropSchema,
  },
};

function numbersOf(rows: readonly DataRow[], field: string): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const value = fieldValue(row, field);
    if (typeof value === 'number') values.push(value);
  }
  return values;
}

/** Reduce the cited field. IEEE arithmetic, unrounded: only formatting rounds. */
export function citeAggregate(
  rows: readonly DataRow[],
  field: string,
  aggregate: CiteAggregate,
): DataScalar {
  if (aggregate === 'count') return rows.length;
  if (aggregate === 'first')
    return rows.length === 0 ? null : fieldValue(rows[0] as DataRow, field);
  if (aggregate === 'last') {
    return rows.length === 0 ? null : fieldValue(rows[rows.length - 1] as DataRow, field);
  }
  const values = numbersOf(rows, field);
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  if (aggregate === 'sum') return sum;
  if (aggregate === 'mean') return sum / values.length;
  return aggregate === 'min' ? Math.min(...values) : Math.max(...values);
}

const COMPACT_SCALE: Readonly<Record<string, number>> = {
  k: 1e3,
  K: 1e3,
  m: 1e6,
  M: 1e6,
  b: 1e9,
  B: 1e9,
  bn: 1e9,
  T: 1e12,
  thousand: 1e3,
  mn: 1e6,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};
const DURATION_SCALE: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1e3,
  sec: 1e3,
  min: 6e4,
  h: 3.6e6,
  hr: 3.6e6,
};
const BYTES_SCALE: Readonly<Record<string, number>> = {
  B: 1,
  kB: 1e3,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
};

function scaleTable(format: ValueFormat | undefined): Readonly<Record<string, number>> {
  if (format === 'duration') return DURATION_SCALE;
  if (format === 'bytes') return BYTES_SCALE;
  return COMPACT_SCALE;
}

// One number: an optional sign, up to four leading non-digit characters (a
// currency symbol), grouped or plain digits, then an optional word suffix.
const AUTHORED_NUMBER =
  /(?<sign>[-−])?[^\d\-−]{0,4}?(?<digits>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?<suffix>[A-Za-z]+)?/gu;

export interface AuthoredNumber {
  value: number;
  tolerance: number;
}

/**
 * Read every number in an authored metric with the precision it was written
 * to, in order. A suffix that is the cite's own unit is a label, not a scale.
 */
export function parseAuthoredNumbers(text: string, format: FormatSpec = {}): AuthoredNumber[] {
  const numbers: AuthoredNumber[] = [];
  for (const match of text.matchAll(AUTHORED_NUMBER)) {
    const digits = match.groups?.digits;
    if (digits === undefined) continue;
    const plain = digits.replace(/,/gu, '');
    const places = plain.includes('.') ? (plain.split('.')[1]?.length ?? 0) : 0;
    const suffix = match.groups?.suffix;
    const scale =
      suffix === undefined || suffix === format.unit ? 1 : (scaleTable(format.format)[suffix] ?? 1);
    const sign = match.groups?.sign === undefined ? 1 : -1;
    numbers.push({
      value: sign * Number(plain) * scale,
      // Half a unit in the last place the author wrote, scaled like the value.
      tolerance: 0.5 * 10 ** -places * scale,
    });
  }
  return numbers;
}

/** The first number in an authored metric, or undefined when it holds none. */
export function parseAuthoredNumber(
  text: string,
  format?: ValueFormat,
): AuthoredNumber | undefined {
  return parseAuthoredNumbers(text, format === undefined ? {} : { format })[0];
}

// The compiler joins a unit with a no-break space; an author types a plain one.
function sameText(left: string, right: string): boolean {
  const squash = (text: string) => text.replace(/[\s\u00a0\u202f]+/gu, ' ').trim();
  return squash(left) === squash(right);
}

/** Whether an authored value states the cited one, to the precision it was written. */
export function citeAgrees(authored: string, cited: DataScalar, format: FormatSpec): boolean {
  if (sameText(authored, formatValue(cited, format))) return true;
  if (typeof cited !== 'number') return sameText(authored, String(cited ?? ''));
  return parseAuthoredNumbers(authored, format).some(
    (parsed) => Math.abs(parsed.value - cited) <= parsed.tolerance + Math.abs(cited) * 1e-9,
  );
}

// Matches the kpi item's `value` maxLength in the roster.
const KPI_VALUE_MAX_LENGTH = 40;

function formatOf(cite: Record<string, JsonValue>): FormatSpec {
  const spec: FormatSpec = {};
  if (typeof cite.format === 'string') spec.format = cite.format as ValueFormat;
  if (typeof cite.unit === 'string') spec.unit = cite.unit;
  if (typeof cite.currency === 'string') spec.currency = cite.currency;
  if (typeof cite.decimals === 'number') spec.decimals = cite.decimals;
  if (cite.signed === true) spec.signed = true;
  return spec;
}

/**
 * Resolve every cited KPI item: fill an omitted value from the dataset, or
 * warn when an authored value disagrees with it. `rawItems` are the items as
 * authored, whose transform is read unvalidated-but-schema-checked, like a
 * block's own transform.
 */
export function resolveKpiCites(
  node: IrNode,
  rawItems: unknown,
  datasets: Record<string, DataRow[]>,
  bag: DiagnosticBag,
): void {
  const items = node.props.items;
  if (!Array.isArray(items)) return;
  const authored = Array.isArray(rawItems) ? rawItems : [];
  items.forEach((item, index) => {
    if (!isPlainObject(item)) return;
    const itemPath = pathIndex(pathKey(node.path, 'items'), index);
    const value = typeof item.value === 'string' && item.value !== '' ? item.value : undefined;
    const cite = isPlainObject(item.cite) ? item.cite : undefined;
    if (cite === undefined) {
      if (value === undefined) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: pathKey(itemPath, 'value'),
          message: 'a KPI item needs a "value" or a "cite" to compute it from',
          nodeId: node.id,
        });
      }
      return;
    }
    const citePath = pathKey(itemPath, 'cite');
    const rawItem = authored[index];
    const rawCite = isPlainObject(rawItem) && isPlainObject(rawItem.cite) ? rawItem.cite : {};
    const data = resolveBlockData(
      {
        dataRef: cite.dataRef,
        ...(rawCite.transform === undefined ? {} : { transform: rawCite.transform }),
      },
      datasets,
      citePath,
      bag,
    );
    if (data === undefined) return;
    const field = typeof cite.field === 'string' ? cite.field : '';
    const aggregate = (
      CITE_AGGREGATES.includes(cite.aggregate as CiteAggregate) ? cite.aggregate : 'last'
    ) as CiteAggregate;
    if (aggregate !== 'count' && !data.fields.includes(field)) {
      reportUnknownField(field, data, pathKey(citePath, 'field'), bag, node.id);
      return;
    }
    const cited = citeAggregate(data.rows, field, aggregate);
    const format = formatOf(cite);
    const expected = formatValue(cited, format);
    const details = {
      rule: 'kpi-cite',
      dataRef: data.source,
      field,
      aggregate,
      cited,
      expected,
    };
    if (value === undefined) {
      if (expected.length > KPI_VALUE_MAX_LENGTH) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: citePath,
          message: `the cited ${aggregate} of "${field}" reads ${expected}, longer than the ${KPI_VALUE_MAX_LENGTH} characters a KPI value holds; cite a shorter field or set value`,
          nodeId: node.id,
          details,
        });
        return;
      }
      item.value = expected;
      if (cited === null) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          severity: 'warning',
          path: citePath,
          message: `the cited ${aggregate} of "${field}" has no value, so the card shows ${expected}`,
          nodeId: node.id,
          details,
        });
      }
      return;
    }
    if (citeAgrees(value, cited, format)) return;
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: pathKey(itemPath, 'value'),
      message: `"${value}" disagrees with the cited ${aggregate} of "${field}" in dataset "${data.source}", which reads ${expected}; fix the value or the cite, or omit value to use the dataset`,
      nodeId: node.id,
      details: { ...details, authored: value },
    });
  });
}
