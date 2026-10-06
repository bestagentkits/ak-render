import { describe, expect, it } from 'vitest';
import { isIsoDate } from '../../src/blocks/controls/date-input.js';
import { fitAdapterMarkup } from '../../src/diagram/adapter-markup-fit.js';
import { compile } from '../../src/index.js';
import {
  histogramCounts,
  histogramEdges,
} from '../../src/render/chart-kinds-histogram-waterfall.js';
import { tickFormatter, tickValues } from '../../src/render/chart-scales.js';
import { validate } from '../../src/spec/validate.js';

/**
 * Edge cases found in review of the widget, chart and data code: each one
 * produced wrong output before, so each is pinned here.
 */
describe('widget edge cases', () => {
  it('hides filtered data-table rows in the phone card layout', () => {
    const html = compile(
      `version: 1
meta: { title: T }
datasets:
  rows:
    - { name: a, n: 1 }
    - { name: b, n: 2 }
blocks:
  - type: data-table
    dataRef: rows
    columns:
      - { key: name, label: Name }
      - { key: n, label: N, type: number }
`,
    ).html;
    expect(html).toMatch(/tbody tr\[hidden\]\{display:none\}/u);
  });

  it('keeps chart ticks finer than two decimals distinct', () => {
    const bounds = { min: 0, max: 0.004, step: 0.001 };
    const ticks = tickValues(bounds);
    expect(ticks).toEqual([0, 0.001, 0.002, 0.003, 0.004]);
    const format = tickFormatter({}, bounds);
    expect(new Set(ticks.map(format)).size).toBe(ticks.length);
  });

  it('keeps histogram edges finite and increasing for huge, close values', () => {
    for (const samples of [
      [1e16, 1e16 + 4, 1e16 + 2],
      [1e16, 1e16],
    ]) {
      const edges = histogramEdges(samples, 5);
      expect(edges.every(Number.isFinite)).toBe(true);
      for (let index = 1; index < edges.length; index += 1) {
        expect(edges[index]).toBeGreaterThan(edges[index - 1] ?? Number.NaN);
      }
      const counts = histogramCounts(samples, edges);
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(samples.length);
    }
  });

  it('leaves sections behind visibleWhen out of the page outline', () => {
    const sections = ['One', 'Two', 'Three', 'Four']
      .map(
        (title, index) => `  - type: section
    id: s${index}
    title: ${title}
${index === 3 ? '    visibleWhen: { path: state.view, equals: more }\n' : ''}    blocks:
      - { type: text, text: Body ${title} }
`,
      )
      .join('');
    const html = compile(`version: 1
meta: { title: T }
state: { view: less }
blocks:
${sections}`).html;
    const outline = /<nav class="ak-toc"[\s\S]*?<\/nav>/u.exec(html)?.[0] ?? '';
    expect(outline).toContain('Three');
    expect(outline).not.toContain('Four');
  });

  it('gives a log level named after an Object member the neutral tone', () => {
    const html = compile(`version: 1
meta: { title: T }
datasets:
  log:
    - { level: constructor, message: hello }
blocks:
  - type: log-viewer
    dataRef: log
`).html;
    const tones = [...html.matchAll(/data-tone="([^"]*)"/gu)].map((match) => match[1]);
    expect(tones.length).toBeGreaterThan(0);
    for (const tone of tones) expect(tone).toMatch(/^[a-z]+$/u);
  });

  it('refuses prototype member names as dataset fields', () => {
    const result = validate(
      JSON.stringify({
        version: 1,
        meta: { title: 'T' },
        datasets: { d: [JSON.parse('{"__proto__": 1, "a": 2}')] },
        blocks: [{ type: 'text', text: 'hi' }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.path)).toContain('$.datasets.d[0].__proto__');
  });

  it('accepts ISO dates in years 0001 to 0099', () => {
    expect(isIsoDate('0050-02-28')).toBe(true);
    expect(isIsoDate('0004-02-29')).toBe(true);
    expect(isIsoDate('0100-02-29')).toBe(false);
    expect(isIsoDate('2024-13-01')).toBe(false);
  });

  it('refuses diagram markup that loads or animates in a URL', () => {
    for (const markup of [
      '<svg><video poster="https://example.com/a.png"></video></svg>',
      '<svg><a><set attributeName="href" to="https://example.com"/></a></svg>',
    ]) {
      const fitted = fitAdapterMarkup(markup, 'ak-diagram-x');
      expect(fitted.ok, markup).toBe(false);
      expect(fitted.ok ? '' : fitted.reason, markup).toMatch(/poster|href/u);
    }
  });
});
