import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';

function chartSpec(kind: string): string {
  return `version: 1
meta:
  title: Chart fixture
blocks:
  - type: hero
    title: Chart fixture
    description: ${kind}
  - type: chart
    kind: ${kind}
    title: Token usage
    labels: [Legacy, AK Render, Target]
    series:
      - label: Tokens
        values: [22000, 6500, 5000]
      - label: Baseline
        values: [22000, 22000, 22000]
`;
}

const KINDS = ['bar', 'line', 'area', 'pie', 'donut', 'sparkline', 'progress'] as const;

describe('SVG charts', () => {
  for (const kind of KINDS) {
    describe(kind, () => {
      const result = compile(chartSpec(kind));
      const { html } = result;

      it('renders deterministic SVG inside a figure', () => {
        expect(html).toContain('class="ak-chart"');
        expect(html).toMatch(/<svg viewBox="0 0 800 \d+"/u);
        expect(compile(chartSpec(kind)).html).toBe(html);
      });

      it('exposes the chart as an accessible image with a text summary', () => {
        expect(html).toMatch(/role="img"/u);
        expect(html).toMatch(/aria-label="[^"]*Legacy 22000/u);
        expect(html).toMatch(/<title>Token usage<\/title>/u);
      });

      it('offers the same values as a data table', () => {
        expect(html).toContain('Chart data table');
        expect(html).toContain('<th scope="col">Legacy</th>');
        expect(html).toContain('<th scope="row">Tokens</th>');
      });

      it('keeps every data point focusable with its own title where the kind has points', () => {
        if (kind === 'sparkline') {
          // A sparkline is a trend glyph: it carries the summary and the table
          // rather than per-point elements.
          expect(html).toMatch(/class="ak-chart-line ak-chart-s0"/u);
          return;
        }
        expect(html).toMatch(/tabindex="0"/u);
        const expectedTitle =
          kind === 'bar' || kind === 'line' || kind === 'area'
            ? '<title>Legacy: Tokens 22000</title>'
            : '<title>Legacy: 22000';
        expect(html).toContain(expectedTitle);
      });
    });
  }

  it('renders distinct geometry per chart kind', () => {
    const hashes = new Set(KINDS.map((kind) => compile(chartSpec(kind)).hash));
    expect(hashes.size).toBe(KINDS.length);
  });

  it('rounds coordinates so floating-point noise cannot break determinism', () => {
    const { html } = compile(chartSpec('pie'));
    for (const match of html.matchAll(/[MLA]\s*(-?\d+(?:\.\d+)?)/gu)) {
      const value = match[1] ?? '';
      const decimals = value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
      expect(decimals).toBeLessThanOrEqual(2);
    }
  });

  it('emits no external charting library', () => {
    const { html } = compile(chartSpec('bar'));
    expect(html).not.toContain('chart.js');
    expect(html).not.toContain('cdn.');
    expect(html).not.toMatch(/<script[^>]+src=/iu);
  });

  it('falls back to a progress block for a single bounded value', () => {
    const { html } = compile(`version: 1
meta:
  title: Progress
blocks:
  - type: progress
    label: Milestone C
    value: 70
    max: 100
`);
    expect(html).toContain('role="progressbar"'.replace('role="progressbar"', '<progress'));
    expect(html).toContain('70 / 100');
  });
});

describe('SVG chart polish', () => {
  it('colours series through palette classes and adds a legend for multiple series', () => {
    const { html } = compile(chartSpec('bar'));
    expect(html).toContain('ak-chart-bar ak-chart-s0');
    expect(html).toContain('ak-chart-bar ak-chart-s1');
    expect(html).toContain('<ul class="ak-chart-legend" aria-hidden="true">');
  });

  it('labels every slice of a donut in the legend and shows the total', () => {
    const { html } = compile(chartSpec('donut'));
    expect(html).toMatch(/ak-chart-swatch ak-chart-s2"><\/span>Target/u);
    expect(html).toContain('class="ak-chart-total"');
  });

  it('sizes a progress chart to its rows so no label is clipped', () => {
    const { html } = compile(chartSpec('progress'));
    expect(html).toMatch(/<svg viewBox="0 0 800 96"/u);
    expect(html).toContain('>AK Render</text>');
  });

  it('keeps a sparkline compact', () => {
    const { html } = compile(chartSpec('sparkline'));
    expect(html).toMatch(/<svg viewBox="0 0 800 72"/u);
  });

  it('draws gridlines on clean tick values', () => {
    const { html } = compile(chartSpec('line'));
    expect(html).toContain('class="ak-chart-grid"');
    expect(html).toContain('>20,000</text>');
  });

  it('fills an area with a per-chart gradient instead of a flat tint', () => {
    const { html } = compile(chartSpec('area'));
    expect(html).toMatch(/<linearGradient id="ak-grad-[A-Za-z0-9_-]+-0"/u);
    expect(html).toMatch(/class="ak-chart-area[^"]*"[^>]*fill="url\(#ak-grad-/u);
  });

  it('pairs every bar and point with a hidden value label for hover and focus', () => {
    const bar = compile(chartSpec('bar')).html;
    expect(bar).toMatch(/<rect class="ak-chart-bar[^>]*>.*?<\/rect><text class="ak-chart-value"/su);
    const line = compile(chartSpec('line')).html;
    expect(line).toContain('class="ak-chart-value"');
  });
});
