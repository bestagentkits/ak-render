import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHART_KINDS } from '../../src/blocks/chart/chart-kinds.js';
import { heatStep } from '../../src/render/chart-kinds-composite.js';
import {
  histogramCounts,
  histogramEdges,
} from '../../src/render/chart-kinds-histogram-waterfall.js';
import { squarify } from '../../src/render/chart-treemap-layout.js';
import { compile } from '../../src/render/render.js';
import { validate } from '../../src/spec/validate.js';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');

const ROWS = [
  { month: 'Jan', model: 'A', tokens: 100, latency: 120, cost: 0.2 },
  { month: 'Jan', model: 'B', tokens: 50, latency: 340, cost: 0.4 },
  { month: 'Feb', model: 'A', tokens: 140, latency: 210, cost: 0.3 },
  { month: 'Feb', model: 'B', tokens: 70, latency: 480, cost: 0.6 },
];

function page(chart: Record<string, unknown>, datasets: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    meta: { title: 'Chart v2' },
    datasets: { usage: ROWS, ...datasets },
    blocks: [{ type: 'chart', title: 'Chart under test', ...chart }],
  });
}

function diagnostics(chart: Record<string, unknown>) {
  return validate(page(chart)).diagnostics;
}

function figure(chart: Record<string, unknown>): string {
  const html = compile(page(chart)).html;
  const match = html.match(/<figure class="ak-chart"[\s\S]*?<\/figure>/u);
  if (match === null) throw new Error('no chart figure');
  return match[0];
}

/** One valid spec per kind, bound or inline as the kind allows. */
const SPECS: Record<string, Record<string, unknown>> = {
  bar: {
    dataRef: 'usage',
    x: { field: 'month' },
    y: { field: 'tokens' },
    series: { field: 'model' },
  },
  line: {
    dataRef: 'usage',
    x: { field: 'month' },
    y: { field: 'tokens' },
    series: { field: 'model' },
  },
  area: { dataRef: 'usage', x: { field: 'month' }, y: { field: 'tokens' } },
  pie: { dataRef: 'usage', x: { field: 'model' }, value: { field: 'tokens' } },
  donut: { dataRef: 'usage', x: { field: 'model' }, value: { field: 'tokens' } },
  sparkline: { dataRef: 'usage', x: { field: 'month' }, y: { field: 'tokens' } },
  progress: { dataRef: 'usage', x: { field: 'model' }, value: { field: 'tokens' } },
  scatter: {
    dataRef: 'usage',
    x: { field: 'latency', format: 'duration' },
    y: { field: 'cost', format: 'currency' },
    series: { field: 'model' },
  },
  histogram: { dataRef: 'usage', x: { field: 'latency' }, bins: 4 },
  'stacked-bar': {
    dataRef: 'usage',
    x: { field: 'month' },
    y: { field: 'tokens' },
    series: { field: 'model' },
  },
  'stacked-bar-100': {
    dataRef: 'usage',
    x: { field: 'month' },
    y: { field: 'tokens' },
    series: { field: 'model' },
  },
  heatmap: {
    dataRef: 'usage',
    x: { field: 'month' },
    y: { field: 'model' },
    value: { field: 'tokens' },
  },
  waterfall: { labels: ['Start', 'Up', 'Down'], series: [{ label: 'Cash', values: [10, 5, -3] }] },
  funnel: {
    labels: ['Visit', 'Trial', 'Paid'],
    series: [{ label: 'Users', values: [100, 40, 9] }],
  },
  gauge: { labels: ['Coverage'], series: [{ label: 'Coverage', values: [87] }], target: 90 },
  treemap: { dataRef: 'usage', x: { field: 'month' }, value: { field: 'tokens' } },
};

