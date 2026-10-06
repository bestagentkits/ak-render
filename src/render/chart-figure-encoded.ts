/**
 * The figure for an encoded chart: a later kind, a dataset binding, or an
 * original kind with formats, bounds or overlays.
 *
 * The SVG is `role="img"` and labelled by its own `<title>` and `<desc>`; the
 * figure adds the compiler-placed legend, the numbered notes, a screen-reader
 * summary and the fallback table, so every value is readable without the plot.
 */

import { encodedSeriesChart, scatterChart, stackedBarChart } from './chart-kinds-cartesian.js';
import { encodedOriginalKind, funnelChart, heatmapChart } from './chart-kinds-composite.js';
import { gaugeChart, treemapChart } from './chart-kinds-gauge-treemap.js';
import { histogramChart, waterfallChart } from './chart-kinds-histogram-waterfall.js';
import { annotationLayer, annotationList, markerLayer, overlaySummary } from './chart-overlays.js';
import { numberFormatter, safeId } from './chart-scales.js';
import { renderLegend, renderTable, seriesTable } from './chart-text.js';
import type { ChartInput, EncodedChart, KindRender } from './chart-types.js';
import { escapeText, renderAttributes } from './escape.js';

function drawKind(input: ChartInput, encoded: EncodedChart): KindRender {
  switch (input.kind) {
    case 'bar':
    case 'line':
    case 'area':
      return encodedSeriesChart(input, encoded);
    case 'stacked-bar':
      return stackedBarChart(input, encoded, false);
    case 'stacked-bar-100':
      return stackedBarChart(input, encoded, true);
    case 'histogram':
      return histogramChart(input, encoded);
    case 'waterfall':
      return waterfallChart(input, encoded);
    case 'scatter':
      return scatterChart(input, encoded);
    case 'heatmap':
      return heatmapChart(input, encoded);
    case 'funnel':
      return funnelChart(input, encoded);
    case 'gauge':
      return gaugeChart(input, encoded);
    case 'treemap':
      return treemapChart(input, encoded);
    default:
      return encodedOriginalKind(input, encoded);
  }
}

/** Kinds whose magnitude lives in the `value` encoding rather than on the y axis. */
const VALUE_KINDS: readonly string[] = ['pie', 'donut', 'progress', 'funnel', 'gauge', 'treemap'];

export function renderEncodedChart(input: ChartInput, encoded: EncodedChart): string {
  const drawn = drawKind(input, encoded);
  const xFormat = numberFormatter(encoded.x.format);
  const yFormat = numberFormatter(
    (VALUE_KINDS.includes(input.kind) ? encoded.value : encoded.y).format,
  );
  const plot = drawn.plot;
  const markers = plot === undefined ? [] : encoded.markers;
  const annotations = plot === undefined ? [] : encoded.annotations;
  const overlays =
    plot === undefined ? '' : `${markerLayer(markers, plot)}${annotationLayer(annotations, plot)}`;
  const authored = input.description !== undefined && input.description !== '';
  const summary = [
    authored ? input.description : drawn.summary,
    overlaySummary(markers, annotations, xFormat, yFormat),
  ]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
  const base = `ak-chart-${safeId(input.id)}`;
  const table = drawn.table ?? encoded.table ?? seriesTable(input, yFormat);
  const caption =
    input.title === undefined ? '' : `<figcaption>${escapeText(input.title)}</figcaption>`;

  return [
    `<figure class="ak-chart"${renderAttributes({ 'data-ak-kind': input.kind })}>`,
    caption,
    `<div class="ak-chart-canvas"><svg viewBox="0 0 ${drawn.viewBox.width} ${drawn.viewBox.height}" role="img"${renderAttributes(
      {
        'aria-labelledby': `${base}-title ${base}-desc`,
        'data-ak-chart': input.id,
      },
    )}><title${renderAttributes({ id: `${base}-title` })}>${escapeText(
      input.title ?? 'Chart',
    )}</title><desc${renderAttributes({ id: `${base}-desc` })}>${escapeText(summary)}</desc>${
      drawn.body
    }${overlays}</svg></div>`,
    renderLegend(drawn.legend),
    annotationList(annotations, xFormat, yFormat),
    `<p class="ak-sr">${escapeText(summary)}</p>`,
    `<details class="ak-details"><summary>Chart data table</summary>${renderTable(
      input.title ?? 'Chart data',
      table,
    )}</details>`,
    '</figure>',
  ]
    .filter((part) => part !== '')
    .join('');
}
