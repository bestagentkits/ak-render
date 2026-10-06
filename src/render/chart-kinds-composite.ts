/**
 * Encoded charts that are not drawn on x/y axes: heatmap, funnel, gauge and
 * treemap, plus the original radial, progress and sparkline kinds when they
 * are bound to data. Colour comes from classes only: heatmap intensity is one
 * of five quantized classes (`ak-chart-h0`…`ak-chart-h4`), never an inline fill.
 */

import {
  type Frame,
  numberFormatter,
  RADIAL,
  round,
  SPARK,
  seriesClass,
  WIDTH,
} from './chart-scales.js';
import { clipText, textValueLabel } from './chart-svg-parts.js';
import { categoryLegend, seriesSummary } from './chart-text.js';
import type { ChartInput, EncodedChart, KindRender } from './chart-types.js';
import { progressChart, progressFrame, radialChart, sparkline } from './charts.js';
import { escapeText } from './escape.js';

/** Heatmap intensity steps; the stylesheet maps each to an opacity of the accent. */
export const HEAT_STEPS = 5;
const HEAT_ROW = 36;
const HEAT_LEFT = 132;
const FUNNEL_ROW = 44;

/** Pie, donut, progress and sparkline keep their drawing; text uses the encoding's format. */
export function encodedOriginalKind(input: ChartInput, encoded: EncodedChart): KindRender {
  // Single-series kinds read their magnitude from `value`; a sparkline plots `y`.
  const axis = input.kind === 'sparkline' ? encoded.y : encoded.value;
  const format = numberFormatter(axis.format);
  const summary = seriesSummary(input, format);
  switch (input.kind) {
    case 'pie':
    case 'donut':
      return {
        body: radialChart(input, input.kind === 'donut'),
        viewBox: RADIAL,
        legend: categoryLegend(input),
        summary,
      };
    case 'progress':
      return {
        body: progressChart(input, format),
        viewBox: progressFrame(input.labels.length),
        legend: [],
        summary,
      };
    default:
      return { body: sparkline(input), viewBox: SPARK, legend: [], summary };
  }
}

/** The quantized intensity class of a value within [low, high]. */
export function heatStep(value: number, low: number, high: number): number {
  if (high <= low) return HEAT_STEPS - 1;
  return Math.min(HEAT_STEPS - 1, Math.floor(((value - low) / (high - low)) * HEAT_STEPS));
}

