/**
 * Markers and annotations on charts drawn on x/y axes.
 *
 * A marker is a dashed vertical rule with its label. An annotation is a
 * numbered callout at a point; the same numbers head the list under the chart
 * and the summary, so the note never depends on seeing the plot.
 */

import { round } from './chart-scales.js';
import type { NumberFormatter } from './chart-svg-parts.js';
import type { ChartAnnotation, ChartMarker, KindRender } from './chart-types.js';
import { escapeText } from './escape.js';

type Plot = NonNullable<KindRender['plot']>;

export function markerLayer(markers: readonly ChartMarker[], plot: Plot): string {
  return markers
    .map((marker) => {
      const x = plot.xAt(marker.x);
      if (x === undefined) return '';
      const flip = x > plot.right - 140;
      return `<g class="ak-chart-marker"><line class="ak-chart-marker-rule" x1="${x}" y1="${plot.top}" x2="${x}" y2="${plot.bottom}"/><text class="ak-chart-marker-label" x="${round(
        flip ? x - 6 : x + 6,
      )}" y="${plot.top + 10}" text-anchor="${flip ? 'end' : 'start'}">${escapeText(marker.label)}</text></g>`;
    })
    .join('');
}

export function annotationLayer(annotations: readonly ChartAnnotation[], plot: Plot): string {
  return annotations
    .map((note, index) => {
      const x = plot.xAt(note.x);
      if (x === undefined) return '';
      const y = plot.yAt(note.y);
      return `<g class="ak-chart-note"><circle class="ak-chart-note-dot" cx="${x}" cy="${y}" r="10"/><text class="ak-chart-note-number" x="${x}" y="${round(
        y + 4,
      )}" text-anchor="middle">${index + 1}</text></g>`;
    })
    .join('');
}

function where(x: string | number, y: number, xFormat: NumberFormatter, yFormat: NumberFormatter) {
  return `${typeof x === 'number' ? xFormat(x) : x}, ${yFormat(y)}`;
}

/** The visible numbered list of annotations under the chart. */
export function annotationList(
  annotations: readonly ChartAnnotation[],
  xFormat: NumberFormatter,
  yFormat: NumberFormatter,
): string {
  if (annotations.length === 0) return '';
  return `<ol class="ak-chart-notes">${annotations
    .map(
      (note) =>
        `<li>${escapeText(note.text)} <span class="ak-chart-note-at">(${escapeText(
          where(note.x, note.y, xFormat, yFormat),
        )})</span></li>`,
    )
    .join('')}</ol>`;
}

/** Sentences that restate the overlays for the summary. */
export function overlaySummary(
  markers: readonly ChartMarker[],
  annotations: readonly ChartAnnotation[],
  xFormat: NumberFormatter,
  yFormat: NumberFormatter,
): string {
  const parts: string[] = [];
  if (markers.length > 0) {
    parts.push(
      `Markers: ${markers
        .map(
          (marker) =>
            `${marker.label} at ${typeof marker.x === 'number' ? xFormat(marker.x) : marker.x}`,
        )
        .join('; ')}.`,
    );
  }
  if (annotations.length > 0) {
    parts.push(
      `Notes: ${annotations
        .map(
          (note, index) =>
            `${index + 1}. ${note.text} (${where(note.x, note.y, xFormat, yFormat)})`,
        )
        .join('; ')}.`,
    );
  }
  return parts.join(' ');
}
