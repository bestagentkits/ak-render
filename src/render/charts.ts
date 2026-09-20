/**
 * Deterministic SVG charts.
 *
 * Common chart types are rendered as SVG rather than with a charting library:
 * no dependency, no network, and byte-identical output. Every chart also emits a
 * text summary and a data table, so the values are available to assistive
 * technology and to anyone who cannot read the plot.
 *
 * All geometry is rounded to two decimals before it reaches the markup, because
 * floating-point noise would otherwise break byte-determinism across engines.
 */

import { escapeAttribute, escapeText, renderAttributes } from './escape.js';

export interface ChartSeries {
  label: string;
  values: number[];
}

export interface ChartInput {
  kind: string;
  id: string;
  labels: string[];
  series: ChartSeries[];
  title?: string;
  description?: string;
}

const WIDTH = 640;
const HEIGHT = 240;
const PADDING = { top: 16, right: 16, bottom: 36, left: 44 };

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function extent(series: ChartSeries[]): { min: number; max: number } {
  const values = series.flatMap((entry) => entry.values);
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  return max === min ? { min, max: min + 1 } : { min, max };
}

function plotWidth(): number {
  return WIDTH - PADDING.left - PADDING.right;
}

function plotHeight(): number {
  return HEIGHT - PADDING.top - PADDING.bottom;
}

function scaleY(value: number, bounds: { min: number; max: number }): number {
  const ratio = (value - bounds.min) / (bounds.max - bounds.min);
  return round(PADDING.top + plotHeight() * (1 - ratio));
}

function scaleX(index: number, count: number): number {
  if (count <= 1) return round(PADDING.left + plotWidth() / 2);
  return round(PADDING.left + (plotWidth() * index) / (count - 1));
}

function axisLabels(labels: string[], bounds: { min: number; max: number }): string {
  const parts: string[] = [];
  const step = Math.max(1, Math.ceil(labels.length / 8));
  for (let index = 0; index < labels.length; index += step) {
    const x = scaleX(index, labels.length);
    parts.push(
      `<text class="ak-chart-label" x="${x}" y="${HEIGHT - PADDING.bottom + 16}" text-anchor="middle">${escapeText(
        labels[index] ?? '',
      )}</text>`,
    );
  }
  parts.push(
    `<line class="ak-chart-axis" x1="${PADDING.left}" y1="${PADDING.top}" x2="${PADDING.left}" y2="${
      HEIGHT - PADDING.bottom
    }"/>`,
  );
  parts.push(
    `<line class="ak-chart-axis" x1="${PADDING.left}" y1="${
      HEIGHT - PADDING.bottom
    }" x2="${WIDTH - PADDING.right}" y2="${HEIGHT - PADDING.bottom}"/>`,
  );
  parts.push(
    `<text class="ak-chart-label" x="${PADDING.left - 6}" y="${scaleY(bounds.max, bounds) + 3}" text-anchor="end">${escapeText(
      String(round(bounds.max)),
    )}</text>`,
  );
  if (bounds.min < 0) {
    parts.push(
      `<text class="ak-chart-label" x="${PADDING.left - 6}" y="${
        scaleY(bounds.min, bounds) + 3
      }" text-anchor="end">${escapeText(String(round(bounds.min)))}</text>`,
    );
  }
  return parts.join('');
}

function pointTitle(label: string, series: ChartSeries, index: number): string {
  return `${label}: ${series.label} ${series.values[index] ?? 0}`;
}

