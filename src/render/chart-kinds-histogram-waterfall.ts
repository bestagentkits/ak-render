/**
 * Encoded charts that show a distribution or a running total: histogram and
 * waterfall. Bins snap to clean steps; a waterfall closes with a computed total.
 */

import {
  axisBounds,
  bandCentre,
  CARTESIAN_TITLED,
  clampTo,
  niceStep,
  numberFormatter,
  plotWidth,
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
  numericXTicks,
  plotFor,
  rectPath,
  textValueLabel,
} from './chart-svg-parts.js';
import type { ChartInput, EncodedChart, KindRender } from './chart-types.js';
import { escapeText } from './escape.js';

/**
 * Bin edges on clean steps (1, 2, 2.5 or 5 × 10ⁿ). `bins` is a target count:
 * the clean step whose bin count lands closest to it wins, the wider step on a
 * tie. Deterministic for a given input.
 */
export function histogramEdges(samples: readonly number[], bins: number): number[] {
  const finite = samples.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return [];
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  // One bin when every sample is equal, or when the values are too large for
  // clean steps to separate (1e16 + 4): its width must still be representable.
  const single = [low, high > low ? high : low + Math.max(1, Math.abs(low) * Number.EPSILON * 4)];
  if (low === high) return single;
  const target = Math.max(1, bins);
  const magnitude = 10 ** Math.floor(Math.log10((high - low) / target));
  const layout = (step: number) => {
    const start = Math.floor(low / step) * step;
    return { step, start, count: Math.max(1, Math.ceil((high - start) / step - 1e-9)) };
  };
  let best = layout(10 * magnitude);
  for (const factor of [5, 2.5, 2, 1]) {
    const candidate = layout(factor * magnitude);
    if (Math.abs(candidate.count - target) < Math.abs(best.count - target)) best = candidate;
  }
  const edges: number[] = [];
  for (let index = 0; index <= best.count; index += 1) {
    edges.push(Number((best.start + best.step * index).toPrecision(12)));
  }
  const increasing = edges.every((edge, index) => index === 0 || edge > (edges[index - 1] ?? edge));
  return increasing ? edges : single;
}

