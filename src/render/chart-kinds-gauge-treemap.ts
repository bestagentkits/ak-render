/**
 * Gauge and treemap. A gauge is a 180° band with an optional target tick; a
 * treemap is a squarified layout of tinted, labelled cells.
 */

import { numberFormatter, round, seriesClass, WIDTH } from './chart-scales.js';
import { clipText, rectPath } from './chart-svg-parts.js';
import { squarify } from './chart-treemap-layout.js';
import type { ChartInput, EncodedChart, KindRender } from './chart-types.js';
import { escapeText } from './escape.js';

const TREEMAP_HEIGHT = 360;

function arcPoint(cx: number, cy: number, radius: number, angle: number): string {
  return `${round(cx + radius * Math.cos(angle))},${round(cy + radius * Math.sin(angle))}`;
}

/** An annular band from `from` to `to` (radians, clockwise in SVG space). */
function band(cx: number, cy: number, outer: number, inner: number, from: number, to: number) {
  return `M${arcPoint(cx, cy, outer, from)} A${outer},${outer} 0 0 1 ${arcPoint(cx, cy, outer, to)} L${arcPoint(
    cx,
    cy,
    inner,
    to,
  )} A${inner},${inner} 0 0 0 ${arcPoint(cx, cy, inner, from)} Z`;
}

export function gaugeChart(input: ChartInput, encoded: EncodedChart): KindRender {
  const format = numberFormatter(encoded.value.format);
  const min = encoded.value.min ?? 0;
  const max = encoded.value.max ?? 100;
  const value = input.series[0]?.values[0] ?? 0;
  const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const cx = WIDTH / 2;
  const cy = 200;
  const outer = 160;
  const inner = 118;
  const start = Math.PI;
  const label = input.labels[0] ?? input.series[0]?.label ?? '';
  const parts = [
    `<path class="ak-chart-track" d="${band(cx, cy, outer, inner, start, 2 * Math.PI)}"/>`,
  ];
  if (ratio > 0) {
    parts.push(
      `<path class="ak-chart-slice ak-chart-gauge ${seriesClass(0)}" tabindex="0" d="${band(
        cx,
        cy,
        outer,
        inner,
        start,
        start + Math.PI * ratio,
      )}"><title>${escapeText(`${label}: ${format(value)} of ${format(max)}`)}</title></path>`,
    );
  }
  const target = encoded.target;
  let targetText = '';
  if (target !== undefined && max > min) {
    const angle = start + Math.PI * Math.min(1, Math.max(0, (target - min) / (max - min)));
    parts.push(
      `<line class="ak-chart-target" x1="${round(cx + (inner - 8) * Math.cos(angle))}" y1="${round(
        cy + (inner - 8) * Math.sin(angle),
      )}" x2="${round(cx + (outer + 8) * Math.cos(angle))}" y2="${round(cy + (outer + 8) * Math.sin(angle))}"/>`,
      `<text class="ak-chart-label" x="${round(cx + (outer + 16) * Math.cos(angle))}" y="${round(
        cy + (outer + 16) * Math.sin(angle),
      )}" text-anchor="${Math.cos(angle) < -0.2 ? 'end' : Math.cos(angle) > 0.2 ? 'start' : 'middle'}">${escapeText(
        `Target ${format(target)}`,
      )}</text>`,
    );
    targetText = `; target ${format(target)}`;
  }
  parts.push(
    `<text class="ak-chart-total" x="${cx}" y="${cy - 14}" text-anchor="middle">${escapeText(format(value))}</text>`,
    `<text class="ak-chart-label" x="${cx}" y="${cy + 6}" text-anchor="middle">${escapeText(label)}</text>`,
    `<text class="ak-chart-label" x="${cx - (outer + inner) / 2}" y="${cy + 22}" text-anchor="middle">${escapeText(
      format(min),
    )}</text>`,
    `<text class="ak-chart-label" x="${cx + (outer + inner) / 2}" y="${cy + 22}" text-anchor="middle">${escapeText(
      format(max),
    )}</text>`,
  );
  return {
    body: parts.join(''),
    viewBox: { width: WIDTH, height: 232 },
    legend: [],
    summary: `${label}: ${format(value)} on a scale of ${format(min)} to ${format(max)}${targetText}.`,
    table: {
      columns: [
        { label: 'Measure', numeric: false },
        { label: 'Value', numeric: true },
        { label: 'Minimum', numeric: true },
        { label: 'Maximum', numeric: true },
        ...(target === undefined ? [] : [{ label: 'Target', numeric: true }]),
      ],
      rows: [
        [
          label,
          format(value),
          format(min),
          format(max),
          ...(target === undefined ? [] : [format(target)]),
        ],
      ],
    },
  };
}

export function treemapChart(input: ChartInput, encoded: EncodedChart): KindRender {
  const format = numberFormatter(encoded.value.format);
  const share = numberFormatter({ format: 'percent' });
  const values = input.labels.map((_, index) => input.series[0]?.values[index] ?? 0);
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const rects = squarify(values, { x: 0, y: 0, width: WIDTH, height: TREEMAP_HEIGHT });
  const parts: string[] = [];
  rects.forEach((rect, index) => {
    const value = values[index] ?? 0;
    if (value <= 0 || rect.width <= 0 || rect.height <= 0) return;
    const label = input.labels[index] ?? '';
    const percent = total > 0 ? share((value / total) * 100) : '';
    parts.push(
      `<path class="ak-chart-cell ${seriesClass(index)}" tabindex="0" d="${rectPath(
        rect.x + 1.5,
        rect.y + 1.5,
        Math.max(0, rect.width - 3),
        Math.max(0, rect.height - 3),
      )}"><title>${escapeText(`${label}: ${format(value)} (${percent})`)}</title></path>`,
    );
    if (rect.width >= 64 && rect.height >= 34) {
      parts.push(
        `<text class="ak-chart-cell-label" x="${round(rect.x + 10)}" y="${round(rect.y + 22)}">${escapeText(
          clipText(label, Math.floor((rect.width - 16) / 7.5)),
        )}</text>`,
      );
      if (rect.height >= 54) {
        parts.push(
          `<text class="ak-chart-cell-value" x="${round(rect.x + 10)}" y="${round(rect.y + 40)}">${escapeText(
            clipText(`${format(value)} · ${percent}`, Math.floor((rect.width - 16) / 7)),
          )}</text>`,
        );
      }
    }
  });
  return {
    body: parts.join(''),
    viewBox: { width: WIDTH, height: TREEMAP_HEIGHT },
    legend: [],
    summary: `${input.series[0]?.label ?? 'Total'} ${format(total)}: ${input.labels
      .map((label, index) => {
        const value = values[index] ?? 0;
        return `${label} ${format(value)}${total > 0 ? ` (${share((Math.max(0, value) / total) * 100)})` : ''}`;
      })
      .join(', ')}`,
  };
}
