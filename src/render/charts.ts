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
 *
 * Colour never appears here: shapes carry a series class (`ak-chart-s0` …
 * `ak-chart-s5`) and the stylesheet maps each class onto the theme accent and
 * hue rotations of it, so a chart always follows the active preset and colour
 * scheme and no two series share a colour.
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

interface Bounds {
  min: number;
  max: number;
}

interface Frame {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Shared viewBox width. Text inside the SVG scales with the rendered width, so
 * this is sized for a full-width card: labels render near their nominal size
 * there, and the canvas scrolls rather than shrinks on narrow screens.
 */
const WIDTH = 800;
/** Number of distinct series colours the stylesheet defines. */
const PALETTE_SIZE = 6;
/** Bars wider than this read as slabs rather than marks. */
const MAX_BAR_WIDTH = 56;
const PROGRESS_ROW = 32;
const PROGRESS_LABEL_WIDTH = 132;

const CARTESIAN: Frame = { width: WIDTH, height: 300, top: 20, right: 36, bottom: 36, left: 56 };
const RADIAL: Frame = { width: WIDTH, height: 240, top: 0, right: 0, bottom: 0, left: 0 };
const SPARK: Frame = { width: WIDTH, height: 72, top: 10, right: 10, bottom: 10, left: 10 };

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Group digits with a thin comma, deterministically and without locale data. */
function formatNumber(value: number): string {
  const rounded = round(value);
  const [whole = '0', fraction] = String(Math.abs(rounded)).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `${rounded < 0 ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

function seriesClass(index: number): string {
  return `ak-chart-s${index % PALETTE_SIZE}`;
}

/** Round a span up to 1, 2, 2.5 or 5 times a power of ten, so ticks read cleanly. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(count, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = [1, 2, 2.5, 5].find((candidate) => normalized <= candidate) ?? 10;
  return factor * magnitude;
}

/** Axis bounds that include zero and end on a clean tick. */
function niceBounds(series: ChartSeries[]): Bounds & { step: number } {
  const values = series.flatMap((entry) => entry.values).filter((value) => Number.isFinite(value));
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  if (rawMax === rawMin) return { min: rawMin, max: rawMin + 1, step: 0.25 };
  const step = niceStep(rawMax - rawMin, 4);
  return {
    min: Math.floor(rawMin / step) * step,
    max: Math.ceil(rawMax / step) * step,
    step,
  };
}

function plotWidth(frame: Frame): number {
  return frame.width - frame.left - frame.right;
}

function plotHeight(frame: Frame): number {
  return frame.height - frame.top - frame.bottom;
}

function scaleY(value: number, bounds: Bounds, frame: Frame): number {
  const ratio = (value - bounds.min) / (bounds.max - bounds.min);
  return round(frame.top + plotHeight(frame) * (1 - ratio));
}

/** Point charts span the plot edge to edge. */
function pointX(index: number, count: number, frame: Frame): number {
  if (count <= 1) return round(frame.left + plotWidth(frame) / 2);
  return round(frame.left + (plotWidth(frame) * index) / (count - 1));
}

/** Bar groups sit in equal bands, labelled at the band centre. */
function bandCentre(index: number, count: number, frame: Frame): number {
  const band = plotWidth(frame) / Math.max(count, 1);
  return round(frame.left + band * index + band / 2);
}

function gridAndTicks(bounds: Bounds & { step: number }, frame: Frame): string {
  const parts: string[] = [];
  const steps = Math.round((bounds.max - bounds.min) / bounds.step);
  for (let index = 0; index <= steps; index += 1) {
    const value = round(bounds.min + bounds.step * index);
    const y = scaleY(value, bounds, frame);
    parts.push(
      `<line class="${value === 0 ? 'ak-chart-axis' : 'ak-chart-grid'}" x1="${frame.left}" y1="${y}" x2="${
        frame.width - frame.right
      }" y2="${y}"/>`,
    );
    parts.push(
      `<text class="ak-chart-label" x="${frame.left - 8}" y="${round(y + 4)}" text-anchor="end">${escapeText(
        formatNumber(value),
      )}</text>`,
    );
  }
  return parts.join('');
}

function categoryLabels(
  labels: string[],
  position: (index: number) => number,
  frame: Frame,
): string {
  const parts: string[] = [];
  const step = Math.max(1, Math.ceil(labels.length / 8));
  for (let index = 0; index < labels.length; index += step) {
    parts.push(
      `<text class="ak-chart-label" x="${position(index)}" y="${frame.height - frame.bottom + 20}" text-anchor="middle">${escapeText(
        labels[index] ?? '',
      )}</text>`,
    );
  }
  return parts.join('');
}