/** Samples per bin; each bin is [a, b) and the last is closed. */
export function histogramCounts(samples: readonly number[], edges: readonly number[]): number[] {
  const bins = Math.max(0, edges.length - 1);
  const counts = new Array<number>(bins).fill(0);
  if (bins === 0) return counts;
  const start = edges[0] ?? 0;
  const span = (edges[bins] ?? start) - start;
  for (const value of samples) {
    if (!Number.isFinite(value)) continue;
    const slot = Math.min(
      bins - 1,
      Math.max(0, Math.floor(((value - start) / span) * bins + 1e-9)),
    );
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return counts;
}

export function histogramChart(input: ChartInput, encoded: EncodedChart): KindRender {
  const frame = CARTESIAN_TITLED;
  const xFormat = numberFormatter(encoded.x.format);
  const count = numberFormatter({ format: 'integer' });
  const edges = histogramEdges(encoded.samples, encoded.bins);
  const counts = histogramCounts(encoded.samples, edges);
  const first = edges[0] ?? 0;
  const last = edges[edges.length - 1] ?? 1;
  const step = counts.length === 0 ? 1 : (last - first) / counts.length;
  const xBounds: TickBounds = { min: first, max: last, step };
  // Ticks on clean multiples inside the binned range, not on every edge.
  const tickStep = niceStep(Math.max(last - first, step), 5);
  const xTicks: number[] = [];
  for (
    let tick = Math.ceil(first / tickStep) * tickStep;
    tick <= last + tickStep / 1000;
    tick += tickStep
  ) {
    xTicks.push(Number(tick.toPrecision(12)));
  }
  const yBounds = axisBounds(counts, encoded.y, true);
  const zeroY = scaleY(clampTo(0, yBounds), yBounds, frame);
  const ranges = counts.map(
    (_, index) => `${xFormat(edges[index] ?? 0)}–${xFormat(edges[index + 1] ?? 0)}`,
  );
  const bars = counts.map((value, index) => {
    const x1 = scaleX(edges[index] ?? 0, xBounds, frame);
    const x2 = scaleX(edges[index + 1] ?? 0, xBounds, frame);
    const y = scaleY(clampTo(value, yBounds), yBounds, frame);
    const width = Math.max(1, x2 - x1 - 2);
    return `<path class="ak-chart-bar ${seriesClass(0)}" tabindex="0" d="${rectPath(x1 + 1, y, width, zeroY - y)}"><title>${escapeText(
      `${ranges[index]}: ${count(value)}`,
    )}</title></path>${textValueLabel(x1 + 1 + width / 2, y - 7, count(value))}`;
  });
  const busiest = counts.indexOf(Math.max(...counts, 0));
  const label = encoded.x.label ?? input.series[0]?.label ?? 'Values';
  return {
    body: `${boundedGridAndTicks(yBounds, frame, count)}${numericXTicks(xBounds, frame, tickFormatter(encoded.x.format, { ...xBounds, step: tickStep }), xTicks)}${bars.join(
      '',
    )}${axisTitles(frame, encoded.x.label, encoded.y.label ?? 'Count')}`,
    viewBox: frame,
    legend: [],
    summary:
      counts.length === 0
        ? `${label}: no values.`
        : `${label}: ${encoded.samples.length} values in ${counts.length} bins from ${xFormat(first)} to ${xFormat(
            last,
          )}; the most common range is ${ranges[busiest]} (${count(counts[busiest] ?? 0)}).`,
    table: {
      columns: [
        { label: label, numeric: false },
        { label: 'Count', numeric: true },
      ],
      rows: counts.map((value, index) => [ranges[index] ?? '', count(value)]),
    },
    plot: plotFor(frame, yBounds, (x) =>
      typeof x === 'number' ? scaleX(clampTo(x, xBounds), xBounds, frame) : undefined,
    ),
  };
}

/** Running total of signed changes, closed by a computed total bar. */
export function waterfallChart(input: ChartInput, encoded: EncodedChart): KindRender {
  const frame = CARTESIAN_TITLED;
  const format = numberFormatter(encoded.y.format);
  const signed = (value: number) => (value > 0 ? `+${format(value)}` : format(value));
  const series = input.series[0] ?? { label: '', values: [] };
  const steps = input.labels.map((label, index) => ({ label, value: series.values[index] ?? 0 }));
  const running: number[] = [];
  let total = 0;
  for (const step of steps) {
    total += step.value;
    running.push(total);
  }
  const labels = [...input.labels, 'Total'];
  const groups = labels.length;
  const bounds = axisBounds([0, ...running], encoded.y, true);
  const band = plotWidth(frame) / groups;
  const width = round(Math.max(4, Math.min(MAX_BAR_WIDTH, band * 0.62)));
  const parts: string[] = [];
  let previous = 0;
  const bar = (
    index: number,
    from: number,
    to: number,
    tone: string,
    text: string,
    title: string,
  ) => {
    const x = round(bandCentre(index, groups, frame) - width / 2);
    const y1 = scaleY(clampTo(from, bounds), bounds, frame);
    const y2 = scaleY(clampTo(to, bounds), bounds, frame);
    const top = Math.min(y1, y2);
    parts.push(
      `<path class="ak-chart-bar ${tone}" tabindex="0" d="${rectPath(x, top, width, Math.max(1, Math.abs(y1 - y2)))}"><title>${escapeText(
        title,
      )}</title></path>`,
      textValueLabel(x + width / 2, top - 7, text),
    );
    return { x, y: y2 };
  };
  steps.forEach((step, index) => {
    const next = previous + step.value;
    const end = bar(
      index,
      previous,
      next,
      step.value >= 0 ? 'ak-chart-up' : 'ak-chart-down',
      signed(step.value),
      `${step.label}: ${signed(step.value)}, running total ${format(next)}`,
    );
    const nextX = round(bandCentre(index + 1, groups, frame) - width / 2);
    parts.push(
      `<line class="ak-chart-connector" x1="${round(end.x + width)}" y1="${end.y}" x2="${nextX}" y2="${end.y}"/>`,
    );
    previous = next;
  });
  bar(steps.length, 0, total, 'ak-chart-net', format(total), `Total: ${format(total)}`);
  return {
    body: `${boundedGridAndTicks(bounds, frame, tickFormatter(encoded.y.format, bounds))}${categoryLabels(
      labels,
      (index) => bandCentre(index, groups, frame),
      frame,
    )}${parts.join('')}${axisTitles(frame, encoded.x.label, encoded.y.label)}`,
    viewBox: frame,
    legend: [
      { label: 'Increase', swatch: 'ak-chart-up' },
      { label: 'Decrease', swatch: 'ak-chart-down' },
      { label: 'Total', swatch: 'ak-chart-net' },
    ],
    summary: `${series.label}: ${steps
      .map((step) => `${step.label} ${signed(step.value)}`)
      .join(', ')}; total ${format(total)}.`,
    table: {
      columns: [
        { label: encoded.x.label ?? 'Step', numeric: false },
        { label: 'Change', numeric: true },
        { label: 'Running total', numeric: true },
      ],
      rows: [
        ...steps.map((step, index) => [
          step.label,
          signed(step.value),
          format(running[index] ?? 0),
        ]),
        ['Total', '', format(total)],
      ],
    },
    plot: plotFor(frame, bounds, (x) => {
      const index = categoryIndex(labels, x);
      return index === undefined ? undefined : bandCentre(index, groups, frame);
    }),
  };
}
