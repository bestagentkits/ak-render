/**
 * Cross-field chart checks: what the prop schema cannot express.
 *
 * Inline charts need labels and series; bound charts must not repeat them and
 * must name existing, numeric fields for each kind's encodings. Kind rules
 * (gauge range, funnel order, treemap size, stacked shares) run on the same
 * resolved input the renderer draws.
 */

import { type DataScalar, fieldValue } from '../../data/dataset-types.js';
import { reportUnknownField } from '../../data/resolve-block-data.js';
import { type DiagnosticBag, type DiagnosticInput, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject } from '../../json.js';
import { listProp, stringProp } from '../../render/block-helpers.js';
import { checkKindRules } from './chart-check-kind-rules.js';
import {
  type EncodingProp,
  encodingProp,
  magnitudeEncoding,
  seriesField,
} from './chart-encodings.js';
import {
  CARTESIAN_KINDS,
  DATA_ONLY_KINDS,
  SINGLE_SERIES_KINDS,
  SORTABLE_KINDS,
} from './chart-kinds.js';

export type Report = (
  input: Omit<DiagnosticInput, 'code'> & { code?: DiagnosticInput['code'] },
) => void;

/** The encodings each kind needs when bound to data: [prop key, numeric]. */
function requiredEncodings(kind: string, magnitudeKey: string): [string, boolean][] {
  switch (kind) {
    case 'scatter':
      return [
        ['x', true],
        ['y', true],
      ];
    case 'heatmap':
      return [
        ['x', false],
        ['y', false],
        ['value', true],
      ];
    case 'histogram':
      return [['x', true]];
    case 'gauge':
      return [[magnitudeKey, true]];
    default:
      return [
        ['x', false],
        [magnitudeKey, true],
      ];
  }
}

function checkBound(node: IrNode, kind: string, report: Report, bag: DiagnosticBag): boolean {
  const data = node.data;
  if (data === undefined) return false;
  let ok = true;
  if (listProp(node, 'labels').length > 0) {
    ok = false;
    report({
      path: pathKey(node.path, 'labels'),
      message: 'labels come from x.field when the chart binds dataRef or data; remove labels',
    });
  }
  if (Array.isArray(node.props.series)) {
    ok = false;
    report({
      path: pathKey(node.path, 'series'),
      message: 'with dataRef or data, series is { field } or absent; remove the inline series',
    });
  }
  const magnitude = magnitudeEncoding(node);
  for (const [key, isNumeric] of requiredEncodings(kind, magnitude.key)) {
    const prop = encodingProp(node, key);
    const path = pathKey(pathKey(node.path, key), 'field');
    if (prop?.field === undefined) {
      ok = false;
      report({
        path,
        message: `a ${kind} chart bound to data needs ${key}.field`,
        details: { allowed: [...data.fields] },
      });
      continue;
    }
    if (!data.fields.includes(prop.field)) {
      ok = false;
      reportUnknownField(prop.field, data, path, bag, node.id);
      continue;
    }
    if (isNumeric) {
      const bad = data.rows.findIndex((row) => {
        const value: DataScalar = fieldValue(row, prop.field as string);
        return value !== null && typeof value !== 'number';
      });
      if (bad >= 0) {
        ok = false;
        report({
          path,
          message: `field "${prop.field}" must hold numbers; row ${bad} has ${JSON.stringify(
            fieldValue(data.rows[bad] ?? {}, prop.field),
          )}`,
        });
      }
    }
  }
  const group = seriesField(node);
  if (group !== undefined) {
    const path = pathKey(pathKey(node.path, 'series'), 'field');
    if (SINGLE_SERIES_KINDS.includes(kind)) {
      report({ path, message: `a ${kind} chart draws one series; remove series.field` });
    } else if (!data.fields.includes(group)) {
      ok = false;
      reportUnknownField(group, data, path, bag, node.id);
    }
  }
  // Fields named by encodings the kind does not require still have to exist.
  for (const key of ['x', 'y', 'value']) {
    const field = encodingProp(node, key)?.field;
    if (field !== undefined && !data.fields.includes(field)) {
      reportUnknownField(field, data, pathKey(pathKey(node.path, key), 'field'), bag, node.id);
      ok = false;
    }
  }
  return ok;
}

