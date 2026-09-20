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
        expect(html).toMatch(/<svg viewBox="0 0 640 240"/u);
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
          expect(html).toContain('class="ak-chart-line"');
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