function barChart(input: ChartInput, bounds: { min: number; max: number }): string {
  const groups = input.labels.length;
  const seriesCount = Math.max(input.series.length, 1);
  const groupWidth = plotWidth() / Math.max(groups, 1);
  const barWidth = round(Math.max(2, (groupWidth - 8) / seriesCount));
  const parts: string[] = [];
  const zeroY = scaleY(Math.max(bounds.min, 0), bounds);

  input.series.forEach((series, seriesIndex) => {
    input.labels.forEach((label, index) => {
      const value = series.values[index] ?? 0;
      const x = round(PADDING.left + groupWidth * index + 4 + seriesIndex * barWidth);
      const y = scaleY(value, bounds);
      const height = round(Math.abs(zeroY - y));
      const top = Math.min(y, zeroY);
      parts.push(
        `<rect class="ak-chart-bar${
          seriesIndex % 2 === 1 ? ' ak-chart-bar--alt' : ''
        }" tabindex="0" x="${x}" y="${top}" width="${barWidth}" height="${height}"><title>${escapeText(
          pointTitle(label, series, index),
        )}</title></rect>`,
      );
    });
  });

  return `${axisLabels(input.labels, bounds)}${parts.join('')}`;
}

function linePath(series: ChartSeries, bounds: { min: number; max: number }): string {
  return series.values
    .map(
      (value, index) =>
        `${index === 0 ? 'M' : 'L'}${scaleX(index, series.values.length)},${scaleY(value, bounds)}`,
    )
    .join(' ');
}

function lineChart(input: ChartInput, bounds: { min: number; max: number }, area: boolean): string {
  const parts: string[] = [];
  input.series.forEach((series) => {
    const path = linePath(series, bounds);
    if (area) {
      const baseY = scaleY(Math.max(bounds.min, 0), bounds);
      parts.push(
        `<path class="ak-chart-area" d="${path} L${scaleX(series.values.length - 1, series.values.length)},${baseY} L${PADDING.left},${baseY} Z"/>`,
      );
    }
    parts.push(`<path class="ak-chart-line" d="${path}"/>`);
    series.values.forEach((value, index) => {
      const label = input.labels[Math.min(index, input.labels.length - 1)] ?? '';
      parts.push(
        `<circle class="ak-chart-bar" tabindex="0" cx="${scaleX(index, series.values.length)}" cy="${scaleY(
          value,
          bounds,
        )}" r="3"><title>${escapeText(pointTitle(label, series, index))}</title></circle>`,
      );
    });
  });
  const axis = area ? '' : axisLabels(input.labels, bounds);
  return `${axis}${parts.join('')}`;
}

function sparkline(input: ChartInput, bounds: { min: number; max: number }): string {
  const parts: string[] = [];
  for (const series of input.series) {
    parts.push(`<path class="ak-chart-line" d="${linePath(series, bounds)}"/>`);
  }
  return parts.join('');
}

function radialChart(input: ChartInput, donut: boolean): string {
  const series = input.series[0];
  if (series === undefined) return '';
  const values = input.labels.map((_, index) => Math.max(series.values[index] ?? 0, 0));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const centreX = WIDTH / 2;
  const centreY = HEIGHT / 2;
  const radius = 84;
  const inner = donut ? 46 : 0;
  const parts: string[] = [];
  let angle = -Math.PI / 2;

  values.forEach((value, index) => {
    const sweep = (value / total) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const large = sweep > Math.PI ? 1 : 0;
    const x1 = round(centreX + radius * Math.cos(start));
    const y1 = round(centreY + radius * Math.sin(start));
    const x2 = round(centreX + radius * Math.cos(end));
    const y2 = round(centreY + radius * Math.sin(end));
    const label = input.labels[index] ?? '';
    const title = `<title>${escapeText(`${label}: ${value} (${round((value / total) * 100)}%)`)}</title>`;
    if (inner > 0) {
      const ix1 = round(centreX + inner * Math.cos(start));
      const iy1 = round(centreY + inner * Math.sin(start));
      const ix2 = round(centreX + inner * Math.cos(end));
      const iy2 = round(centreY + inner * Math.sin(end));
      parts.push(
        `<path class="ak-chart-bar${index % 2 === 1 ? ' ak-chart-bar--alt' : ''}" tabindex="0" d="M${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} L${ix2},${iy2} A${inner},${inner} 0 ${large} 0 ${ix1},${iy1} Z">${title}</path>`,
      );
    } else {
      parts.push(
        `<path class="ak-chart-bar${index % 2 === 1 ? ' ak-chart-bar--alt' : ''}" tabindex="0" d="M${centreX},${centreY} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z">${title}</path>`,
      );
    }
  });
  return parts.join('');
}

