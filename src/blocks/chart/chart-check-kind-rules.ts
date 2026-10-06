/**
 * Chart rules that run on the same resolved input the renderer draws: gauge
 * range, funnel order, treemap size, stacked shares, clipped values, pivot
 * gaps and overlay positions.
 */

import { fieldValue } from '../../data/dataset-types.js';
import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { objectListProp, stringProp } from '../../render/block-helpers.js';
import type { ChartInput } from '../../render/chart-types.js';
import type { Report } from './chart-check.js';
import { encodingProp, magnitudeEncoding, seriesField } from './chart-encodings.js';
import {
  CARTESIAN_KINDS,
  MAX_TREEMAP_CELLS,
  NUMERIC_X_KINDS,
  SINGLE_SERIES_KINDS,
} from './chart-kinds.js';
import { buildChartInput } from './chart-model.js';

/** Overlay x positions must land on the axis: a category name, or a number on a numeric axis. */
function checkOverlays(node: IrNode, kind: string, input: ChartInput, report: Report) {
  if (!CARTESIAN_KINDS.includes(kind)) return;
  const numericAxis = NUMERIC_X_KINDS.includes(kind);
  const known = kind === 'waterfall' ? [...input.labels, 'Total'] : input.labels;
  for (const key of ['markers', 'annotations']) {
    const items = objectListProp(node, key);
    const placed = key === 'markers' ? input.encoded?.markers : input.encoded?.annotations;
    items.forEach((_, index) => {
      const x = placed?.[index]?.x;
      const fits = numericAxis ? typeof x === 'number' : known.includes(String(x));
      if (fits) return;
      report({
        path: pathKey(pathIndex(pathKey(node.path, key), index), 'x'),
        severity: 'warning',
        message: numericAxis
          ? `a ${kind} chart places overlays by number; "${String(x)}" is not drawn`
          : `"${String(x)}" is not a category of this chart and is not drawn`,
        details: { allowed: [...known] },
      });
    });
  }
}

/** Rules that run on the resolved chart, once its shape and fields are valid. */
export function checkKindRules(node: IrNode, kind: string, report: Report): void {
  const input = buildChartInput(node);
  const encoded = input.encoded;
  const values = input.series[0]?.values ?? [];
  const valuesPath =
    node.data === undefined
      ? pathKey(pathIndex(pathKey(node.path, 'series'), 0), 'values')
      : pathKey(pathKey(node.path, magnitudeEncoding(node).key), 'field');

  if (SINGLE_SERIES_KINDS.includes(kind) && node.data === undefined && input.series.length > 1) {
    report({
      path: pathKey(node.path, 'series'),
      severity: 'warning',
      message: `a ${kind} chart draws only the first series`,
    });
  }
  if (kind === 'gauge' && encoded !== undefined) {
    const min = encoded.value.min ?? 0;
    const max = encoded.value.max ?? 100;
    const count = node.data === undefined ? values.length : node.data.rows.length;
    if (count !== 1 || (node.data === undefined && input.labels.length !== 1)) {
      report({ path: valuesPath, message: `a gauge shows exactly one value; found ${count}` });
    } else if ((values[0] ?? 0) < min || (values[0] ?? 0) > max) {
      report({
        path: valuesPath,
        message: `the gauge value ${values[0]} is outside ${min}–${max}; set value.min or value.max`,
      });
    }
    if (encoded.target !== undefined && (encoded.target < min || encoded.target > max)) {
      report({
        path: pathKey(node.path, 'target'),
        severity: 'warning',
        message: `target ${encoded.target} is outside ${min}–${max} and is drawn at the edge`,
      });
    }
  }
  if (kind === 'funnel') {
    const rises = values.findIndex((value, index) => index > 0 && value > (values[index - 1] ?? 0));
    if (rises > 0) {
      report({
        path: valuesPath,
        severity: 'warning',
        message: `funnel stage "${input.labels[rises]}" is larger than the stage before it`,
      });
    }
  }
  if (kind === 'treemap') {
    if (input.labels.length > MAX_TREEMAP_CELLS) {
      report({
        path: valuesPath,
        code: 'SPEC_BOUNDS_ERROR',
        message: `a treemap holds at most ${MAX_TREEMAP_CELLS} cells; found ${input.labels.length}`,
      });
    }
    if (values.some((value) => value < 0)) {
      report({ path: valuesPath, message: 'treemap values must not be negative' });
    }
  }
  if (
    kind === 'stacked-bar-100' &&
    input.series.some((series) => series.values.some((v) => v < 0))
  ) {
    report({ path: valuesPath, message: 'stacked-bar-100 values must not be negative' });
  }
  if (CARTESIAN_KINDS.includes(kind) && encoded !== undefined && kind !== 'stacked-bar-100') {
    const { min, max } = encoded.y;
    const plotted =
      kind === 'scatter'
        ? encoded.points.map((point) => point.y)
        : input.series.flatMap((s) => s.values);
    const outside = plotted.filter(
      (value) => (min !== undefined && value < min) || (max !== undefined && value > max),
    ).length;
    if (outside > 0 && kind !== 'histogram' && kind !== 'waterfall') {
      report({
        path: pathKey(node.path, 'y'),
        severity: 'warning',
        message: `${outside} values fall outside y.min/y.max and are clipped at the edge`,
      });
    }
  }
  if (
    node.data !== undefined &&
    seriesField(node) !== undefined &&
    !SINGLE_SERIES_KINDS.includes(kind)
  ) {
    checkPivotGaps(node, input.labels.length, report);
  }
  checkOverlays(node, kind, input, report);
}

/** Warn when a pivoted series misses a category (drawn as 0) or repeats one (summed). */
function checkPivotGaps(node: IrNode, categories: number, report: Report): void {
  if (stringProp(node, 'kind') === 'scatter' || stringProp(node, 'kind') === 'heatmap') return;
  const x = encodingProp(node, 'x')?.field;
  const group = seriesField(node);
  if (x === undefined || group === undefined || node.data === undefined) return;
  const seen = new Map<string, number>();
  const groups = new Set<string>();
  for (const row of node.data.rows) {
    const key = JSON.stringify([fieldValue(row, group), fieldValue(row, x)]);
    groups.add(JSON.stringify(fieldValue(row, group)));
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const path = pathKey(pathKey(node.path, 'series'), 'field');
  if ([...seen.values()].some((count) => count > 1)) {
    report({
      path,
      severity: 'warning',
      message:
        'some series repeat an x value; their values are summed (use transform.groupBy to aggregate explicitly)',
    });
  }
  if (seen.size < groups.size * categories) {
    report({
      path,
      severity: 'warning',
      message: 'some series have no row for an x value; those points are drawn as 0',
    });
  }
}
