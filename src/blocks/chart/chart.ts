/** Chart block: a deterministic SVG chart with a text summary. */

import { type DiagnosticBag, pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  list,
  OPTIONAL_TITLE,
  str as strProp,
  txt,
} from '../../registry/define-helpers.js';
import { nodeAttributes } from '../../render/block-helpers.js';
import { renderChart } from '../../render/charts.js';
import { renderAttributes } from '../../render/escape.js';
import { checkChart } from './chart-check.js';
import { CHART_ENCODING_PROPS, SERIES_PROP } from './chart-encoding-schema.js';
import { CHART_KINDS } from './chart-kinds.js';
import { buildChartInput } from './chart-model.js';

/**
 * Warn when a series carries a different number of values than there are
 * labels. Shared with the progress block, which takes the same labels/series
 * shape.
 */
export function checkSeriesLengths(node: IrNode, bag: DiagnosticBag): void {
  const labels = node.props.labels;
  const series = node.props.series;
  if (!Array.isArray(labels) || labels.length === 0 || !Array.isArray(series)) return;
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
    useCases: ['trend over time', 'category comparison', 'share of total', 'distribution'],
    purpose: 'Deterministic SVG chart with a text summary.',
    summary:
      'Chart: 16 kinds (see kind) from labels/series or bound rows via x, y, series, value encodings.',
    props: {
      kind: enumStr(CHART_KINDS, { required: true }),
      title: OPTIONAL_TITLE,
      description: txt({
        description: 'Text summary for assistive technology; backticks stay literal.',
      }),
      labels: list(strProp({ maxLength: 80 }), {
        minItems: 1,
        maxItems: 200,
        description: 'Required unless rows are bound.',
      }),
      series: SERIES_PROP,
      ...CHART_ENCODING_PROPS,
      ...anchorProps,
    },
    data: { required: false, description: 'Rows the x/y/series/value encodings read.' },
    runtimeFeatures: ['chart'],
    assets: ['chart'],
    a11y: 'SVG carries role="img" plus a generated text summary; the same values are available as a table for assistive technology.',
    serializer: 'Serializes to the labels/series data or the encodings, never to rendered SVG.',
  }),
  render: (node) =>
    `<div${renderAttributes(nodeAttributes(node, { class: 'ak-block' }))}>${renderChart(
      buildChartInput(node),
    )}</div>`,
  check(node, { bag }) {
    checkSeriesLengths(node, bag);
    checkChart(node, bag);
  },
};
