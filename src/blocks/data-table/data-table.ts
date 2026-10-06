/**
 * Data table block: a typed, sortable and searchable table bound to a dataset.
 *
 * The compiler owns the behaviors: sorting is on every column, search appears
 * past 10 rows (unless a filter-bar targets the table), the header sticks past
 * 12, and phones get labelled cards. The
 * emitted table is complete without scripts, in the authored (and
 * transformed) row order.
 */

import { type DataRow, fieldValue } from '../../data/dataset-types.js';
import type { IrNode } from '../../ir.js';
import type { BlockModule } from '../../registry/block-module.js';
import { anchorProps, define, list, OPTIONAL_TITLE, str } from '../../registry/define-helpers.js';
import {
  element,
  filterRowAttributes,
  nodeAttributes,
  stringProp,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeText, renderAttributes } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { FILTER_BAR_TYPE } from '../controls/control-shared.js';
import { alignClass, renderCell, sortValue } from './data-table-cells.js';
import { checkDataTable } from './data-table-check.js';
import {
  COLUMN_SCHEMA,
  type DataColumn,
  MAX_COLUMNS,
  resolveColumns,
} from './data-table-columns.js';

/** Search appears when a table has more rows than this. */
export const SEARCH_THRESHOLD = 10;
/** The header sticks when a table has more rows than this. */
export const STICKY_THRESHOLD = 12;

export const DATA_TABLE_FEATURE = 'data-table';

const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

/** Compare two raw cell values the way the sort runtime does. */
function compareRaw(a: string, b: string, numeric: boolean): number {
  if (numeric) return Number(a) - Number(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The column the rows already arrive sorted by, so the header can say so. The
 * transform itself does not reach the IR, so this reads the order from the
 * rows: the first column whose values (at least 3 rows, no empty cell, two or
 * more distinct values) run in one direction. Whatever it reports is true of
 * the emitted rows.
 */
function initialSort(
  rows: readonly DataRow[],
  columns: readonly DataColumn[],
): Map<number, string> {
  const marks = new Map<number, string>();
  if (rows.length < 3) return marks;
  for (const [index, column] of columns.entries()) {
    const values = rows.map((row) => sortValue(fieldValue(row, column.key)));
    if (values.some((value) => value === undefined)) continue;
    const raw = values as string[];
    const numeric = raw.every((value) => NUMERIC_TEXT.test(value));
    let ascending = true;
    let descending = true;
    for (let position = 1; position < raw.length; position += 1) {
      const order = compareRaw(raw[position - 1] as string, raw[position] as string, numeric);
      if (order > 0) ascending = false;
      if (order < 0) descending = false;
    }
    if (ascending === descending) continue;
    marks.set(index, ascending ? 'ascending' : 'descending');
    return marks;
  }
  return marks;
}

function caption(node: IrNode): string {
  const title = stringProp(node, 'title');
  const text = stringProp(node, 'caption');
  // A visible heading already names the table: the caption then only speaks,
  // unless it says something the heading does not.
  if (text === '' && title === '') return '';
  if (text === '' || text === title) return `<caption class="ak-sr">${escapeText(title)}</caption>`;
  return `<caption>${escapeText(text)}</caption>`;
}

function tools(node: IrNode, rows: number): string {
  const label = stringProp(node, 'title', 'table');
  // Node ids are unique on the page, so the input id is too.
  const id = `${node.id}-search`;
  return [
    '<div class="ak-dt-tools">',
    `<label${renderAttributes({ class: 'ak-dt-search', for: id })}><span class="ak-sr">Search ${escapeText(label)}</span>`,
    `<input${renderAttributes({ id, type: 'search', placeholder: 'Search rows', autocomplete: 'off', 'data-ak-dt-search': true })} /></label>`,
    `<p class="ak-dt-count" data-ak-dt-count>${rows} rows</p>`,
    '</div>',
  ].join('');
}

/**
 * True when a filter-bar on the page targets this table. The bar then owns row
 * filtering (it offers its own search child), so the table emits no search box
 * of its own: two independent filters over the same rows would fight, the
 * last one to run winning. Decided at compile time from the IR.
 */
function filteredByBar(node: IrNode, context: RenderContext): boolean {
  return context.ir.nodes.some(
    (other) => other.type === FILTER_BAR_TYPE && other.props.target === node.id,
  );
}

function render(node: IrNode, context: RenderContext): string {
  const columns = resolveColumns(node);
  const rows = node.data?.rows ?? [];
  const sorted = initialSort(rows, columns);
  const head = columns
    .map(
      (column, index) =>
        `<th${renderAttributes({
          scope: 'col',
          class: alignClass(column),
          'aria-sort': sorted.get(index),
        })}>${escapeText(column.label)}</th>`,
    )
    .join('');
  const body = rows
    .map(
      (row) =>
        `<tr${renderAttributes(filterRowAttributes(row))}>${columns
          .map((column, index) => renderCell(column, row, index === 0))
          .join('')}</tr>`,
    )
    .join('');
  const searchable = rows.length > SEARCH_THRESHOLD && !filteredByBar(node, context);
  const empty =
    rows.length === 0
      ? '<p class="ak-dt-empty">No rows.</p>'
      : searchable
        ? '<p class="ak-dt-empty" data-ak-dt-empty hidden>No rows match the search.</p>'
        : '';
  return element(
    'section',
    nodeAttributes(node, {
      class: 'ak-block ak-data-table',
      'data-ak-data-table': true,
      'data-ak-sticky': rows.length > STICKY_THRESHOLD,
    }),
    [
      titleHeader(node),
      searchable ? tools(node, rows.length) : '',
      `<div class="ak-table-wrap"><table>${caption(node)}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      empty,
    ].join(''),
  );
}

export const dataTableBlock: BlockModule = {
  definition: define({
    type: 'data-table',
    kind: 'semantic',
    category: 'data',
    tags: ['table', 'dataset', 'sort', 'filter', 'metrics'],
    useCases: ['benchmark results', 'run history', 'ranked metrics', 'status inventory'],
    purpose: 'Typed, sortable, searchable table of dataset rows.',
    summary:
      'Data table: typed columns (number, percent, badge, link, progress, sparkline), sort, search.',
    data: { required: true, description: 'Rows to list; each column reads one field.' },
    filterable: true,
    props: {
      title: OPTIONAL_TITLE,
      caption: str({
        maxLength: 200,
        description: 'Table caption; spoken only when it repeats the title.',
      }),
      columns: list(COLUMN_SCHEMA, {
        minItems: 1,
        maxItems: MAX_COLUMNS,
        description: 'Omitted: the first 8 data fields.',
      }),
      ...anchorProps,
    },
    runtimeFeatures: [DATA_TABLE_FEATURE],
    a11y: 'A real <table> with column and row headers and a caption; sort buttons set aria-sort and announce the order; search announces the row count.',
    serializer: 'Serializes to its columns and data binding, never to rendered rows.',
  }),
  render,
  check: checkDataTable,
};