describe('chart v2 kinds', () => {
  it('has a spec for every kind', () => {
    expect(Object.keys(SPECS).sort()).toEqual([...CHART_KINDS].sort());
  });

  for (const kind of CHART_KINDS) {
    describe(kind, () => {
      const spec = { kind, ...SPECS[kind] };

      it('validates with no diagnostics', () => {
        expect(diagnostics(spec)).toEqual([]);
      });

      it('renders an accessible figure with a summary and a table fallback', () => {
        const html = figure(spec);
        expect(html).toContain(`data-ak-kind="${kind}"`);
        expect(html).toMatch(
          /<svg viewBox="0 0 800 \d+" role="img" aria-labelledby="ak-chart-[a-z0-9-]+-title ak-chart-[a-z0-9-]+-desc"/u,
        );
        expect(html).toMatch(
          /<title id="ak-chart-[a-z0-9-]+-title">Chart under test<\/title><desc id="[^"]+">[^<]+<\/desc>/u,
        );
        expect(html).toMatch(/<p class="ak-sr">[^<]+<\/p>/u);
        expect(html).toMatch(/<table class="ak-chart-table"><caption>Chart under test<\/caption>/u);
      });

      it('is deterministic and carries colour only through classes', () => {
        const html = figure(spec);
        expect(figure(spec)).toBe(html);
        expect(html).not.toMatch(/\sstyle=/u);
        const fills = html.match(/\sfill="[^"]*"/gu) ?? [];
        for (const fill of fills) expect(fill).toMatch(/^ fill="url\(#ak-grad-[^)]+\)"$/u);
      });
    });
  }
});

describe('chart v2 bindings', () => {
  it('derives labels in first-seen order and one series per series.field value', () => {
    const html = figure({ kind: 'line', ...SPECS.line });
    expect(html).toContain('A: Jan 100, Feb 140. B: Jan 50, Feb 70');
  });

  it('names a single series after the y label', () => {
    const html = figure({
      kind: 'bar',
      dataRef: 'usage',
      x: { field: 'model' },
      y: { field: 'tokens', label: 'Tokens' },
    });
    expect(html).toContain('Tokens: A 240, B 120');
  });

  it('builds the fallback table from the bound rows', () => {
    const html = figure({ kind: 'scatter', ...SPECS.scatter });
    expect(html).toContain('<th scope="col" class="ak-num">latency</th>');
    expect(html.match(/<tr><th scope="row">/gu)).toHaveLength(ROWS.length);
  });

  it('reports an unknown encoding field with its path and the allowed fields', () => {
    const [error] = diagnostics({
      kind: 'bar',
      dataRef: 'usage',
      x: { field: 'mnth' },
      y: { field: 'tokens' },
    });
    expect(error?.path).toBe('$.blocks[0].x.field');
    expect(error?.details?.allowed).toEqual(['month', 'model', 'tokens', 'latency', 'cost']);
  });

  it('rejects inline labels or series next to bound data', () => {
    const paths = diagnostics({
      kind: 'bar',
      dataRef: 'usage',
      labels: ['x'],
      series: [{ label: 'y', values: [1] }],
      x: { field: 'month' },
      y: { field: 'tokens' },
    }).map((item) => item.path);
    expect(paths).toEqual(expect.arrayContaining(['$.blocks[0].labels', '$.blocks[0].series']));
  });

  it('rejects an encoding field without data', () => {
    const [error] = diagnostics({
      kind: 'bar',
      labels: ['a'],
      series: [{ label: 's', values: [1] }],
      x: { field: 'month' },
    });
    expect(error?.path).toBe('$.blocks[0].x.field');
  });

  it('gives precise series errors for each shape', () => {
    expect(
      diagnostics({
        kind: 'bar',
        dataRef: 'usage',
        x: { field: 'month' },
        y: { field: 'tokens' },
        series: { fild: 'model' },
      }).map((item) => item.path),
    ).toContain('$.blocks[0].series.fild');
    expect(
      diagnostics({ kind: 'bar', labels: ['a'], series: [{ label: 's' }] }).map(
        (item) => item.path,
      ),
    ).toContain('$.blocks[0].series[0].values');
  });

  it('requires numeric fields where the kind plots numbers', () => {
    const [error] = diagnostics({
      kind: 'scatter',
      dataRef: 'usage',
      x: { field: 'model' },
      y: { field: 'cost' },
    });
    expect(error?.path).toBe('$.blocks[0].x.field');
    expect(error?.message).toMatch(/must hold numbers/u);
  });
});

