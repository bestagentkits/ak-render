/**
 * Metric breakdown: how a total splits into parts. A stacked bar shows the
 * shares at a glance and a list states each part's value and share, so the
 * list alone carries everything the bar shows.
 */

import { FORMAT_FIELDS } from '../../data/format-value.js';
import { pathIndex, pathKey } from '../../diagnostics.js';
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
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeText } from '../../render/escape.js';
import {
  checkFieldMap,
  dataBindingFailed,
  fieldMap,
  formatMeasure,
  formatSpecOf,
  projectRow,
} from './evidence-helpers.js';

export const BREAKDOWN_LIMITS = { minParts: 2, maxParts: 12 } as const;
export const PART_TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const;
/** Distinct series colours before the bar repeats them with a hatch. */
export const BREAKDOWN_SERIES = 6;

const DATA_FIELDS = { label: 'label', value: 'value' } as const;

interface Part {
  label: string;
  value: number;
  tone: string;
}

/**
 * Whole-percent shares of `denominator` that never sum past what the parts
 * cover: each share is floored, then the points left over go to the largest
 * remainders (earlier parts win ties), so the bar and the list always agree
 * and the bar never overflows.
 */
export function quantizeShares(values: readonly number[], denominator: number): number[] {
  if (denominator <= 0) return values.map(() => 0);
  const exact = values.map((value) => (Math.max(value, 0) / denominator) * 100);
  const floors = exact.map((share) => Math.floor(share));
  const covered = exact.reduce((sum, share) => sum + share, 0);
  let spare = Math.min(100, Math.round(covered)) - floors.reduce((sum, share) => sum + share, 0);
  const order = exact
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (spare <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    spare -= 1;
  }
  return floors;
}

function isMeasure(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readParts(node: IrNode): Part[] {
  if (node.data === undefined) {
    return objectListProp(node, 'parts').flatMap((item) =>
      isMeasure(item.value) && item.value >= 0
        ? [{ label: str(item.label), value: item.value, tone: str(item.tone) }]
        : [],
    );
  }
  const map = fieldMap(node, DATA_FIELDS);
  return node.data.rows.slice(0, BREAKDOWN_LIMITS.maxParts).flatMap((row) => {
    const value = projectRow(row, map);
    if (!isMeasure(value.value) || value.value < 0) return [];
    return [
      { label: value.label === null ? '' : String(value.label), value: value.value, tone: '' },
    ];
  });
}

function authoredTotal(node: IrNode): { label: string; value: number } | undefined {
  const total = node.props.total;
  if (!isPlainObject(total) || !isMeasure(total.value)) return undefined;
  return { label: str(total.label), value: total.value };
}

function checkData(node: IrNode, { bag }: CheckContext): void {
  const data = node.data;
  if (data === undefined) return;
  const map = fieldMap(node, DATA_FIELDS);
  if (!checkFieldMap(node, data, map, [], bag)) return;
  const path = pathKey(node.path, data.source === null ? 'data' : 'dataRef');
  if (
    data.rows.length < BREAKDOWN_LIMITS.minParts ||
    data.rows.length > BREAKDOWN_LIMITS.maxParts
  ) {
    bag.add({
      code:
        data.rows.length > BREAKDOWN_LIMITS.maxParts
          ? 'SPEC_BOUNDS_ERROR'
          : 'SPEC_VALIDATION_ERROR',
      path,
      nodeId: node.id,
      message: `metric-breakdown has ${data.rows.length} rows; it takes ${BREAKDOWN_LIMITS.minParts}-${BREAKDOWN_LIMITS.maxParts} parts`,
    });
  }
  data.rows.forEach((row, index) => {
    const value = projectRow(row, map).value;
    if (isMeasure(value) && value >= 0) return;
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(pathKey(node.path, 'fields'), 'value'),
      nodeId: node.id,
      message: `row ${index}: value field "${map.value}" must hold a non-negative number`,
      details: { row: index, field: map.value },
    });
  });
}