export function heatmapChart(input: ChartInput, encoded: EncodedChart): KindRender {
  const format = numberFormatter(encoded.value.format);
  const columns = Math.max(input.labels.length, 1);
  const rows = Math.max(encoded.rowLabels.length, 1);
  const frame: Frame = {
    width: WIDTH,
    height: 16 + rows * HEAT_ROW + 40,
    top: 16,
    right: 12,
    bottom: 40,
    left: HEAT_LEFT,
  };
  const cellWidth = (frame.width - frame.left - frame.right) / columns;
  const values = encoded.cells.map((cell) => cell.value);
  const low = values.length === 0 ? 0 : Math.min(...values);
  const high = values.length === 0 ? 0 : Math.max(...values);
  const filled = new Set(encoded.cells.map((cell) => `${cell.row}:${cell.column}`));
  const parts: string[] = [];
  for (let row = 0; row < encoded.rowLabels.length; row += 1) {
    for (let column = 0; column < input.labels.length; column += 1) {
      if (filled.has(`${row}:${column}`)) continue;
      parts.push(
        `<rect class="ak-chart-track" x="${round(frame.left + column * cellWidth + 1.5)}" y="${round(
          frame.top + row * HEAT_ROW + 1.5,
        )}" width="${round(cellWidth - 3)}" height="${HEAT_ROW - 3}" rx="3"/>`,
      );
    }
  }
  for (const cell of encoded.cells) {
    const x = frame.left + cell.column * cellWidth;
    const y = frame.top + cell.row * HEAT_ROW;
    const name = `${encoded.rowLabels[cell.row] ?? ''} × ${input.labels[cell.column] ?? ''}`;
    parts.push(
      `<rect class="ak-chart-heat ak-chart-h${heatStep(cell.value, low, high)}" tabindex="0" x="${round(x + 1.5)}" y="${round(
        y + 1.5,
      )}" width="${round(cellWidth - 3)}" height="${HEAT_ROW - 3}" rx="3"><title>${escapeText(
        `${name}: ${format(cell.value)}`,
      )}</title></rect>`,
      textValueLabel(x + cellWidth / 2, y + HEAT_ROW / 2 + 4, format(cell.value), true),
    );
  }
  const rowText = encoded.rowLabels
    .map(
      (label, row) =>
        `<text class="ak-chart-label ak-chart-label--row" x="${frame.left - 10}" y="${round(
          frame.top + row * HEAT_ROW + HEAT_ROW / 2 + 4,
        )}" text-anchor="end">${escapeText(clipText(label, 18))}</text>`,
    )
    .join('');
  const labelStep = Math.max(1, Math.ceil(input.labels.length / 16));
  const columnText = input.labels
    .map((label, column) =>
      column % labelStep === 0
        ? `<text class="ak-chart-label" x="${round(frame.left + column * cellWidth + cellWidth / 2)}" y="${
            frame.top + rows * HEAT_ROW + 18
          }" text-anchor="middle">${escapeText(clipText(label, 14))}</text>`
        : '',
    )
    .join('');
  const span = high - low;
  const legend = Array.from({ length: HEAT_STEPS }, (_, step) => {
    const from = low + (span * step) / HEAT_STEPS;
    const to = low + (span * (step + 1)) / HEAT_STEPS;
    return {
      label: span === 0 ? format(low) : `${format(from)}–${format(to)}`,
      swatch: `ak-chart-heat-swatch ak-chart-h${step}`,
    };
  }).filter((_, step) => span !== 0 || step === HEAT_STEPS - 1);
  const top = [...encoded.cells].sort((a, b) => b.value - a.value)[0];
  const bottom = [...encoded.cells].sort((a, b) => a.value - b.value)[0];
  const describe = (cell: typeof top) =>
    cell === undefined
      ? ''
      : `${encoded.rowLabels[cell.row] ?? ''} × ${input.labels[cell.column] ?? ''} (${format(cell.value)})`;
  return {
    body: `${parts.join('')}${rowText}${columnText}`,
    viewBox: frame,
    legend,
    summary:
      encoded.cells.length === 0
        ? 'No cells.'
        : `${encoded.cells.length} cells across ${encoded.rowLabels.length} rows and ${input.labels.length} columns. Highest: ${describe(
            top,
          )}. Lowest: ${describe(bottom)}.`,
  };
}

export function funnelChart(input: ChartInput, encoded: EncodedChart): KindRender {
  const format = numberFormatter(encoded.value.format);
  const share = numberFormatter({ format: 'percent' });
  const values = input.labels.map((_, index) => input.series[0]?.values[index] ?? 0);
  const max = Math.max(...values, 0);
  const first = values[0] ?? 0;
  const left = 168;
  const right = WIDTH - 150;
  const centre = (left + right) / 2;
  const parts: string[] = [];
  const conversion = (value: number) => (first > 0 ? share((value / first) * 100) : '');
  input.labels.forEach((label, index) => {
    const value = values[index] ?? 0;
    const width = max <= 0 ? 0 : Math.max(2, ((right - left) * Math.max(0, value)) / max);
    const y = index * FUNNEL_ROW + 6;
    const rate = index === 0 ? '' : ` · ${conversion(value)}`;
    parts.push(
      `<text class="ak-chart-label ak-chart-label--row" x="0" y="${y + 21}" text-anchor="start">${escapeText(
        clipText(label, 22),
      )}</text>`,
      `<rect class="ak-chart-bar ${seriesClass(0)}" tabindex="0" x="${round(centre - width / 2)}" y="${y}" width="${round(
        width,
      )}" height="${FUNNEL_ROW - 12}" rx="4"><title>${escapeText(
        `${label}: ${format(value)}${index === 0 ? '' : ` (${conversion(value)} of ${input.labels[0] ?? ''})`}`,
      )}</title></rect>`,
      `<text class="ak-chart-label" x="${WIDTH}" y="${y + 21}" text-anchor="end">${escapeText(
        `${format(value)}${rate}`,
      )}</text>`,
    );
  });
  return {
    body: parts.join(''),
    viewBox: { width: WIDTH, height: Math.max(1, input.labels.length) * FUNNEL_ROW },
    legend: [],
    summary: input.labels
      .map((label, index) => {
        const value = values[index] ?? 0;
        return index === 0
          ? `${label} ${format(value)}`
          : `${label} ${format(value)} (${conversion(value)} of ${input.labels[0] ?? ''})`;
      })
      .join(', '),
  };
}