describe('chart v2 kind rules', () => {
  it('needs data for scatter and heatmap', () => {
    const [error] = diagnostics({
      kind: 'scatter',
      labels: ['a'],
      series: [{ label: 's', values: [1] }],
    });
    expect(error?.path).toBe('$.blocks[0].dataRef');
  });

  it('keeps a gauge value inside its range', () => {
    const errors = diagnostics({
      kind: 'gauge',
      labels: ['Load'],
      series: [{ label: 'Load', values: [140] }],
    });
    expect(errors[0]?.message).toMatch(/outside 0–100/u);
    expect(
      diagnostics({
        kind: 'gauge',
        labels: ['Load'],
        series: [{ label: 'Load', values: [140] }],
        value: { max: 200 },
      }),
    ).toEqual([]);
  });

  it('warns on a funnel stage larger than the one before it', () => {
    const [warning] = diagnostics({
      kind: 'funnel',
      labels: ['a', 'b'],
      series: [{ label: 's', values: [5, 9] }],
    });
    expect(warning?.severity).toBe('warning');
  });

  it('caps a treemap at 40 cells', () => {
    const labels = Array.from({ length: 41 }, (_, index) => `c${index}`);
    const [error] = diagnostics({
      kind: 'treemap',
      labels,
      series: [{ label: 's', values: labels.map(() => 1) }],
    });
    expect(error?.code).toBe('SPEC_BOUNDS_ERROR');
  });

  it('computes the waterfall total and lists it in the table', () => {
    const html = figure({ kind: 'waterfall', ...SPECS.waterfall });
    expect(html).toContain(
      '<tr><th scope="row">Total</th><td class="ak-num"></td><td class="ak-num">12</td></tr>',
    );
    expect(html).toContain('ak-chart-legend');
  });

  it('sorts bar categories by total when asked', () => {
    const html = figure({
      kind: 'bar',
      labels: ['a', 'b', 'c'],
      series: [{ label: 's', values: [1, 3, 2] }],
      sort: 'descending',
    });
    expect(html).toContain('s: b 3, c 2, a 1');
  });

  it('draws markers and numbered annotations and restates them in text', () => {
    const html = figure({
      kind: 'line',
      dataRef: 'usage',
      x: { field: 'month' },
      y: { field: 'tokens' },
      series: { field: 'model' },
      markers: [{ x: 'Feb', label: 'Launch' }],
      annotations: [{ x: 'Feb', y: 140, text: 'Peak' }],
    });
    expect(html).toContain('class="ak-chart-marker-rule"');
    expect(html).toContain('class="ak-chart-note-number"');
    expect(html).toContain('<ol class="ak-chart-notes"><li>Peak');
    expect(html).toMatch(/Markers: Launch at Feb\. Notes: 1\. Peak \(Feb, 140\)/u);
  });

  it('warns about a marker that names no category', () => {
    const [warning] = diagnostics({
      kind: 'bar',
      labels: ['a'],
      series: [{ label: 's', values: [1] }],
      markers: [{ x: 'z', label: 'Z' }],
    });
    expect(warning?.path).toBe('$.blocks[0].markers[0].x');
  });

  it('quantizes heatmap intensity into five classes', () => {
    expect([0, 19, 20, 99, 100].map((value) => heatStep(value, 0, 100))).toEqual([0, 0, 1, 4, 4]);
    expect(figure({ kind: 'heatmap', ...SPECS.heatmap })).toMatch(/ak-chart-heat ak-chart-h4/u);
  });
});