function pointTitle(label: string, series: ChartSeries, index: number): string {
  return `${label}: ${series.label} ${series.values[index] ?? 0}`;
}

/**
 * A value label drawn directly after its mark. The stylesheet reveals it while
 * the mark is hovered or focused (`mark:hover + .ak-chart-value`), so the exact
 * number is one pointer move away without a tooltip script.
 */
function valueLabel(x: number, y: number, value: number): string {
  return `<text class="ak-chart-value" x="${round(x)}" y="${round(y)}" text-anchor="middle" aria-hidden="true">${escapeText(
    formatNumber(value),
  )}</text>`;
}

/** Fragment-safe id prefix for gradients, derived from the block id. */
function gradientId(input: ChartInput, seriesIndex: number): string {
  return `ak-grad-${input.id.replace(/[^A-Za-z0-9_-]/gu, '-')}-${seriesIndex}`;
}

function barChart(input: ChartInput): string {
  const frame = CARTESIAN;
  const bounds = niceBounds(input.series);
  const groups = Math.max(input.labels.length, 1);
  const seriesCount = Math.max(input.series.length, 1);
  const band = plotWidth(frame) / groups;
  const gap = Math.min(4, band * 0.04);
  const barWidth = round(
    Math.max(2, Math.min(MAX_BAR_WIDTH, (band * 0.72 - gap * (seriesCount - 1)) / seriesCount)),
  );
  const groupWidth = barWidth * seriesCount + gap * (seriesCount - 1);
  const zeroY = scaleY(Math.max(bounds.min, 0), bounds, frame);
  const parts: string[] = [];
  // One gradient per series: full strength at the cap, easing off toward the
  // baseline, so a bar reads as lit from above instead of a flat slab.
  const defs = input.series.map(
    (_, seriesIndex) =>
      `<linearGradient id="${gradientId(input, seriesIndex)}" class="${seriesClass(seriesIndex)}" x1="0" y1="0" x2="0" y2="1"><stop class="ak-chart-stop ak-chart-stop--bar" offset="0"/><stop class="ak-chart-stop ak-chart-stop--bar ak-chart-stop--end" offset="1"/></linearGradient>`,
  );

  input.series.forEach((series, seriesIndex) => {
    input.labels.forEach((label, index) => {
      const value = series.values[index] ?? 0;
      const x = round(
        bandCentre(index, groups, frame) - groupWidth / 2 + seriesIndex * (barWidth + gap),
      );
      const y = scaleY(value, bounds, frame);
      const height = round(Math.abs(zeroY - y));
      const top = Math.min(y, zeroY);
      parts.push(
        `<rect class="ak-chart-bar ${seriesClass(seriesIndex)}" tabindex="0" x="${x}" y="${top}" width="${barWidth}" height="${height}" rx="${round(
          Math.min(4, barWidth / 4),
        )}" fill="url(#${gradientId(input, seriesIndex)})"><title>${escapeText(pointTitle(label, series, index))}</title></rect>`,
        valueLabel(x + barWidth / 2, value < 0 ? top + height + 14 : top - 7, value),
      );
    });
  });

  return `<defs>${defs.join('')}</defs>${gridAndTicks(bounds, frame)}${categoryLabels(
    input.labels,
    (index) => bandCentre(index, groups, frame),
    frame,
  )}${parts.join('')}`;
}

function linePath(values: number[], bounds: Bounds, frame: Frame): string {
  return values
    .map(
      (value, index) =>
        `${index === 0 ? 'M' : 'L'}${pointX(index, values.length, frame)},${scaleY(value, bounds, frame)}`,
    )
    .join(' ');
}

