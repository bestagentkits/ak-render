/**
 * The text side of an encoded chart: legend entries, the generated summary,
 * and the fallback table. Values are formatted with the chart's encoding, so
 * the summary, the table and the hover labels read the same.
 */

import { seriesClass } from './chart-scales.js';
import type { NumberFormatter } from './chart-svg-parts.js';
import type { ChartInput, ChartTable, LegendEntry } from './chart-types.js';
import { escapeText } from './escape.js';

/** One entry per series, only when there are two or more (colour then carries meaning). */
export function seriesLegend(input: ChartInput): LegendEntry[] {
  if (input.series.length < 2) return [];
  return input.series.map((series, index) => ({
    label: series.label,
    swatch: seriesClass(index),
  }));
}

/** One entry per category, for kinds that colour each category (pie, donut). */
export function categoryLegend(input: ChartInput): LegendEntry[] {
  return input.labels.map((label, index) => ({ label, swatch: seriesClass(index) }));
}

export function seriesSummary(input: ChartInput, format: NumberFormatter): string {
  return input.series
    .map(
      (series) =>
        `${series.label}: ${input.labels
          .map((label, index) => {
            const value = series.values[index];
            return value === undefined ? label : `${label} ${format(value)}`;
          })
          .join(', ')}`,
    )
    .join('. ');
}

/** The original series-by-category table, with formatted values. */
export function seriesTable(input: ChartInput, format: NumberFormatter): ChartTable {
  return {
    columns: [
      { label: 'Series', numeric: false },
      ...input.labels.map((label) => ({ label, numeric: true })),
    ],
    rows: input.series.map((series) => [
      series.label,
      ...input.labels.map((_, index) => {
        const value = series.values[index];
        return value === undefined ? '' : format(value);
      }),
    ]),
  };
}

/** The table markup; the first cell of each row is its header. */
export function renderTable(caption: string, table: ChartTable): string {
  const numeric = (index: number) => (table.columns[index]?.numeric ? ' class="ak-num"' : '');
  const head = table.columns
    .map((column, index) => `<th scope="col"${numeric(index)}>${escapeText(column.label)}</th>`)
    .join('');
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) =>
            index === 0
              ? `<th scope="row">${escapeText(cell)}</th>`
              : `<td${numeric(index)}>${escapeText(cell)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  return `<table class="ak-chart-table"><caption>${escapeText(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderLegend(entries: readonly LegendEntry[]): string {
  if (entries.length === 0) return '';
  return `<ul class="ak-chart-legend" aria-hidden="true">${entries
    .map(
      (entry) =>
        `<li><span class="ak-chart-swatch ${entry.swatch}"></span>${escapeText(entry.label)}</li>`,
    )
    .join('')}</ul>`;
}