function check(node: IrNode, context: CheckContext): void {
  const { bag } = context;
  const parts = objectListProp(node, 'parts');
  if (node.data !== undefined && parts.length > 0) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(node.path, 'parts'),
      nodeId: node.id,
      message: 'use either parts or bound data (dataRef/data), not both',
    });
    return;
  }
  if (node.data === undefined && parts.length === 0) {
    if (dataBindingFailed(node, bag)) return;
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(node.path, 'parts'),
      nodeId: node.id,
      message: 'metric-breakdown needs parts, or dataRef/data with fields',
    });
    return;
  }
  parts.forEach((part, index) => {
    if (!isMeasure(part.value) || part.value >= 0) return;
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(pathIndex(pathKey(node.path, 'parts'), index), 'value'),
      nodeId: node.id,
      message: 'a part value must not be negative',
    });
  });
  checkData(node, context);
  const total = authoredTotal(node);
  if (total === undefined) return;
  const sum = readParts(node).reduce((acc, part) => acc + part.value, 0);
  if (sum > total.value) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: pathKey(pathKey(node.path, 'total'), 'value'),
      nodeId: node.id,
      message: `the parts sum to ${sum}, more than the total ${total.value}; shares use the sum`,
      details: { sum, total: total.value },
    });
  }
}

function render(node: IrNode): string {
  const format = formatSpecOf(node.props);
  const parts = readParts(node);
  const sum = parts.reduce((acc, part) => acc + part.value, 0);
  const authored = authoredTotal(node);
  const total = authored ?? { label: 'Total', value: sum };
  const shares = quantizeShares(
    parts.map((part) => part.value),
    Math.max(total.value, sum),
  );
  const attributes = (part: Part, index: number): string =>
    `data-series="${index % BREAKDOWN_SERIES}"${index >= BREAKDOWN_SERIES ? ' data-hatch' : ''}${
      part.tone === '' ? '' : ` data-tone="${part.tone}"`
    }`;
  const bar = `<div class="ak-breakdown-bar" aria-hidden="true">${parts
    .map(
      (part, index) =>
        `<span class="ak-breakdown-seg" data-ak-pct="${shares[index] ?? 0}" ${attributes(part, index)}></span>`,
    )
    .join('')}</div>`;
  const items = parts
    .map(
      (part, index) =>
        `<li ${attributes(part, index)}><span class="ak-breakdown-swatch" aria-hidden="true"></span><span class="ak-breakdown-label">${escapeText(
          part.label,
        )}</span><span class="ak-breakdown-value">${escapeText(
          formatMeasure(part.value, format),
        )}</span><span class="ak-breakdown-share">${shares[index] ?? 0}%</span></li>`,
    )
    .join('');
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-breakdown' }),
    [
      titleHeader(node),
      `<p class="ak-breakdown-total"><span class="ak-label">${escapeText(
        total.label,
      )}</span><strong>${escapeText(formatMeasure(total.value, format))}</strong></p>`,
      bar,
      `<ol class="ak-breakdown-list">${items}</ol>`,
    ].join(''),
  );
}

export const metricBreakdownBlock: BlockModule = {
  definition: semantic({
    type: 'metric-breakdown',
    category: 'data',
    tags: ['share', 'composition', 'stacked-bar', 'budget', 'evidence'],
    useCases: ['cost breakdown', 'latency budget', 'share of total'],
    purpose: 'A total split into parts, as a stacked bar plus a list with shares.',
    summary:
      'Metric breakdown: parts of a total as a stacked bar and a list with value and share %.',
    props: {
      title: OPTIONAL_TITLE,
      total: obj(
        { label: LABEL, value: num({ required: true, min: 0 }) },
        { description: 'Omit to use the sum of the parts.' },
      ),
      parts: list(
        obj({
          label: LABEL,
          value: num({ required: true, min: 0 }),
          tone: enumStr(PART_TONES, { description: 'Status colour instead of a series colour.' }),
        }),
        {
          minItems: BREAKDOWN_LIMITS.minParts,
          maxItems: BREAKDOWN_LIMITS.maxParts,
          description: 'Omit when the rows come from dataRef or data.',
        },
      ),
      fields: obj(
        {
          label: strProp({ maxLength: 64, default: DATA_FIELDS.label }),
          value: strProp({ maxLength: 64, default: DATA_FIELDS.value }),
        },
        { description: 'Data fields for the part label and value.' },
      ),
      ...FORMAT_FIELDS,
      ...anchorProps,
    },
    data: { required: false, description: 'Rows with a label and a non-negative value field.' },
    runtimeFeatures: ['evidence'],
    a11y: 'The bar is decorative; the list states every part, its value and its share in text.',
  }),
  render,
  check,
};
