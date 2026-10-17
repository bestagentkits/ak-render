import { describe, expect, it } from 'vitest';
import { DATA_LIMITS } from '../../src/data/dataset-types.js';
import { compile } from '../../src/render/render.js';
import { validate } from '../../src/spec/validate.js';

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

describe('extreme chart values', () => {
  const limit = DATA_LIMITS.maxNumberMagnitude;
  type Row = Record<string, number | string>;
  const page = (blocks: object[], rows?: Row[]) => ({
    version: 1,
    meta: { title: 'Extreme' },
    ...(rows === undefined ? {} : { datasets: { d: rows } }),
    blocks,
  });
  const encoded = (kind: string, rows: Row[], extra: object = {}) =>
    page([{ type: 'chart', kind, title: kind, dataRef: 'd', ...extra }], rows);
  /** Chart markup only: embedded fonts are base64 and may spell "NaN". */
  const chartMarkup = (spec: object) => {
    const result = validate(spec);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    return (compile(spec).html.match(/<figure class="ak-chart[\s\S]*?<\/figure>/gu) ?? []).join('');
  };
  const xy = { x: { field: 'n' }, y: { field: 'v' } };

  const cases: [string, object][] = [
    [
      'every v1 kind at the limit',
      page(
        KINDS.map((kind) => ({
          type: 'chart',
          kind,
          title: kind,
          labels: ['a', 'b'],
          series: [
            {
              label: 'S',
              values: [limit, ['pie', 'donut', 'progress'].includes(kind) ? limit : -limit],
            },
          ],
        })),
      ),
    ],
    [
      'a line spanning ±limit',
      encoded(
        'line',
        [
          { x: 'a', v: limit },
          { x: 'b', v: -limit },
        ],
        { x: { field: 'x' }, y: { field: 'v' } },
      ),
    ],
    ['a single epoch-nanosecond point', encoded('scatter', [{ n: 1729000000000000000, v: 3 }], xy)],
    [
      'equal points at the limit with a marker',
      encoded(
        'scatter',
        [
          { n: -limit, v: 1 },
          { n: -limit, v: 2 },
        ],
        { ...xy, markers: [{ x: 1, label: 'm' }] },
      ),
    ],
    [
      'flat sparklines',
      page([
        {
          type: 'chart',
          kind: 'sparkline',
          title: 'a',
          labels: ['a', 'b'],
          series: [{ label: 'S', values: [limit, limit] }],
        },
        {
          type: 'chart',
          kind: 'sparkline',
          title: 'b',
          labels: ['a'],
          series: [{ label: 'S', values: [1e16] }],
        },
      ]),
    ],
    [
      'a histogram finer than the float spacing',
      encoded('histogram', [{ n: 1e16 }, { n: 10000000000000002 }], { x: { field: 'n' } }),
    ],
    [
      'a funnel whose conversion overflows',
      page([
        {
          type: 'chart',
          kind: 'funnel',
          title: 'f',
          labels: ['a', 'b', 'c'],
          series: [{ label: 'S', values: [1e-300, -limit, 1e-300] }],
        },
      ]),
    ],
    [
      'an axis narrower than a tick',
      encoded('line', [{ x: 'a', v: 1e-300 }], {
        x: { field: 'x' },
        y: { field: 'v', min: 1e-300, max: 1.0000000000000002e-300 },
      }),
    ],
  ];

  for (const [name, spec] of cases) {
    it(`draws ${name} without NaN or Infinity`, () => {
      expect(chartMarkup(spec)).not.toMatch(/NaN|Infinity/u);
    });
  }

  it('rejects a value beyond the limit at its dataset cell', () => {
    const result = validate(
      encoded(
        'line',
        [
          { x: 'a', v: 1e308 },
          { x: 'b', v: 5e-324 },
        ],
        { x: { field: 'x' }, y: { field: 'v' } },
      ),
    );
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ['SPEC_BOUNDS_ERROR', '$.datasets.d[0].v'],
      ['SPEC_BOUNDS_ERROR', '$.datasets.d[1].v'],
    ]);
  });

  it('rejects a number prop beyond the limit at its path, after its own range', () => {
    const spec = encoded('line', [{ x: 'a', v: 1 }], {
      x: { field: 'x' },
      y: { field: 'v', min: -1e305 },
    });
    expect(validate(spec).diagnostics.map((item) => [item.code, item.path])).toEqual([
      ['SPEC_BOUNDS_ERROR', '$.blocks[0].y.min'],
    ]);
    const bins = encoded('histogram', [{ n: 1 }], { x: { field: 'n' }, bins: 1e305 });
    expect(validate(bins).diagnostics.map((item) => item.message)).toEqual([
      expect.stringContaining('above the maximum'),
    ]);
  });
});