function lineChart(input: ChartInput, area: boolean): string {
  const frame = CARTESIAN;
  const bounds = niceBounds(input.series);
  const parts: string[] = [];
  const baseY = scaleY(Math.max(bounds.min, 0), bounds, frame);
  const defs: string[] = [];
  input.series.forEach((series, seriesIndex) => {
    const colour = seriesClass(seriesIndex);
    const path = linePath(series.values, bounds, frame);
    if (area) {
      // Stops inherit the series colour through the gradient's series class,
      // so the fade stays theme-driven while the path references it by id.
      const id = gradientId(input, seriesIndex);
      defs.push(
        `<linearGradient id="${id}" class="${colour}" x1="0" y1="0" x2="0" y2="1"><stop class="ak-chart-stop" offset="0"/><stop class="ak-chart-stop ak-chart-stop--end" offset="1"/></linearGradient>`,
      );
      parts.push(
        `<path class="ak-chart-area ${colour}" fill="url(#${id})" d="${path} L${pointX(series.values.length - 1, series.values.length, frame)},${baseY} L${pointX(
          0,
          series.values.length,
          frame,
        )},${baseY} Z"/>`,
      );
    }
    parts.push(`<path class="ak-chart-line ${colour}" d="${path}"/>`);
    series.values.forEach((value, index) => {
      const label = input.labels[Math.min(index, input.labels.length - 1)] ?? '';
      const cx = pointX(index, series.values.length, frame);
      const cy = scaleY(value, bounds, frame);
      parts.push(
        `<circle class="ak-chart-point ${colour}" tabindex="0" cx="${cx}" cy="${cy}" r="4"><title>${escapeText(
          pointTitle(label, series, index),
        )}</title></circle>`,
        valueLabel(cx, cy - 12, value),
      );
    });
  });
  const count = Math.max(
    ...input.series.map((series) => series.values.length),
    input.labels.length,
    1,
  );
  const gradients = defs.length === 0 ? '' : `<defs>${defs.join('')}</defs>`;
  return `${gradients}${gridAndTicks(bounds, frame)}${categoryLabels(
    input.labels,
    (index) => pointX(index, count, frame),
    frame,
  )}${parts.join('')}`;
}

/** A sparkline is a trend glyph, so it scales to its own data range, not to zero. */
function sparkline(input: ChartInput): string {
  const frame = SPARK;
  const values = input.series.flatMap((series) => series.values);
  const low = values.length === 0 ? 0 : Math.min(...values);
  const high = values.length === 0 ? 1 : Math.max(...values);
  const bounds = high === low ? { min: low - 1, max: high + 1 } : { min: low, max: high };
  const parts: string[] = [];
  input.series.forEach((series, seriesIndex) => {
    const colour = seriesClass(seriesIndex);
    parts.push(
      `<path class="ak-chart-line ${colour}" d="${linePath(series.values, bounds, frame)}"/>`,
    );
    const last = series.values.length - 1;
    if (last >= 0) {
      parts.push(
        `<circle class="ak-chart-point ${colour}" cx="${pointX(last, series.values.length, frame)}" cy="${scaleY(
          series.values[last] ?? 0,
          bounds,
          frame,
        )}" r="3.5"/>`,
      );
    }
  });
  return parts.join('');
}

function radialChart(input: ChartInput, donut: boolean): string {
  const series = input.series[0];
  if (series === undefined) return '';
  const values = input.labels.map((_, index) => Math.max(series.values[index] ?? 0, 0));
  const sum = values.reduce((total, value) => total + value, 0);
  const total = sum || 1;
  const centreX = RADIAL.width / 2;
  const centreY = RADIAL.height / 2;
  const radius = 104;
  const inner = donut ? 64 : 0;
  const parts: string[] = [];
  let angle = -Math.PI / 2;

  values.forEach((value, index) => {
    // A single full slice cannot be drawn as one arc, so cap it just short.
    const sweep = Math.min((value / total) * Math.PI * 2, Math.PI * 2 - 0.0001);
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
    const colour = `ak-chart-slice ${seriesClass(index)}`;
    if (inner > 0) {
      const ix1 = round(centreX + inner * Math.cos(start));
      const iy1 = round(centreY + inner * Math.sin(start));
      const ix2 = round(centreX + inner * Math.cos(end));
      const iy2 = round(centreY + inner * Math.sin(end));
      parts.push(
        `<path class="${colour}" tabindex="0" d="M${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} L${ix2},${iy2} A${inner},${inner} 0 ${large} 0 ${ix1},${iy1} Z">${title}</path>`,
      );
    } else {
      parts.push(
        `<path class="${colour}" tabindex="0" d="M${centreX},${centreY} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z">${title}</path>`,
      );
    }
  });
  if (donut) {
    parts.push(
      `<text class="ak-chart-total" x="${centreX}" y="${centreY - 2}" text-anchor="middle">${escapeText(
        formatNumber(sum),
      )}</text><text class="ak-chart-label" x="${centreX}" y="${centreY + 16}" text-anchor="middle">${escapeText(
        series.label,
      )}</text>`,
    );
  }
  return parts.join('');
}