function checkInline(node: IrNode, kind: string, report: Report, bag: DiagnosticBag): boolean {
  // A failed dataRef/data/transform is already reported; do not pile on.
  const dataPath = pathKey(node.path, 'data');
  const transformPath = pathKey(node.path, 'transform');
  if (
    bag
      .errors()
      .some((item) => item.path.startsWith(dataPath) || item.path.startsWith(transformPath))
  ) {
    return false;
  }
  let ok = true;
  for (const key of ['x', 'y', 'value']) {
    if (encodingProp(node, key)?.field !== undefined) {
      ok = false;
      report({
        path: pathKey(pathKey(node.path, key), 'field'),
        message: `${key}.field needs dataRef or data to read from`,
      });
    }
  }
  if (isPlainObject(node.props.series)) {
    ok = false;
    report({
      path: pathKey(pathKey(node.path, 'series'), 'field'),
      message: 'series.field needs dataRef or data to read from',
    });
  }
  if (DATA_ONLY_KINDS.includes(kind)) {
    report({
      path: pathKey(node.path, 'dataRef'),
      message: `a ${kind} chart needs dataRef or data`,
    });
    return false;
  }
  if (kind !== 'histogram' && listProp(node, 'labels').length === 0) {
    ok = false;
    report({ path: pathKey(node.path, 'labels'), message: 'required value is missing' });
  }
  if (node.props.series === undefined) {
    ok = false;
    report({ path: pathKey(node.path, 'series'), message: 'required value is missing' });
  }
  return ok;
}

function warnUnused(node: IrNode, kind: string, report: Report): void {
  const warn = (key: string, message: string) =>
    report({ path: pathKey(node.path, key), message, severity: 'warning' });
  if (!CARTESIAN_KINDS.includes(kind)) {
    if (listProp(node, 'markers').length > 0)
      warn('markers', `a ${kind} chart has no x axis for markers`);
    if (listProp(node, 'annotations').length > 0) {
      warn('annotations', `a ${kind} chart has no x/y axes for annotations`);
    }
  }
  if (node.props.bins !== undefined && kind !== 'histogram')
    warn('bins', 'bins applies to histogram only');
  if (node.props.target !== undefined && kind !== 'gauge')
    warn('target', 'target applies to gauge only');
  if (node.props.sort !== undefined && !SORTABLE_KINDS.includes(kind)) {
    warn('sort', `sort applies to ${SORTABLE_KINDS.join(', ')}`);
  }
}

function checkBounds(node: IrNode, key: string, prop: EncodingProp | undefined, report: Report) {
  if (prop?.min !== undefined && prop.max !== undefined && prop.min >= prop.max) {
    report({
      path: pathKey(pathKey(node.path, key), 'max'),
      message: `${key}.max (${prop.max}) must be greater than ${key}.min (${prop.min})`,
    });
    return false;
  }
  return true;
}

export function checkChart(node: IrNode, bag: DiagnosticBag): void {
  const kind = stringProp(node, 'kind');
  const before = bag.errorCount;
  const report: Report = (input) =>
    bag.add({ code: 'SPEC_VALIDATION_ERROR', ...input, nodeId: node.id });
  warnUnused(node, kind, report);
  const shaped =
    node.data === undefined
      ? checkInline(node, kind, report, bag)
      : checkBound(node, kind, report, bag);
  const bounded = ['x', 'y', 'value'].every((key) =>
    checkBounds(node, key, encodingProp(node, key), report),
  );
  if (shaped && bounded && bag.errorCount === before) checkKindRules(node, kind, report);
}
