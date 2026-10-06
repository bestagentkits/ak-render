/**
 * Encoded charts drawn on x/y axes: bar, line and area with formats and
 * bounds, stacked bars (absolute and 100%), histogram, waterfall and scatter.
 *
 * Each kind returns a `KindRender`; the shared figure adds the overlays, the
 * legend, the summary and the table. Coordinates go through `round()`.
 */

import {
  axisBounds,
  bandCentre,
  CARTESIAN_TITLED,
  clampTo,
  numberFormatter,
  plotWidth,
  pointX,
  round,
  scaleX,
  scaleY,
  seriesClass,
  type TickBounds,
  tickFormatter,
} from './chart-scales.js';
import {
  axisTitles,
  boundedGridAndTicks,
  categoryIndex,
  categoryLabels,
  MAX_BAR_WIDTH,
  type NumberFormatter,
  numericXTicks,
  plotFor,
  rectPath,
  textValueLabel,
} from './chart-svg-parts.js';
import { seriesLegend, seriesSummary } from './chart-text.js';
import type { ChartInput, EncodedChart, KindRender } from './chart-types.js';
import { barChart, type CartesianOptions, lineChart } from './charts.js';
import { escapeText } from './escape.js';

/** Bar, line or area with the encoded value format, bounds and axis titles. */
export function encodedSeriesChart(input: ChartInput, encoded: EncodedChart): KindRender {
  const frame = CARTESIAN_TITLED;
  const format = numberFormatter(encoded.y.format);
  const bounds = axisBounds(
    input.series.flatMap((series) => series.values),
    encoded.y,
    true,
  );
  const options: CartesianOptions = {
    frame,
    bounds,
    grid: boundedGridAndTicks(bounds, frame, tickFormatter(encoded.y.format, bounds)),
    format,
    title: (label, series, index) =>
      `${label}: ${series.label} ${format(series.values[index] ?? 0)}`,
  };
  const bar = input.kind === 'bar';
  const count = Math.max(input.labels.length, ...input.series.map((s) => s.values.length), 1);
  const position = (index: number) =>
    bar ? bandCentre(index, Math.max(input.labels.length, 1), frame) : pointX(index, count, frame);
  const body = bar ? barChart(input, options) : lineChart(input, input.kind === 'area', options);
  return {
    body: `${body}${axisTitles(frame, encoded.x.label, encoded.y.label)}`,
    viewBox: frame,
    legend: seriesLegend(input),
    summary: seriesSummary(input, format),
    plot: plotFor(frame, bounds, (x) => {
      const index = categoryIndex(input.labels, x);
      return index === undefined ? undefined : position(index);
    }),
  };
}

