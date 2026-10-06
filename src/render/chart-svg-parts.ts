/**
 * SVG fragments every chart kind shares: gridlines and ticks, category
 * labels, hover value labels and axis titles. Colour never appears here;
 * shapes carry classes and the stylesheet maps them onto tokens.
 */

import {
  clampTo,
  type Frame,
  formatNumber,
  round,
  scaleX,
  scaleY,
  type TickBounds,
  tickValues,
} from './chart-scales.js';
import type { ChartSeries, KindRender } from './chart-types.js';
import { escapeText } from './escape.js';

export type NumberFormatter = (value: number) => string;

/** Horizontal gridlines with value ticks; the zero line reads as the axis. */
export function gridAndTicks(
  bounds: TickBounds,
  frame: Frame,
  format: NumberFormatter = formatNumber,
): string {
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
        format(value),
      )}</text>`,
    );
  }
  return parts.join('');
}

/**
 * Gridlines for an encoded axis whose author bounds need not land on a step:
 * ticks stop at the last step inside the bounds, and the plot floor is drawn
 * as the axis when zero is outside the range.
 */
export function boundedGridAndTicks(
  bounds: TickBounds,
  frame: Frame,
  format: NumberFormatter,
): string {
  const ticks = tickValues(bounds);
  const hasZero = ticks.includes(0);
  return ticks
    .map((value, index) => {
      const y = scaleY(value, bounds, frame);
      const axis = value === 0 || (!hasZero && index === 0);
      return `<line class="${axis ? 'ak-chart-axis' : 'ak-chart-grid'}" x1="${frame.left}" y1="${y}" x2="${
        frame.width - frame.right
      }" y2="${y}"/><text class="ak-chart-label" x="${frame.left - 8}" y="${round(y + 4)}" text-anchor="end">${escapeText(
        format(value),
      )}</text>`;
    })
    .join('');
}

/** Vertical gridlines and tick labels for a numeric x axis. */
export function numericXTicks(
  bounds: TickBounds,
  frame: Frame,
  format: NumberFormatter,
  ticks: readonly number[] = tickValues(bounds),
): string {
  return ticks
    .map((value) => {
      const x = scaleX(value, bounds, frame);
      return `<line class="ak-chart-grid" x1="${x}" y1="${frame.top}" x2="${x}" y2="${
        frame.height - frame.bottom
      }"/><text class="ak-chart-label" x="${x}" y="${frame.height - frame.bottom + 20}" text-anchor="middle">${escapeText(
        format(value),
      )}</text>`;
    })
    .join('');
}

/**
 * At most about eight evenly spaced label positions. The first and the last
 * category are always labelled, so a series never reads as ending early; when
 * the last would crowd the previous kept label, that one gives way.
 */
export function thinnedLabelIndexes(count: number): number[] {
  const step = Math.max(1, Math.ceil(count / 8));
  const indexes: number[] = [];
  for (let index = 0; index < count; index += step) indexes.push(index);
  const last = count - 1;
  const previous = indexes.at(-1);
  if (previous !== undefined && previous !== last) {
    if (indexes.length > 1 && last - previous < step) indexes.pop();
    indexes.push(last);
  }
  return indexes;
}

export function categoryLabels(
  labels: string[],
  position: (index: number) => number,
  frame: Frame,
): string {
  const parts: string[] = [];
  for (const index of thinnedLabelIndexes(labels.length)) {
    parts.push(
      `<text class="ak-chart-label" x="${position(index)}" y="${frame.height - frame.bottom + 20}" text-anchor="middle">${escapeText(
        labels[index] ?? '',
      )}</text>`,
    );
  }
  return parts.join('');
}

export function pointTitle(label: string, series: ChartSeries, index: number): string {
  return `${label}: ${series.label} ${series.values[index] ?? 0}`;
}

/**
 * A value label drawn directly after its mark. The stylesheet reveals it while
 * the mark is hovered or focused (`mark:hover + .ak-chart-value`), so the exact
 * number is one pointer move away without a tooltip script.
 */
export function valueLabel(x: number, y: number, value: number): string {
  return textValueLabel(x, y, formatNumber(value));
}

/**
 * A hover value label with preformatted text. `halo` outlines it in the
 * surface colour, for labels drawn over a filled mark.
 */
export function textValueLabel(x: number, y: number, text: string, halo = false): string {
  return `<text class="ak-chart-value${halo ? ' ak-chart-value--halo' : ''}" x="${round(x)}" y="${round(y)}" text-anchor="middle" aria-hidden="true">${escapeText(
    text,
  )}</text>`;
}

/** Axis titles: the y title above the value ticks, the x title centred under the categories. */
export function axisTitles(frame: Frame, x: string | undefined, y: string | undefined): string {
  const parts: string[] = [];
  if (y !== undefined && y !== '') {
    parts.push(
      `<text class="ak-chart-axis-title" x="${frame.left - 8}" y="${frame.top - 14}" text-anchor="end">${escapeText(y)}</text>`,
    );
  }
  if (x !== undefined && x !== '') {
    parts.push(
      `<text class="ak-chart-axis-title" x="${round(frame.left + (frame.width - frame.left - frame.right) / 2)}" y="${
        frame.height - 6
      }" text-anchor="middle">${escapeText(x)}</text>`,
    );
  }
  return parts.join('');
}

/** A rectangle as a path, so golden tests can pin its geometry in one attribute. */
export function rectPath(x: number, y: number, width: number, height: number): string {
  return `M${round(x)},${round(y)} h${round(width)} v${round(height)} h${round(-width)} Z`;
}

/** Bars wider than this read as slabs rather than marks. */
export const MAX_BAR_WIDTH = 56;

/** The index of a category label, or undefined when the axis has no such category. */
export function categoryIndex(labels: readonly string[], x: string | number): number | undefined {
  const index = labels.indexOf(String(x));
  return index < 0 ? undefined : index;
}

/** Overlay coordinates for a cartesian plot. */
export function plotFor(
  frame: Frame,
  bounds: TickBounds,
  xAt: (x: string | number) => number | undefined,
): NonNullable<KindRender['plot']> {
  return {
    top: frame.top,
    bottom: frame.height - frame.bottom,
    right: frame.width - frame.right,
    xAt,
    yAt: (y) => scaleY(clampTo(y, bounds), bounds, frame),
  };
}

/** Shorten text to `max` characters with an ellipsis. */
export function clipText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}
