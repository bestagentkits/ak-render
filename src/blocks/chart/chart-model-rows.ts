/**
 * Bound rows to chart data: x values in first-seen order, one series per
 * distinct `series.field` value (or one named after the magnitude), and the
 * fallback table of the rows themselves, formatted like the axes.
 */

import { fieldValue } from '../../data/dataset-types.js';
import { type FormatSpec, formatValue } from '../../data/format-value.js';
import type { IrNode } from '../../ir.js';
import type { JsonValue } from '../../json.js';
import { stringProp } from '../../render/block-helpers.js';
import type { ChartPoint, ChartSeries, ChartTable, HeatCell } from '../../render/chart-types.js';
import { type EncodingProp, encodingProp, formatSpec, seriesField } from './chart-encodings.js';
import { NUMERIC_X_KINDS, SINGLE_SERIES_KINDS } from './chart-kinds.js';

/** First-seen distinct values of a field, keyed by their JSON form, with display labels. */
class Categories {
  readonly labels: string[] = [];
  readonly raw: string[] = [];
  private readonly index = new Map<string, number>();
  constructor(private readonly spec: FormatSpec) {}
  add(value: JsonValue): number {
    const key = JSON.stringify(value);
    const known = this.index.get(key);
    if (known !== undefined) return known;
    const position = this.labels.length;
    this.index.set(key, position);
    this.labels.push(
      value === null ? '—' : formatValue(value as string | number | boolean, this.spec),
    );
    this.raw.push(value === null ? '' : String(value));
    return position;
  }
}

function numeric(value: JsonValue): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The fallback table: the bound rows, one column per encoded field. */
export function rowsTable(node: IrNode, magnitudeKey: string): ChartTable | undefined {
  const data = node.data;
  if (data === undefined) return undefined;
  const columns: { field: string; label: string; spec: FormatSpec; numeric: boolean }[] = [];
  const add = (prop: EncodingProp | undefined, field: string | undefined, isNumber: boolean) => {
    if (field === undefined || columns.some((column) => column.field === field)) return;
    columns.push({ field, label: prop?.label ?? field, spec: formatSpec(prop), numeric: isNumber });
  };
  const kind = stringProp(node, 'kind');
  const x = encodingProp(node, 'x');
  add(x, x?.field, NUMERIC_X_KINDS.includes(kind));
  add(undefined, seriesField(node), false);
  if (kind === 'heatmap' || kind === 'scatter') {
    const y = encodingProp(node, 'y');
    add(y, y?.field, kind === 'scatter');
  }
  const magnitude = encodingProp(node, magnitudeKey);
  add(magnitude, magnitude?.field, true);
  if (columns.length === 0) return undefined;
  return {
    columns: columns.map((column) => ({ label: column.label, numeric: column.numeric })),
    rows: data.rows.map((row) =>
      columns.map((column) => formatValue(fieldValue(row, column.field), column.spec)),
    ),
  };
}

/** Labels, series and kind-specific marks derived from rows or inline props. */
export interface Derived {
  labels: string[];
  series: ChartSeries[];
  points: ChartPoint[];
  cells: HeatCell[];
  rowLabels: string[];
  samples: number[];
  /** Raw x value (as text) to its display label, for overlay matching. */
  rawToLabel: Map<string, string>;
}

/** Derive a bound chart's labels and series (or points, cells, samples) from its rows. */
export function deriveFromRows(node: IrNode, magnitudeKey: string): Derived {
  const kind = stringProp(node, 'kind');
  const rows = node.data?.rows ?? [];
  const x = encodingProp(node, 'x');
  const y = encodingProp(node, 'y');
  const magnitude = encodingProp(node, magnitudeKey);
  const groupField = SINGLE_SERIES_KINDS.includes(kind) ? undefined : seriesField(node);
  const columns = new Categories(formatSpec(x));
  const groups = new Categories({});
  const derived: Derived = {
    labels: columns.labels,
    series: [],
    points: [],
    cells: [],
    rowLabels: [],
    samples: [],
    rawToLabel: new Map(),
  };
  const read = (row: (typeof rows)[number], field: string | undefined): JsonValue =>
    field === undefined ? null : fieldValue(row, field);
  const fallbackName = magnitude?.label ?? magnitude?.field ?? y?.label ?? 'Value';

  if (kind === 'histogram') {
    for (const row of rows) {
      const value = numeric(read(row, x?.field));
      if (value !== undefined) derived.samples.push(value);
    }
    derived.series = [{ label: x?.label ?? x?.field ?? 'Values', values: [] }];
    return derived;
  }
  if (kind === 'scatter') {
    for (const row of rows) {
      const px = numeric(read(row, x?.field));
      const py = numeric(read(row, y?.field));
      if (px === undefined || py === undefined) continue;
      const series = groupField === undefined ? 0 : groups.add(read(row, groupField));
      derived.points.push({ x: px, y: py, series });
    }
    derived.series = (groupField === undefined ? [y?.label ?? 'Points'] : groups.labels).map(
      (label) => ({ label, values: [] }),
    );
    return derived;
  }
  if (kind === 'heatmap') {
    const rowCategories = new Categories(formatSpec(y));
    const sums = new Map<string, HeatCell>();
    for (const row of rows) {
      const value = numeric(read(row, magnitude?.field));
      const column = columns.add(read(row, x?.field));
      const line = rowCategories.add(read(row, y?.field));
      if (value === undefined) continue;
      const key = `${line}:${column}`;
      const cell = sums.get(key);
      if (cell === undefined) sums.set(key, { column, row: line, value });
      else cell.value += value;
    }
    derived.cells = [...sums.values()];
    derived.rowLabels = rowCategories.labels;
    derived.series = [{ label: fallbackName, values: [] }];
    return derived;
  }
  if (kind === 'gauge') {
    const first = rows[0];
    const value = first === undefined ? undefined : numeric(read(first, magnitude?.field));
    const name = magnitude?.label ?? magnitude?.field ?? 'Value';
    derived.labels.push(name);
    derived.series = [{ label: name, values: value === undefined ? [] : [value] }];
    return derived;
  }

  const matrix: number[][] = [];
  for (const row of rows) {
    const column = columns.add(read(row, x?.field));
    const series = groupField === undefined ? 0 : groups.add(read(row, groupField));
    const value = numeric(read(row, magnitude?.field)) ?? 0;
    const line = matrix[series] ?? [];
    matrix[series] = line;
    line[column] = (line[column] ?? 0) + value;
  }
  const names = groupField === undefined ? [fallbackName] : groups.labels;
  derived.series = names.map((label, index) => ({
    label,
    values: columns.labels.map((_, column) => matrix[index]?.[column] ?? 0),
  }));
  columns.raw.forEach((raw, index) => {
    derived.rawToLabel.set(raw, columns.labels[index] ?? raw);
  });
  return derived;
}
