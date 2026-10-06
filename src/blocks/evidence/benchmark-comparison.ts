/**
 * Benchmark comparison: a baseline and a candidate measured on the same
 * metrics. The compiler derives the delta, the percentage change, the verdict
 * and the summary line, so the author writes only the measurements.
 */

import { FORMAT_FIELDS, type FormatSpec, groupedNumber } from '../../data/format-value.js';
import { pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import {
  anchorProps,
  enumStr,
  LABEL,
  list,
  num,
  OPTIONAL_TITLE,
  obj,
  semantic,
  str as strProp,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  stringProp,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeAttribute, escapeInlineText, escapeText, escapeUrl } from '../../render/escape.js';
import {
  BETTER_VALUES,
  type Better,
  compareMetric,
  type MetricComparison,
  type Verdict,
  verdictSummary,
} from './benchmark-verdict.js';
import {
  checkFieldMap,
  dataBindingFailed,
  FORMAT_OVERRIDE_FIELDS,
  fieldMap,
  formatMeasure,
  formatSpecOf,
  projectRow,
} from './evidence-helpers.js';

export const BENCHMARK_LIMITS = { maxMetrics: 20 } as const;

const VERDICT_TONES: Readonly<Record<Verdict, string>> = {
  improved: 'success',
  regressed: 'danger',
  unchanged: 'neutral',
};
const DATA_FIELDS = {
  metric: 'metric',
  baseline: 'baseline',
  candidate: 'candidate',
  better: 'better',
  unit: 'unit',
} as const;
/** U+2212, the typographic minus. */
const MINUS = '\u2212';

interface Metric {
  label: string;
  baseline: number;
  candidate: number;
  better: Better;
  format: FormatSpec;
}

function isBetter(value: JsonValue | undefined): value is Better {
  return typeof value === 'string' && (BETTER_VALUES as readonly string[]).includes(value);
}

function isMeasure(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function dataPath(node: IrNode): string {
  return pathKey(node.path, node.data?.source === null ? 'data' : 'dataRef');
}

/** The metrics to compare, from the authored list or the bound rows; invalid rows are skipped. */
function readMetrics(node: IrNode): Metric[] {
  const blockFormat = formatSpecOf(node.props);
  if (node.data === undefined) {
    return objectListProp(node, 'metrics').flatMap((item) =>
      isMeasure(item.baseline) && isMeasure(item.candidate) && isBetter(item.better)
        ? [
            {
              label: str(item.label),
              baseline: item.baseline,
              candidate: item.candidate,
              better: item.better,
              format: { ...blockFormat, ...formatSpecOf(item) },
            },
          ]
        : [],
    );
  }
  const map = fieldMap(node, DATA_FIELDS);
  return node.data.rows.slice(0, BENCHMARK_LIMITS.maxMetrics).flatMap((row) => {
    const value = projectRow(row, map);
    if (!isMeasure(value.baseline) || !isMeasure(value.candidate) || !isBetter(value.better)) {
      return [];
    }
    const unit = typeof value.unit === 'string' && value.unit !== '' ? { unit: value.unit } : {};
    return [
      {
        label: value.metric === null ? '' : String(value.metric),
        baseline: value.baseline,
        candidate: value.candidate,
        better: value.better,
        format: { ...blockFormat, ...unit },
      },
    ];
  });
}

function checkDataRows(node: IrNode, { bag }: CheckContext): void {
  const data = node.data;
  if (data === undefined) return;
  const map = fieldMap(node, DATA_FIELDS);
  if (!checkFieldMap(node, data, map, ['unit'], bag)) return;
  if (data.rows.length > BENCHMARK_LIMITS.maxMetrics) {
    bag.add({
      code: 'SPEC_BOUNDS_ERROR',
      path: dataPath(node),
      nodeId: node.id,
      message: `benchmark-comparison has ${data.rows.length} rows, limit is ${BENCHMARK_LIMITS.maxMetrics} metrics`,
    });
  }
  data.rows.forEach((row, index) => {
    const value = projectRow(row, map);
    for (const key of ['baseline', 'candidate'] as const) {
      if (isMeasure(value[key])) continue;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(pathKey(node.path, 'fields'), key),
        nodeId: node.id,
        message: `row ${index}: ${key} field "${map[key]}" must hold a number`,
        details: { row: index, field: map[key] },
      });
    }
    if (!isBetter(value.better)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(pathKey(node.path, 'fields'), 'better'),
        nodeId: node.id,
        message: `row ${index}: better field "${map.better}" must be lower or higher`,
        details: { row: index, field: map.better, allowed: [...BETTER_VALUES] },
      });
    }
  });
}

