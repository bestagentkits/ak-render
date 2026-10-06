/**
 * Chart input types shared by the block layer and the SVG renderers.
 *
 * `ChartInput` without `encoded` is the original labels/series chart and keeps
 * its original markup. `encoded` carries everything the later kinds and the
 * dataset binding add: axis formats and bounds, points, cells, the fallback
 * table and the overlays. The block layer resolves all of it from the spec and
 * the materialized rows, so a renderer never reads the spec or the data itself.
 */

import type { FormatSpec } from '../data/format-value.js';

export interface ChartSeries {
  label: string;
  values: number[];
}

/** One axis or magnitude encoding, after the field has been resolved. */
export interface AxisSpec {
  label?: string;
  format: FormatSpec;
  min?: number;
  max?: number;
}

export interface ChartPoint {
  x: number;
  y: number;
  /** Index into `ChartInput.series`. */
  series: number;
}

export interface HeatCell {
  /** Index into `ChartInput.labels` (columns). */
  column: number;
  /** Index into `EncodedChart.rowLabels`. */
  row: number;
  value: number;
}

export interface ChartMarker {
  x: string | number;
  label: string;
}

export interface ChartAnnotation {
  x: string | number;
  y: number;
  text: string;
}

/** A fallback table: header labels, whether each column is numeric, and the formatted cells. */
export interface ChartTable {
  columns: { label: string; numeric: boolean }[];
  rows: string[][];
}

export interface EncodedChart {
  x: AxisSpec;
  y: AxisSpec;
  value: AxisSpec;
  /** The fallback table built from the materialized rows; absent for inline charts. */
  table?: ChartTable;
  /** Scatter points. */
  points: ChartPoint[];
  /** Heatmap cells and their row categories. */
  cells: HeatCell[];
  rowLabels: string[];
  /** Histogram samples. */
  samples: number[];
  /** Target histogram bin count. */
  bins: number;
  markers: ChartMarker[];
  annotations: ChartAnnotation[];
  /** Gauge target. */
  target?: number;
}

export interface ChartInput {
  kind: string;
  id: string;
  labels: string[];
  series: ChartSeries[];
  title?: string;
  description?: string;
  encoded?: EncodedChart;
}

/** One legend row: its text and the class that colours its swatch. */
export interface LegendEntry {
  label: string;
  swatch: string;
}

/** What one encoded kind draws, before the shared figure wraps it. */
export interface KindRender {
  body: string;
  viewBox: { width: number; height: number };
  legend: LegendEntry[];
  /** Generated summary sentence(s); the author's description replaces it. */
  summary: string;
  /** A kind-specific table (bins, running totals); otherwise the rows or the series table. */
  table?: ChartTable;
  /** Plot coordinates for overlays; set only on kinds drawn on x/y axes. */
  plot?: {
    top: number;
    bottom: number;
    right: number;
    xAt(x: string | number): number | undefined;
    yAt(y: number): number;
  };
}
