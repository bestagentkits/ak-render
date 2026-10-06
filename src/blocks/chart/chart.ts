/** Chart block: a deterministic SVG chart with a text summary. */

import { type DiagnosticBag, pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  itemsOf,
  LABEL,
  list,
  num,
  OPTIONAL_TITLE,
  str as strProp,
  txt,
} from '../../registry/define-helpers.js';
import {
  listProp,
  nodeAttributes,
  numProp,
  objectListProp,
  str,
  stringProp,
} from '../../render/block-helpers.js';
import { type ChartSeries, renderChart } from '../../render/charts.js';
import { renderAttributes } from '../../render/escape.js';
import { CHART_KINDS } from './chart-kinds.js';

/**
 * Warn when a series carries a different number of values than there are
 * labels. Shared with the progress block, which takes the same labels/series
 * shape.
 */
export function checkSeriesLengths(node: IrNode, bag: DiagnosticBag): void {
  const labels = node.props.labels;
  const series = node.props.series;
  if (!Array.isArray(labels) || !Array.isArray(series)) return;
  for (let index = 0; index < series.length; index += 1) {
    const entry = series[index];
    if (!isPlainObject(entry)) continue;
    const values = entry.values;
    if (Array.isArray(values) && values.length !== labels.length) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        severity: 'warning',
        message: `series "${String(entry.label ?? index)}" has ${values.length} values for ${labels.length} labels`,
        path: pathIndex(pathKey(node.path, 'series'), index),
        nodeId: node.id,
      });
    }
  }
}

export const chartBlock: BlockModule = {
  definition: define({
    type: 'chart',
    category: 'data',
    tags: ['visualization', 'svg', 'series'],
    useCases: ['trend over time', 'category comparison', 'share of total'],
    purpose: 'Deterministic SVG chart with a text summary.',
    summary: 'Chart: bar, line, area, pie, donut, sparkline, or progress from labeled series.',
    props: {
      kind: enumStr(CHART_KINDS, { required: true }),
      title: OPTIONAL_TITLE,
      description: txt({
        description: 'Text summary for assistive technology; backticks stay literal.',
      }),
      labels: list(strProp({ maxLength: 80 }), { required: true, minItems: 1, maxItems: 200 }),
      series: itemsOf(
        { label: LABEL, values: list(num(), { required: true, minItems: 1, maxItems: 200 }) },
        { minItems: 1 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['chart'],
    assets: ['chart'],
    a11y: 'SVG carries role="img" plus a generated text summary; the same values are available as a table for assistive technology.',
    serializer: 'Serializes to the labels/series data, never to rendered SVG.',
  }),
  render: (node) => {
    const series: ChartSeries[] = objectListProp(node, 'series').map((entry) => ({
      label: str(entry.label),
      values: (Array.isArray(entry.values) ? entry.values : []).map((value) => numProp(value, 0)),
    }));
    const description = stringProp(node, 'description');
    const title = stringProp(node, 'title');
    return `<div${renderAttributes(nodeAttributes(node, { class: 'ak-block' }))}>${renderChart({
      kind: stringProp(node, 'kind', 'bar'),
      id: node.id,
      labels: listProp(node, 'labels').map((label) => str(label)),
      series,
      ...(title === '' ? {} : { title }),
      ...(description === '' ? {} : { description }),
    })}</div>`;
  },
  check(node, { bag }) {
    checkSeriesLengths(node, bag);
  },
};