function progressFrame(rows: number): Frame {
  return {
    width: WIDTH,
    height: Math.max(rows, 1) * PROGRESS_ROW,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
}

function progressChart(input: ChartInput): string {
  const series = input.series[0];
  if (series === undefined) return '';
  const max = Math.max(1, ...series.values);
  const trackStart = PROGRESS_LABEL_WIDTH;
  const trackWidth = WIDTH - trackStart - 56;
  const parts: string[] = [];
  input.labels.forEach((label, index) => {
    const value = series.values[index] ?? 0;
    const centre = index * PROGRESS_ROW + PROGRESS_ROW / 2;
    const filled = round((trackWidth * Math.max(0, Math.min(value, max))) / max);
    parts.push(
      `<text class="ak-chart-label ak-chart-label--row" x="0" y="${centre + 4}" text-anchor="start">${escapeText(label)}</text>`,
    );
    parts.push(
      `<rect class="ak-chart-track" x="${trackStart}" y="${centre - 5}" width="${trackWidth}" height="10" rx="5"/>`,
    );
    parts.push(
      `<rect class="ak-chart-bar ${seriesClass(0)}" tabindex="0" x="${trackStart}" y="${centre - 5}" width="${filled}" height="10" rx="5"><title>${escapeText(
        `${label}: ${value}`,
      )}</title></rect>`,
    );
    parts.push(
      `<text class="ak-chart-label" x="${WIDTH}" y="${centre + 4}" text-anchor="end">${escapeText(
        formatNumber(value),
      )}</text>`,
    );
  });
  return parts.join('');
}

/** A legend whenever colour alone would otherwise have to carry meaning. */
function legend(input: ChartInput): string {
  const radial = input.kind === 'pie' || input.kind === 'donut';
  const entries = radial ? input.labels : input.series.map((series) => series.label);
  if (input.kind === 'progress' || input.kind === 'sparkline') return '';
  if (!radial && entries.length < 2) return '';
  return `<ul class="ak-chart-legend" aria-hidden="true">${entries
    .map(
      (entry, index) =>
        `<li><span class="ak-chart-swatch ${seriesClass(index)}"></span>${escapeText(entry)}</li>`,
    )
    .join('')}</ul>`;
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

function chartBody(input: ChartInput): { body: string; frame: Frame } {
  switch (input.kind) {
    case 'bar':
      return { body: barChart(input), frame: CARTESIAN };
    case 'line':
      return { body: lineChart(input, false), frame: CARTESIAN };
    case 'area':
      return { body: lineChart(input, true), frame: CARTESIAN };
    case 'pie':
      return { body: radialChart(input, false), frame: RADIAL };
    case 'donut':
      return { body: radialChart(input, true), frame: RADIAL };
    case 'sparkline':
      return { body: sparkline(input), frame: SPARK };
    case 'progress':
      return { body: progressChart(input), frame: progressFrame(input.labels.length) };
    default:
      return { body: '', frame: CARTESIAN };
  }
}

/** Render one chart block as a figure containing SVG, a summary, and a table. */
export function renderChart(input: ChartInput): string {
  const { body, frame } = chartBody(input);
  const summary = textSummary(input);
  const ariaLabel = input.title === undefined ? summary : `${input.title}. ${summary}`;
  const caption =
    input.title === undefined ? '' : `<figcaption>${escapeText(input.title)}</figcaption>`;

  return [
    `<figure class="ak-chart"${renderAttributes({ 'data-ak-kind': input.kind })}>`,
    caption,
    `<div class="ak-chart-canvas"><svg viewBox="0 0 ${frame.width} ${frame.height}" role="img"${renderAttributes(
      {
        'aria-label': ariaLabel,
        'data-ak-chart': input.id,
      },
    )}><title>${escapeText(input.title ?? 'Chart')}</title>${body}</svg></div>`,
    legend(input),
    `<p class="ak-sr">${escapeText(summary)}</p>`,
    `<details class="ak-details"><summary>Chart data table</summary>${dataTable(input)}</details>`,
    '</figure>',
  ]
    .filter((part) => part !== '')
    .join('');
}

/** Escape helper re-exported for chart consumers that build their own chart markup. */
export { escapeAttribute };
