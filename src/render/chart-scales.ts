/**
 * Chart scales and geometry primitives.
 *
 * Every coordinate passes through `round()` (two decimals) before it reaches
 * the markup, so floating-point noise never breaks byte-determinism. Axis
 * bounds end on clean ticks (1, 2, 2.5 or 5 × 10ⁿ).
 */

import { type FormatSpec, formatValue } from '../data/format-value.js';
import type { ChartSeries } from './chart-types.js';

export interface Bounds {
  min: number;
  max: number;
}

export interface TickBounds extends Bounds {
  step: number;
}

export interface Frame {
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
export const WIDTH = 800;
/** Number of distinct series colours the stylesheet defines. */
export const PALETTE_SIZE = 6;

export const CARTESIAN: Frame = {
  width: WIDTH,
  height: 300,
  top: 20,
  right: 36,
  bottom: 36,
  left: 56,
};
export const RADIAL: Frame = { width: WIDTH, height: 240, top: 0, right: 0, bottom: 0, left: 0 };
export const SPARK: Frame = { width: WIDTH, height: 72, top: 10, right: 10, bottom: 10, left: 10 };
/** Encoded cartesian charts reserve room for axis titles and formatted ticks. */
export const CARTESIAN_TITLED: Frame = {
  width: WIDTH,
  height: 300,
  top: 30,
  right: 36,
  bottom: 50,
  left: 68,
};

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Group digits with a thin comma, deterministically and without locale data. */
export function formatNumber(value: number): string {
  const rounded = round(value);
  const [whole = '0', fraction] = String(Math.abs(rounded)).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `${rounded < 0 ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/**
 * A number formatter for an axis or magnitude encoding. `text` (the schema
 * default) reads as a plain grouped number with the unit, if any.
 */
export function numberFormatter(spec: FormatSpec): (value: number) => string {
  const format = spec.format === undefined || spec.format === 'text' ? 'number' : spec.format;
  // Only floating-point noise is removed here; the format owns the decimals,
  // so a fine-grained value is not rounded away before it is formatted.
  return (value) => formatValue(denoise(value), { ...spec, format });
}

/** Drop floating-point noise (0.1 + 0.2) without rounding real precision away. */
export function denoise(value: number): number {
  return Number(value.toPrecision(12));
}

export function seriesClass(index: number): string {
  return `ak-chart-s${index % PALETTE_SIZE}`;
}

/** Round a span up to 1, 2, 2.5 or 5 times a power of ten, so ticks read cleanly. */
export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(count, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = [1, 2, 2.5, 5].find((candidate) => normalized <= candidate) ?? 10;
  return factor * magnitude;
}

/** Axis bounds that include zero and end on a clean tick. */
export function niceBounds(series: ChartSeries[]): TickBounds {
  const values = series.flatMap((entry) => entry.values).filter((value) => Number.isFinite(value));
  return niceRange(Math.min(0, ...values), Math.max(0, ...values));
}

/** Clean-tick bounds around a raw range. */
export function niceRange(rawMin: number, rawMax: number): TickBounds {
  if (rawMax === rawMin) return { min: rawMin, max: rawMin + 1, step: 0.25 };
  const step = niceStep(rawMax - rawMin, 4);
  return {
    min: Math.floor(rawMin / step) * step,
    max: Math.ceil(rawMax / step) * step,
    step,
  };
}

/**
 * Bounds for an encoded value axis: the data range (with zero when `zero`),
 * overridden by the author's `min`/`max`, with a clean step between them.
 */
export function axisBounds(
  values: readonly number[],
  axis: { min?: number; max?: number },
  zero: boolean,
): TickBounds {
  const finite = values.filter((value) => Number.isFinite(value));
  const low = finite.length === 0 ? 0 : Math.min(...finite, ...(zero ? [0] : []));
  const high = finite.length === 0 ? 1 : Math.max(...finite, ...(zero ? [0] : []));
  const nice = niceRange(low, high);
  const min = axis.min ?? nice.min;
  const max = axis.max ?? nice.max;
  if (max <= min) return nice;
  if (axis.min === undefined && axis.max === undefined) return nice;
  return { min, max, step: niceStep(max - min, 4) };
}

export function plotWidth(frame: Frame): number {
  return frame.width - frame.left - frame.right;
}

export function plotHeight(frame: Frame): number {
  return frame.height - frame.top - frame.bottom;
}

export function scaleY(value: number, bounds: Bounds, frame: Frame): number {
  const ratio = (value - bounds.min) / (bounds.max - bounds.min);
  return round(frame.top + plotHeight(frame) * (1 - ratio));
}

/** A value clamped into the bounds, so an out-of-range mark stays inside the plot. */
export function clampTo(value: number, bounds: Bounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export function scaleX(value: number, bounds: Bounds, frame: Frame): number {
  const ratio = (value - bounds.min) / (bounds.max - bounds.min);
  return round(frame.left + plotWidth(frame) * ratio);
}

/** Point charts span the plot edge to edge. */
export function pointX(index: number, count: number, frame: Frame): number {
  if (count <= 1) return round(frame.left + plotWidth(frame) / 2);
  return round(frame.left + (plotWidth(frame) * index) / (count - 1));
}

/** Bar groups sit in equal bands, labelled at the band centre. */
export function bandCentre(index: number, count: number, frame: Frame): number {
  const band = plotWidth(frame) / Math.max(count, 1);
  return round(frame.left + band * index + band / 2);
}

/** Fragment-safe id fragment derived from a block id. */
export function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/gu, '-');
}

/** Ticks from `min` to `max` in `step` increments, rounded. */
export function tickValues(bounds: TickBounds): number[] {
  const steps = Math.round((bounds.max - bounds.min) / bounds.step);
  const values: number[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const value = denoise(bounds.min + bounds.step * index);
    if (value <= bounds.max + bounds.step / 1000) values.push(value);
  }
  return values;
}

/**
 * The formatter for axis ticks: like `numberFormatter`, but whole-number
 * currency ticks drop their cents ($15,000 rather than $15,000.00) unless the
 * author fixed `decimals`.
 */
export function tickFormatter(spec: FormatSpec, bounds: TickBounds): (value: number) => string {
  const whole = Number.isInteger(bounds.step) && Number.isInteger(bounds.min);
  if (spec.format === 'currency' && spec.decimals === undefined && whole) {
    return numberFormatter({ ...spec, decimals: 0 });
  }
  // A step finer than the format's default two decimals would print every
  // tick the same ("0 | 0 | 0"), so the ticks get the decimals the step needs.
  if (spec.decimals === undefined && bounds.step > 0 && bounds.step < 0.01) {
    const needed = Math.min(4, Math.ceil(-Math.log10(bounds.step) - 1e-9));
    return numberFormatter({ ...spec, decimals: needed });
  }
  return numberFormatter(spec);
}