function check(node: IrNode, context: CheckContext): void {
  const { bag } = context;
  const metrics = objectListProp(node, 'metrics');
  if (node.data !== undefined && metrics.length > 0) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(node.path, 'metrics'),
      nodeId: node.id,
      message: 'use either metrics or bound data (dataRef/data), not both',
    });
    return;
  }
  if (node.data === undefined && metrics.length === 0) {
    if (dataBindingFailed(node, bag)) return;
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(node.path, 'metrics'),
      nodeId: node.id,
      message: 'benchmark-comparison needs metrics, or dataRef/data with fields',
    });
    return;
  }
  checkDataRows(node, context);
}

function signed(value: number, text: string): string {
  if (!/[1-9]/u.test(text)) return text;
  return `${value < 0 ? MINUS : '+'}${text}`;
}

function changeCell(metric: Metric, comparison: MetricComparison): string {
  const absolute = signed(
    comparison.delta,
    formatMeasure(Math.abs(comparison.delta), metric.format),
  );
  let relative = '';
  if (comparison.percent !== null) {
    relative = signed(comparison.percent, `${groupedNumber(Math.abs(comparison.percent), 1)}%`);
  } else if (comparison.delta !== 0) {
    relative = 'new';
  }
  return `<td class="ak-num ak-bench-delta" data-label="Change">${escapeText(absolute)}${
    relative === '' ? '' : `<span class="ak-bench-pct">${escapeText(relative)}</span>`
  }</td>`;
}

/** Column names repeated on each cell, so the narrow layout can label stacked cells. */
interface Columns {
  baseline: string;
  candidate: string;
}

function metricRow(metric: Metric, columns: Columns): { row: string; verdict: Verdict } {
  const comparison = compareMetric(metric.baseline, metric.candidate, metric.better);
  const row = [
    `<tr data-verdict="${comparison.verdict}">`,
    `<th scope="row"><span class="ak-bench-metric">${escapeText(metric.label)}</span><span class="ak-bench-better">${metric.better} is better</span></th>`,
    `<td class="ak-num" data-label="${escapeAttribute(columns.baseline)}">${escapeText(formatMeasure(metric.baseline, metric.format))}</td>`,
    `<td class="ak-num" data-label="${escapeAttribute(columns.candidate)}">${escapeText(formatMeasure(metric.candidate, metric.format))}</td>`,
    changeCell(metric, comparison),
    `<td data-label="Verdict"><span class="ak-badge" data-tone="${VERDICT_TONES[comparison.verdict]}">${comparison.verdict}</span></td>`,
    '</tr>',
  ].join('');
  return { row, verdict: comparison.verdict };
}

function sideLabel(node: IrNode, key: 'baseline' | 'candidate'): string {
  const side = node.props[key];
  return isPlainObject(side) ? str(side.label) : '';
}

function notes(node: IrNode): string {
  const entries: string[] = [];
  const method = stringProp(node, 'method');
  if (method !== '') entries.push(`<div><dt>Method</dt><dd>${escapeInlineText(method)}</dd></div>`);
  const limitations = stringProp(node, 'limitations');
  if (limitations !== '') {
    entries.push(`<div><dt>Limitations</dt><dd>${escapeInlineText(limitations)}</dd></div>`);
  }
  const source = node.props.source;
  if (isPlainObject(source) && str(source.label) !== '') {
    const label = escapeText(str(source.label));
    const href = str(source.href);
    entries.push(
      `<div><dt>Source</dt><dd>${
        href === ''
          ? label
          : `<a href="${escapeAttribute(escapeUrl(href))}" rel="noreferrer noopener">${label}</a>`
      }</dd></div>`,
    );
  }
  return entries.length === 0 ? '' : `<dl class="ak-bench-notes">${entries.join('')}</dl>`;
}

