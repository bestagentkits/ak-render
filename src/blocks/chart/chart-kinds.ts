/** Chart kinds, SVG-first and deterministic. */
export const CHART_KINDS = [
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'sparkline',
  'progress',
  'scatter',
  'histogram',
  'stacked-bar',
  'stacked-bar-100',
  'heatmap',
  'waterfall',
  'funnel',
  'gauge',
  'treemap',
] as const;

export type ChartKind = (typeof CHART_KINDS)[number];

/** The kinds that shipped first. Without encodings or extras they keep their original markup. */
export const V1_CHART_KINDS: readonly string[] = [
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'sparkline',
  'progress',
];

/** Kinds drawn on x/y axes: they take markers, annotations and `y.min`/`y.max`. */
export const CARTESIAN_KINDS: readonly string[] = [
  'bar',
  'line',
  'area',
  'scatter',
  'histogram',
  'stacked-bar',
  'stacked-bar-100',
  'waterfall',
];

/** Kinds whose x axis is numeric rather than categorical. */
export const NUMERIC_X_KINDS: readonly string[] = ['scatter', 'histogram'];

/** Kinds that draw one series of magnitudes per category. */
export const SINGLE_SERIES_KINDS: readonly string[] = [
  'pie',
  'donut',
  'progress',
  'waterfall',
  'funnel',
  'gauge',
  'treemap',
  'histogram',
];

/** Kinds whose category order `sort` may change. */
export const SORTABLE_KINDS: readonly string[] = ['bar', 'stacked-bar', 'funnel', 'treemap'];

/** Kinds that cannot be written with inline labels/series. */
export const DATA_ONLY_KINDS: readonly string[] = ['scatter', 'heatmap'];

/** Treemap cell limit: beyond it the cells stop being legible. */
export const MAX_TREEMAP_CELLS = 40;