function progressChart(input: ChartInput): string {
  const series = input.series[0];
  if (series === undefined) return '';
  const max = Math.max(1, ...series.values);
  const rowHeight = 26;
  const barWidth = plotWidth();
  const parts: string[] = [];
  input.labels.forEach((label, index) => {
    const value = series.values[index] ?? 0;
    const y = PADDING.top + index * rowHeight;
    if (y > HEIGHT - PADDING.bottom) return;
    parts.push(
      `<text class="ak-chart-label" x="0" y="${y + 12}" text-anchor="start">${escapeText(label)}</text>`,
    );
    parts.push(
      `<rect x="${PADDING.left}" y="${y + 4}" width="${barWidth}" height="10" fill="var(--ak-color-surface-raised)"/>`,
    );
    parts.push(
      `<rect class="ak-chart-bar" tabindex="0" x="${PADDING.left}" y="${y + 4}" width="${round(
        (barWidth * Math.max(0, Math.min(value, max))) / max,
      )}" height="10"><title>${escapeText(`${label}: ${value}`)}</title></rect>`,
    );
  });
  return parts.join('');
}

function dataTable(input: ChartInput): string {
  const head = input.labels.map((label) => `<th scope="col">${escapeText(label)}</th>`).join('');
  const rows = input.series
    .map((series) => {
      const cells = input.labels
        .map((_, index) => `<td>${escapeText(String(series.values[index] ?? ''))}</td>`)
        .join('');
      return `<tr><th scope="row">${escapeText(series.label)}</th>${cells}</tr>`;
    })
    .join('');
  return `<table class="ak-chart-table"><caption>${escapeText(
    input.title ?? 'Chart data',
  )}</caption><thead><tr><th scope="col">Series</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function textSummary(input: ChartInput): string {
  if (input.description !== undefined && input.description !== '') return input.description;
  const lines = input.series.map((series) => {
    const pairs = input.labels
      .map((label, index) => `${label} ${series.values[index] ?? ''}`.trim())
      .join(', ');
    return `${series.label}: ${pairs}`;
  });
  return lines.join('. ');
}

/** Render one chart block as a figure containing SVG, a summary, and a table. */
export function renderChart(input: ChartInput): string {
  const bounds = extent(input.series);
  let body: string;
  switch (input.kind) {
    case 'bar':
      body = barChart(input, bounds);
      break;
    case 'line':
      body = lineChart(input, bounds, false);
      break;
    case 'area':
      body = lineChart(input, bounds, true);
      break;
    case 'pie':
      body = radialChart(input, false);
      break;
    case 'donut':
      body = radialChart(input, true);
      break;
    case 'sparkline':
      body = sparkline(input, bounds);
      break;
    case 'progress':
      body = progressChart(input);
      break;
    default:
      body = '';
  }

  const summary = textSummary(input);
  const ariaLabel = input.title === undefined ? summary : `${input.title}. ${summary}`;
  const caption =
    input.title === undefined ? '' : `<figcaption>${escapeText(input.title)}</figcaption>`;

  return [
    `<figure class="ak-chart"${renderAttributes({ 'data-ak-kind': input.kind })}>`,
    caption,
    `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img"${renderAttributes({
      'aria-label': ariaLabel,
      'data-ak-chart': input.id,
    })}><title>${escapeText(input.title ?? 'Chart')}</title>${body}</svg>`,
    `<p class="ak-sr">${escapeText(summary)}</p>`,
    `<details class="ak-details"><summary>Chart data table</summary>${dataTable(input)}</details>`,
    '</figure>',
  ]
    .filter((part) => part !== '')
    .join('');
}

/** Escape helper re-exported for chart consumers that build their own chart markup. */
export { escapeAttribute };