function render(node: IrNode): string {
  const baseline = sideLabel(node, 'baseline');
  const candidate = sideLabel(node, 'candidate');
  const rows = readMetrics(node).map((metric) => metricRow(metric, { baseline, candidate }));
  const title = stringProp(node, 'title');
  const caption = title === '' ? `${candidate} compared with ${baseline}` : title;
  const table = [
    `<div class="ak-table-wrap"><table><caption class="ak-sr">${escapeText(caption)}</caption>`,
    '<thead><tr><th scope="col">Metric</th>',
    `<th scope="col" class="ak-num">${escapeText(baseline)}</th>`,
    `<th scope="col" class="ak-num">${escapeText(candidate)}</th>`,
    '<th scope="col" class="ak-num">Change</th><th scope="col">Verdict</th></tr></thead>',
    `<tbody>${rows.map((entry) => entry.row).join('')}</tbody></table></div>`,
  ].join('');
  const summary = `<p class="ak-bench-summary"><span class="ak-bench-versus"><strong>${escapeText(
    candidate,
  )}</strong> vs ${escapeText(baseline)}</span><span class="ak-bench-tally">${escapeText(
    verdictSummary(rows.map((entry) => entry.verdict)),
  )}</span></p>`;
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-bench' }),
    [titleHeader(node), summary, table, notes(node)].join(''),
  );
}

const SIDE = obj({ label: LABEL }, { required: true });

export const benchmarkComparisonBlock: BlockModule = {
  definition: semantic({
    type: 'benchmark-comparison',
    category: 'data',
    tags: ['benchmark', 'before-after', 'delta', 'performance', 'evidence'],
    useCases: ['release benchmark', 'performance regression check'],
    purpose: 'Baseline versus candidate measurements with computed deltas and verdicts.',
    summary:
      'Benchmark comparison: baseline vs candidate metrics; computes delta, % change, verdict and a summary.',
    props: {
      title: OPTIONAL_TITLE,
      baseline: SIDE,
      candidate: SIDE,
      metrics: list(
        obj({
          label: LABEL,
          baseline: num({ required: true }),
          candidate: num({ required: true }),
          better: enumStr(BETTER_VALUES, { required: true }),
          ...FORMAT_OVERRIDE_FIELDS,
        }),
        {
          minItems: 1,
          maxItems: BENCHMARK_LIMITS.maxMetrics,
          description: 'Measured metrics. Omit when the rows come from dataRef or data.',
        },
      ),
      fields: obj(
        {
          metric: strProp({ maxLength: 64, default: DATA_FIELDS.metric }),
          baseline: strProp({ maxLength: 64, default: DATA_FIELDS.baseline }),
          candidate: strProp({ maxLength: 64, default: DATA_FIELDS.candidate }),
          better: strProp({ maxLength: 64, default: DATA_FIELDS.better }),
          unit: strProp({ maxLength: 64, description: 'Optional per-row unit field.' }),
        },
        { description: 'Data fields for each column when rows come from dataRef or data.' },
      ),
      ...FORMAT_FIELDS,
      method: txt({ maxLength: 600, description: 'How the numbers were measured.' }),
      limitations: txt({ maxLength: 600, description: 'What the numbers do not show.' }),
      source: obj(
        {
          label: LABEL,
          href: urlProp({
            description: 'Link to the evidence, e.g. "#ref-<id>" for a references entry.',
          }),
        },
        { description: 'Where the measurements come from.' },
      ),
      ...anchorProps,
    },
    data: {
      required: false,
      description: 'Rows with metric, baseline, candidate and better (lower|higher) fields.',
    },
    runtimeFeatures: ['evidence'],
    a11y: 'A captioned table with row headers; every verdict is stated in words, never by colour alone.',
  }),
  render,
  check,
};