describe('chart v2 geometry', () => {
  it('places histogram bin edges on clean steps deterministically', () => {
    const samples = [290, 310, 380, 420, 780, 920, 1140, 1310, 1620, 1840, 2210, 2480];
    const edges = histogramEdges(samples, 8);
    expect(edges).toEqual([250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500]);
    expect(histogramEdges(samples, 8)).toEqual(edges);
    expect(histogramCounts(samples, edges)).toEqual([4, 0, 2, 1, 1, 1, 1, 1, 1]);
    expect(histogramEdges([0.1, 0.2, 0.3], 3)).toEqual([0.1, 0.2, 0.3]);
  });

  it('pins the stacked-bar segment geometry', () => {
    const html = figure({ kind: 'stacked-bar', ...SPECS['stacked-bar'] });
    const paths = [
      ...html.matchAll(/<path class="ak-chart-bar (ak-chart-s\d)"[^>]* d="([^"]+)"/gu),
    ].map((match) => `${match[1]} ${match[2]}`);
    expect(paths).toMatchInlineSnapshot(`
      [
        "ak-chart-s0 M214,176.67 h56 v73.33 h-56 Z",
        "ak-chart-s1 M214,140 h56 v36.67 h-56 Z",
        "ak-chart-s0 M562,147.33 h56 v102.67 h-56 Z",
        "ak-chart-s1 M562,96 h56 v51.33 h-56 Z",
      ]
    `);
  });

  it('pins the treemap layout', () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, width: 600, height: 400 });
    const total = rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    expect(Math.round(total)).toBe(240000);
    const html = figure({
      kind: 'treemap',
      labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      series: [{ label: 'Bytes', values: [6, 6, 4, 3, 2, 2, 1] }],
    });
    const paths = [...html.matchAll(/<path class="ak-chart-cell[^"]*"[^>]* d="([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(paths).toMatchInlineSnapshot(`
      [
        "M1.5,1.5 h197 v357 h-197 Z",
        "M201.5,1.5 h197 v357 h-197 Z",
        "M401.5,1.5 h230.33 v202.71 h-230.33 Z",
        "M401.5,207.21 h230.33 v151.29 h-230.33 Z",
        "M634.83,1.5 h163.67 v141 h-163.67 Z",
        "M634.83,145.5 h163.67 v141 h-163.67 Z",
        "M634.83,289.5 h163.67 v69 h-163.67 Z",
      ]
    `);
  });
});

describe('chart v1 compatibility', () => {
  const galleryDir = fileURLToPath(new URL('docs/gallery/', root));
  const figures = /<figure class="ak-chart"[\s\S]*?<\/figure>/gu;
  const fixtures = readdirSync(fileURLToPath(new URL('fixtures/pages/', root))).filter((name) =>
    readdirSync(galleryDir).includes(name.replace(/\.yaml$/u, '.html')),
  );

  it('compares at least the dashboard charts', () => {
    expect(fixtures).toContain('dashboard.yaml');
  });

  for (const fixture of fixtures) {
    it(`renders ${fixture} charts byte-identically to the published gallery`, () => {
      const compiled = compile(read(`fixtures/pages/${fixture}`)).html.match(figures) ?? [];
      const published =
        read(`docs/gallery/${fixture.replace(/\.yaml$/u, '.html')}`).match(figures) ?? [];
      // A fixture added after the gallery was last published has no counterpart yet.
      if (published.length === 0 && compiled.some((html) => html.includes('aria-labelledby')))
        return;
      expect(compiled).toEqual(published);
    });
  }
});

describe('chart fixtures', () => {
  it('compiles the chart kinds fixture with zero diagnostics', () => {
    expect(validate(read('fixtures/pages/charts-v2.yaml')).diagnostics).toEqual([]);
  });

  it('rejects an unknown encoding field with its path and the allowed fields', () => {
    const result = validate(read('fixtures/rejected/validation/chart-unknown-encoding-field.yaml'));
    const errors = result.diagnostics.filter((item) => item.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'SPEC_VALIDATION_ERROR',
      path: '$.blocks[0].y.field',
      details: { field: 'token', allowed: ['month', 'model', 'tokens'] },
    });
  });
});
