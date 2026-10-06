/**
 * Data table cells: one renderer per column type.
 *
 * Every value goes through `formatValue`, so a cell reads like the same value
 * in a chart or a metric. Each cell also carries its raw value in `data-sort`,
 * which the sort runtime compares, so sorting never depends on display text.
 */

import { type DataRow, type DataScalar, fieldValue } from '../../data/dataset-types.js';
import { EMPTY_VALUE, formatValue } from '../../data/format-value.js';
import { DiagnosticBag } from '../../diagnostics.js';
import { urlProp } from '../../registry/define-helpers.js';
import { validateProp } from '../../registry/prop-schema.js';
import {
  type AttributeValue,
  escapeText,
  escapeUrl,
  renderAttributes,
} from '../../render/escape.js';
import { sparkPaths } from '../../render/showcase-blocks.js';
import { toneBadge } from '../../render/tone.js';
import type { DataColumn } from './data-table-columns.js';

/** The sparkline drawing space `sparkPaths` plots into (its 120×36 box). */
const SPARK_VIEWBOX = '0 0 120 36';

const LINK_SCHEMA = urlProp();

/**
 * Test and run outcomes, which status columns are mostly made of. They extend
 * the shared value tones for badge cells only; an authored `tones` map wins.
 */
const OUTCOME_TONES: Readonly<Record<string, string>> = {
  pass: 'success',
  passed: 'success',
  ok: 'success',
  fail: 'danger',
  failed: 'danger',
  error: 'danger',
  flaky: 'warning',
  skipped: 'neutral',
};

/** Types whose cells read as one unit and so never wrap. */
const UNBROKEN_TYPES: ReadonlySet<string> = new Set([
  'number',
  'percent',
  'currency',
  'date',
  'badge',
  'progress',
  'sparkline',
]);

/**
 * The value as a link target when it passes the same URL policy as every URL
 * prop (relative, https, http or mailto); undefined otherwise.
 */
export function safeHref(value: DataScalar): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const probe = new DiagnosticBag();
  validateProp(LINK_SCHEMA, value, '', probe);
  return probe.size === 0 ? value : undefined;
}

/** The raw value the sort runtime compares; undefined for an empty cell. */
export function sortValue(value: DataScalar): string | undefined {
  return value === null ? undefined : String(value);
}

function numericValues(row: DataRow, fields: readonly string[]): number[] {
  const values: number[] = [];
  for (const field of fields) {
    const value = fieldValue(row, field);
    if (typeof value === 'number') values.push(value);
  }
  return values;
}

function badge(column: DataColumn, value: DataScalar): string {
  if (value === null) return EMPTY_VALUE;
  const text = formatValue(value, column.format);
  const raw = String(value);
  const word = raw.trim().toLowerCase();
  const tone = Object.hasOwn(column.tones, raw)
    ? column.tones[raw]
    : Object.hasOwn(OUTCOME_TONES, word)
      ? OUTCOME_TONES[word]
      : undefined;
  if (tone === undefined) return toneBadge(text);
  return `<span class="ak-badge" data-tone="${tone}">${escapeText(text)}</span>`;
}

function link(column: DataColumn, row: DataRow, value: DataScalar): string {
  const text = escapeText(formatValue(value, column.format));
  const href = safeHref(fieldValue(row, column.hrefField));
  if (href === undefined) return text;
  return `<a${renderAttributes({ href: escapeUrl(href), rel: 'noreferrer noopener' })}>${text}</a>`;
}

function progress(column: DataColumn, value: DataScalar): string {
  if (typeof value !== 'number') return escapeText(formatValue(value, column.format));
  // The meter is the picture; the text beside it carries the value.
  return `<span class="ak-dt-progress"><meter${renderAttributes({
    min: 0,
    max: column.max,
    value: Math.min(Math.max(value, 0), column.max),
    'aria-hidden': 'true',
  })}></meter><span>${escapeText(formatValue(value, column.format))}</span></span>`;
}

function sparkline(column: DataColumn, row: DataRow): string {
  const values = numericValues(row, column.fields);
  if (values.length < 2) return EMPTY_VALUE;
  const paths = sparkPaths(values);
  const spoken = values.map((value) => formatValue(value, column.format)).join(', ');
  return [
    `<svg class="ak-dt-spark" viewBox="${SPARK_VIEWBOX}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`,
    `<path class="ak-dt-spark-area" d="${paths.area}" />`,
    `<path class="ak-dt-spark-line" d="${paths.line}" vector-effect="non-scaling-stroke" />`,
    '</svg>',
    `<span class="ak-sr">${escapeText(spoken)}</span>`,
  ].join('');
}

/** The inner markup of one cell. */
export function cellContent(column: DataColumn, row: DataRow): string {
  const value = fieldValue(row, column.key);
  switch (column.type) {
    case 'badge':
      return badge(column, value);
    case 'link':
      return link(column, row, value);
    case 'progress':
      return progress(column, value);
    case 'sparkline':
      return sparkline(column, row);
    default:
      return escapeText(formatValue(value, column.format));
  }
}

/** Alignment class shared by a column's header and its cells. */
export function alignClass(column: DataColumn): string | undefined {
  if (column.align === 'end') return 'ak-num';
  return column.align === 'center' ? 'ak-dt-center' : undefined;
}

/**
 * One body cell. The first column is the row header, which the card layout on
 * narrow screens also uses as the card's title.
 */
export function renderCell(column: DataColumn, row: DataRow, first: boolean): string {
  const classes = [alignClass(column), UNBROKEN_TYPES.has(column.type) ? 'ak-dt-nowrap' : undefined]
    .filter((name) => name !== undefined)
    .join(' ');
  const attributes: AttributeValue = {
    class: classes === '' ? undefined : classes,
    'data-label': column.label,
    'data-sort': sortValue(fieldValue(row, column.key)),
  };
  if (first) attributes.scope = 'row';
  const tag = first ? 'th' : 'td';
  return `<${tag}${renderAttributes(attributes)}>${cellContent(column, row)}</${tag}>`;
}
