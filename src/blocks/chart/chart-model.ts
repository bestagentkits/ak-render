/**
 * Turn a chart node into a `ChartInput`.
 *
 * Inline charts read `labels`/`series`. Bound charts derive them from the
 * materialized rows: x values in first-seen order, and either one series per
 * distinct `series.field` value or one series named after the magnitude
 * encoding. The same resolution backs the block's checks, so the render and
 * the diagnostics never disagree about what the chart shows.
 */

import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import { listProp, numProp, objectListProp, str, stringProp } from '../../render/block-helpers.js';
import type { ChartInput, ChartSeries, EncodedChart } from '../../render/chart-types.js';
import { axisSpec, encodingProp, magnitudeEncoding } from './chart-encodings.js';
import { CARTESIAN_KINDS, NUMERIC_X_KINDS, SORTABLE_KINDS, V1_CHART_KINDS } from './chart-kinds.js';
import { type Derived, deriveFromRows, rowsTable } from './chart-model-rows.js';

/** True when the chart needs the encoded renderer rather than the original markup. */
export function isEncoded(node: IrNode): boolean {
  const kind = stringProp(node, 'kind');
  if (!V1_CHART_KINDS.includes(kind) || node.data !== undefined) return true;
  return (
    ['x', 'y', 'value', 'bins', 'sort', 'target'].some((key) => node.props[key] !== undefined) ||
    listProp(node, 'markers').length > 0 ||
    listProp(node, 'annotations').length > 0 ||
    isPlainObject(node.props.series)
  );
}

function inlineSeries(node: IrNode): ChartSeries[] {
  return objectListProp(node, 'series').map((entry) => ({
    label: str(entry.label),
    values: (Array.isArray(entry.values) ? entry.values : []).map((value) => numProp(value, 0)),
  }));
}

/** Reorder categories by their total across series. Stable, so ties keep their order. */
function sortCategories(labels: string[], series: ChartSeries[], direction: string): void {
  if (direction !== 'ascending' && direction !== 'descending') return;
  const totals = labels.map((_, index) =>
    series.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0),
  );
  const order = labels
    .map((_, index) => index)
    .sort((a, b) =>
      direction === 'ascending'
        ? (totals[a] ?? 0) - (totals[b] ?? 0)
        : (totals[b] ?? 0) - (totals[a] ?? 0),
    );
  const sortedLabels = order.map((index) => labels[index] ?? '');
  labels.splice(0, labels.length, ...sortedLabels);
  for (const entry of series) {
    entry.values = order.map((index) => entry.values[index] ?? 0);
  }
}

/** The sort a chart uses: the author's, or descending for a treemap. */
export function effectiveSort(node: IrNode): string {
  const sort = stringProp(node, 'sort');
  if (sort !== '') return sort;
  return stringProp(node, 'kind') === 'treemap' ? 'descending' : 'none';
}

function deriveInline(node: IrNode): Derived {
  const kind = stringProp(node, 'kind');
  const series = inlineSeries(node);
  return {
    labels: listProp(node, 'labels').map((label) => str(label)),
    series,
    points: [],
    cells: [],
    rowLabels: [],
    samples: kind === 'histogram' ? (series[0]?.values ?? []) : [],
    rawToLabel: new Map(),
  };
}

/** Map an overlay's x onto the axis: numbers stay numbers on numeric axes; categories use display labels. */
function overlayX(value: JsonValue | undefined, numericAxis: boolean, derived: Derived) {
  if (numericAxis && typeof value === 'number') return value;
  const text = typeof value === 'number' ? String(value) : str(value);
  return derived.rawToLabel.get(text) ?? text;
}

export function buildChartInput(node: IrNode): ChartInput {
  const kind = stringProp(node, 'kind', 'bar');
  const title = stringProp(node, 'title');
  const description = stringProp(node, 'description');
  const base: ChartInput = {
    kind,
    id: node.id,
    labels: [],
    series: [],
    ...(title === '' ? {} : { title }),
    ...(description === '' ? {} : { description }),
  };
  if (!isEncoded(node)) {
    return {
      ...base,
      labels: listProp(node, 'labels').map((label) => str(label)),
      series: inlineSeries(node),
    };
  }

  const magnitude = magnitudeEncoding(node);
  const derived =
    node.data === undefined ? deriveInline(node) : deriveFromRows(node, magnitude.key);
  if (SORTABLE_KINDS.includes(kind)) {
    sortCategories(derived.labels, derived.series, effectiveSort(node));
  }
  const numericAxis = NUMERIC_X_KINDS.includes(kind);
  const cartesian = CARTESIAN_KINDS.includes(kind);
  const magnitudeAxis = axisSpec(magnitude.prop);
  const y = magnitude.key === 'y' ? magnitudeAxis : axisSpec(encodingProp(node, 'y'));
  const table = rowsTable(node, magnitude.key);
  const target = node.props.target;
  const encoded: EncodedChart = {
    x: axisSpec(encodingProp(node, 'x')),
    y,
    value: magnitude.key === 'value' ? magnitudeAxis : y,
    points: derived.points,
    cells: derived.cells,
    rowLabels: derived.rowLabels,
    samples: derived.samples,
    bins: typeof node.props.bins === 'number' ? node.props.bins : 10,
    markers: cartesian
      ? objectListProp(node, 'markers').map((marker) => ({
          x: overlayX(marker.x, numericAxis, derived),
          label: str(marker.label),
        }))
      : [],
    annotations: cartesian
      ? objectListProp(node, 'annotations').map((note) => ({
          x: overlayX(note.x, numericAxis, derived),
          y: numProp(note.y, 0),
          text: str(note.text),
        }))
      : [],
    ...(table === undefined ? {} : { table }),
    ...(typeof target === 'number' ? { target } : {}),
  };
  return { ...base, labels: derived.labels, series: derived.series, encoded };
}