/** Stacked bars; with `percent`, each bar is normalized to 100%. */
export function stackedBarChart(
  input: ChartInput,
  encoded: EncodedChart,
  percent: boolean,
): KindRender {
  const frame = CARTESIAN_TITLED;
  const raw = numberFormatter(encoded.y.format);
  const share = numberFormatter({ format: 'percent' });
  const groups = Math.max(input.labels.length, 1);
  const totals = input.labels.map((_, index) =>
    input.series.reduce((sum, series) => sum + Math.abs(series.values[index] ?? 0), 0),
  );
  const ups = input.labels.map((_, index) =>
    input.series.reduce((sum, series) => sum + Math.max(0, series.values[index] ?? 0), 0),
  );
  const downs = input.labels.map((_, index) =>
    input.series.reduce((sum, series) => sum + Math.min(0, series.values[index] ?? 0), 0),
  );
  const bounds: TickBounds = percent
    ? { min: 0, max: 100, step: 25 }
    : axisBounds([...ups, ...downs], encoded.y, true);
  const band = plotWidth(frame) / groups;
  const width = round(Math.max(4, Math.min(MAX_BAR_WIDTH, band * 0.62)));
  const parts: string[] = [];
  input.labels.forEach((label, index) => {
    let up = 0;
    let down = 0;
    const x = round(bandCentre(index, groups, frame) - width / 2);
    input.series.forEach((series, seriesIndex) => {
      const value = series.values[index] ?? 0;
      if (value === 0) return;
      const total = totals[index] ?? 0;
      const amount = percent ? (total === 0 ? 0 : (Math.abs(value) / total) * 100) : value;
      const start = amount >= 0 ? up : down;
      const end = start + amount;
      if (amount >= 0) up = end;
      else down = end;
      const y1 = scaleY(clampTo(start, bounds), bounds, frame);
      const y2 = scaleY(clampTo(end, bounds), bounds, frame);
      const top = Math.min(y1, y2);
      const height = Math.abs(y1 - y2);
      const shown = percent ? `${raw(value)} (${share(amount)})` : raw(value);
      parts.push(
        `<path class="ak-chart-bar ${seriesClass(seriesIndex)}" tabindex="0" d="${rectPath(x, top, width, height)}"><title>${escapeText(
          `${label}: ${series.label} ${shown}`,
        )}</title></path>`,
        textValueLabel(
          x + width / 2,
          top + height / 2 + 4,
          percent ? share(amount) : raw(value),
          true,
        ),
      );
    });
  });
  return {
    body: `${boundedGridAndTicks(bounds, frame, percent ? share : tickFormatter(encoded.y.format, bounds))}${categoryLabels(
      input.labels,
      (index) => bandCentre(index, groups, frame),
      frame,
    )}${parts.join('')}${axisTitles(
      frame,
      encoded.x.label,
      percent ? `${encoded.y.label ?? 'Share'} (%)` : encoded.y.label,
    )}`,
    viewBox: frame,
    legend: seriesLegend(input),
    summary: seriesSummary(input, raw),
    plot: plotFor(frame, bounds, (x) => {
      const index = categoryIndex(input.labels, x);
      return index === undefined ? undefined : bandCentre(index, groups, frame);
    }),
  };
}

export function scatterChart(input: ChartInput, encoded: EncodedChart): KindRender {
  const frame = CARTESIAN_TITLED;
  const xFormat = numberFormatter(encoded.x.format);
  const yFormat = numberFormatter(encoded.y.format);
  const points = encoded.points;
  const xBounds = axisBounds(
    points.map((point) => point.x),
    encoded.x,
    false,
  );
  const yBounds = axisBounds(
    points.map((point) => point.y),
    encoded.y,
    false,
  );
  const marks = points.map((point) => {
    const cx = scaleX(clampTo(point.x, xBounds), xBounds, frame);
    const cy = scaleY(clampTo(point.y, yBounds), yBounds, frame);
    const name = input.series[point.series]?.label;
    const text = `${xFormat(point.x)}, ${yFormat(point.y)}`;
    return `<circle class="ak-chart-point ${seriesClass(point.series)}" tabindex="0" cx="${cx}" cy="${cy}" r="5"><title>${escapeText(
      `${name === undefined || input.series.length < 2 ? '' : `${name}: `}${encoded.x.label ?? 'x'} ${xFormat(point.x)}, ${encoded.y.label ?? 'y'} ${yFormat(point.y)}`,
    )}</title></circle>${textValueLabel(cx, cy - 12, text)}`;
  });
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const range = (values: number[], format: NumberFormatter) =>
    values.length === 0
      ? 'no values'
      : `${format(Math.min(...values))} to ${format(Math.max(...values))}`;
  const groups =
    input.series.length < 2
      ? ''
      : ` ${input.series
          .map(
            (series, index) =>
              `${series.label}: ${points.filter((point) => point.series === index).length}`,
          )
          .join(', ')}.`;
  return {
    body: `${boundedGridAndTicks(yBounds, frame, tickFormatter(encoded.y.format, yBounds))}${numericXTicks(
      xBounds,
      frame,
      tickFormatter(encoded.x.format, xBounds),
    )}${marks.join('')}${axisTitles(frame, encoded.x.label, encoded.y.label)}`,
    viewBox: frame,
    legend: seriesLegend(input),
    summary: `${points.length} points. ${encoded.x.label ?? 'x'} ranges ${range(xs, xFormat)}; ${
      encoded.y.label ?? 'y'
    } ranges ${range(ys, yFormat)}.${groups}`,
    plot: plotFor(frame, yBounds, (x) =>
      typeof x === 'number' ? scaleX(clampTo(x, xBounds), xBounds, frame) : undefined,
    ),
  };
}
