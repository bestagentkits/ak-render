import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { quantizePin } from '../../src/blocks/evidence/annotated-image.js';
import { compareMetric, verdictSummary } from '../../src/blocks/evidence/benchmark-verdict.js';
import { quantizeShares } from '../../src/blocks/evidence/metric-breakdown.js';
import { isRenderError, type RenderError } from '../../src/errors.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const fixturePath = fileURLToPath(
  new URL('../../fixtures/pages/evidence-widgets.yaml', import.meta.url),
);

function page(blocks: unknown[], extra: Record<string, unknown> = {}) {
  return { version: 1, meta: { title: 'Evidence' }, blocks, ...extra };
}

function diagnostics(spec: unknown) {
  const all = normalizeSpec(spec).diagnostics;
  return {
    errors: all.filter((item) => item.severity === 'error'),
    warnings: all.filter((item) => item.severity === 'warning'),
  };
}

function main(html: string): string {
  return /<main[\s\S]*<\/main>/u.exec(html)?.[0] ?? '';
}

const BENCHMARK = {
  type: 'benchmark-comparison',
  id: 'bench',
  baseline: { label: 'v0.2' },
  candidate: { label: 'v0.3' },
  metrics: [
    {
      label: 'p95 latency',
      baseline: 420,
      candidate: 310,
      unit: 'ms',
      better: 'lower',
      format: 'number',
    },
    { label: 'Throughput', baseline: 1200, candidate: 1480, unit: 'req/s', better: 'higher' },
    { label: 'Bundle size', baseline: 70.2, candidate: 70.4, unit: 'kB', better: 'lower' },
    { label: 'Error rate', baseline: 0.8, candidate: 1.1, format: 'percent', better: 'lower' },
  ],
};

describe('benchmark-comparison', () => {
  it('judges each direction and the unchanged threshold', () => {
    expect(compareMetric(420, 310, 'lower')).toMatchObject({ delta: -110, verdict: 'improved' });
    expect(compareMetric(420, 310, 'higher').verdict).toBe('regressed');
    expect(compareMetric(100, 120, 'higher').verdict).toBe('improved');
    expect(compareMetric(100, 120, 'lower').verdict).toBe('regressed');
    // |Δ%| < 1 is unchanged in either direction; exactly 1% is a change.
    expect(compareMetric(100, 100.99, 'higher').verdict).toBe('unchanged');
    expect(compareMetric(100, 99.01, 'lower').verdict).toBe('unchanged');
    expect(compareMetric(100, 101, 'higher').verdict).toBe('improved');
    expect(compareMetric(-50, -40, 'higher')).toMatchObject({ percent: 20, verdict: 'improved' });
  });

  it('omits the percentage for a zero baseline and judges by direction', () => {
    expect(compareMetric(0, 3, 'lower')).toEqual({ delta: 3, percent: null, verdict: 'regressed' });
    expect(compareMetric(0, 3, 'higher').verdict).toBe('improved');
    expect(compareMetric(0, 0, 'higher')).toEqual({
      delta: 0,
      percent: null,
      verdict: 'unchanged',
    });
  });

  it('summarizes the non-zero verdict counts in a fixed order', () => {
    expect(verdictSummary(['regressed', 'improved', 'improved', 'improved'])).toBe(
      '3 improved, 1 regressed',
    );
    expect(verdictSummary(['unchanged'])).toBe('1 unchanged');
  });

  it('compiles the documented example with zero warnings', () => {
    const result = compile(page([BENCHMARK]));
    expect(result.warnings).toEqual([]);
    const html = main(result.html);
    expect(html).toContain(
      '<span class="ak-bench-tally">2 improved, 1 regressed, 1 unchanged</span>',
    );
    expect(html).toContain('−110\u00a0ms<span class="ak-bench-pct">−26.2%</span>');
    expect(html).toContain('+280\u00a0req/s<span class="ak-bench-pct">+23.3%</span>');
    expect(result.features).toContain('evidence');
  });

  it('states every verdict in words, not by colour alone', () => {
    const html = main(compile(page([BENCHMARK])).html);
    for (const verdict of ['improved', 'regressed', 'unchanged']) {
      expect(html).toMatch(
        new RegExp(`<span class="ak-badge" data-tone="[a-z]+">${verdict}</span>`, 'u'),
      );
    }
    expect(html).toContain('lower is better');
    expect(html).toContain('higher is better');
  });

  it('shows "new" for a zero baseline', () => {
    const html = main(
      compile(
        page([
          {
            ...BENCHMARK,
            metrics: [{ label: 'Retries', baseline: 0, candidate: 4, better: 'lower' }],
          },
        ]),
      ).html,
    );
    expect(html).toContain('+4<span class="ak-bench-pct">new</span>');
  });

  it('reads metrics from a dataset through the field mapping', () => {
    const spec = page(
      [
        {
          type: 'benchmark-comparison',
          baseline: { label: 'Before' },
          candidate: { label: 'After' },
          dataRef: 'runs',
          fields: { metric: 'name', baseline: 'before', candidate: 'after', better: 'goal' },
          unit: 'ms',
        },
      ],
      {
        datasets: {
          runs: [
            { name: 'Cold start', before: 900, after: 600, goal: 'lower' },
            { name: 'Warm start', before: 120, after: 120, goal: 'lower' },
          ],
        },
      },
    );
    const { errors } = diagnostics(spec);
    expect(errors).toEqual([]);
    const html = main(compile(spec).html);
    expect(html).toContain('<span class="ak-bench-metric">Cold start</span>');
    expect(html).toContain('<td class="ak-num" data-label="Before">900\u00a0ms</td>');
    expect(html).toContain('1 improved, 1 unchanged');
  });

  it('reports unknown fields, bad rows and a missing source of metrics', () => {
    const base = {
      type: 'benchmark-comparison',
      baseline: { label: 'a' },
      candidate: { label: 'b' },
    };
    const unknown = diagnostics(
      page([{ ...base, data: [{ metric: 'x', baseline: 1, candidate: 2 }] }]),
    ).errors;
    expect(unknown.map((item) => item.path)).toContain('$.blocks[0].fields.better');
    expect(unknown[0]?.details?.allowed).toEqual(['metric', 'baseline', 'candidate']);

    const badRow = diagnostics(
      page([{ ...base, data: [{ metric: 'x', baseline: 'n/a', candidate: 2, better: 'faster' }] }]),
    ).errors.map((item) => item.message);
    expect(badRow).toContain('row 0: baseline field "baseline" must hold a number');
    expect(badRow).toContain('row 0: better field "better" must be lower or higher');

    expect(diagnostics(page([base])).errors.map((item) => item.path)).toEqual([
      '$.blocks[0].metrics',
    ]);
    const both = diagnostics(
      page([{ ...base, metrics: BENCHMARK.metrics, data: [{ metric: 'x' }] }]),
    ).errors;
    expect(both.map((item) => item.message)).toContain(
      'use either metrics or bound data (dataRef/data), not both',
    );
  });

  it('rejects a direction other than lower or higher', () => {
    const { errors } = diagnostics(
      page([{ ...BENCHMARK, metrics: [{ label: 'x', baseline: 1, candidate: 2, better: 'up' }] }]),
    );
    expect(errors.map((item) => item.path)).toContain('$.blocks[0].metrics[0].better');
  });
});

describe('metric-breakdown', () => {
  it('quantizes shares to whole percents that agree with the bar', () => {
    expect(quantizeShares([1, 1, 1], 3)).toEqual([34, 33, 33]);
    expect(quantizeShares([50, 30, 20], 100)).toEqual([50, 30, 20]);
    expect(quantizeShares([2, 2], 10)).toEqual([20, 20]);
    expect(quantizeShares([0.4, 0.4, 99.2], 100)).toEqual([1, 0, 99]);
    expect(quantizeShares([0, 0], 0)).toEqual([0, 0]);
    for (const values of [
      [7, 13, 29, 51],
      [1, 2, 3, 4, 5, 6, 7],
      [3.3, 3.3, 3.4],
    ]) {
      const shares = quantizeShares(
        values,
        values.reduce((sum, value) => sum + value, 0),
      );
      expect(shares.reduce((sum, value) => sum + value, 0)).toBe(100);
    }
  });

  it('renders the computed total, static percentage attributes and the share list', () => {
    const result = compile(
      page([
        {
          type: 'metric-breakdown',
          parts: [
            { label: 'Network', value: 120 },
            { label: 'Render', value: 60 },
            { label: 'Script', value: 20, tone: 'warning' },
          ],
          unit: 'ms',
        },
      ]),
    );
    expect(result.warnings).toEqual([]);
    const html = main(result.html);
    expect(html).toContain('<span class="ak-label">Total</span><strong>200\u00a0ms</strong>');
    expect(html).toContain('data-ak-pct="60" data-series="0"');
    expect(html).toContain('data-ak-pct="10" data-series="2" data-tone="warning"');
    expect(html).toContain('<span class="ak-breakdown-share">30%</span>');
    expect(html).not.toMatch(/style="/u);
    expect(result.html).toContain('.ak-breakdown-seg[data-ak-pct="100"]{width:100%}');
  });

  it('warns when the parts exceed an authored total and rejects negative rows', () => {
    const over = diagnostics(
      page([
        {
          type: 'metric-breakdown',
          total: { label: 'Budget', value: 100 },
          parts: [
            { label: 'a', value: 80 },
            { label: 'b', value: 40 },
          ],
        },
      ]),
    );
    expect(over.errors).toEqual([]);
    expect(over.warnings.map((item) => item.path)).toEqual(['$.blocks[0].total.value']);

    const negative = diagnostics(
      page([
        {
          type: 'metric-breakdown',
          data: [
            { label: 'a', value: 5 },
            { label: 'b', value: -1 },
          ],
        },
      ]),
    ).errors;
    expect(negative.map((item) => item.message)).toContain(
      'row 1: value field "value" must hold a non-negative number',
    );
    const inline = diagnostics(
      page([
        {
          type: 'metric-breakdown',
          parts: [
            { label: 'a', value: 5 },
            { label: 'b', value: -1 },
          ],
        },
      ]),
    ).errors;
    expect(inline.map((item) => item.path)).toContain('$.blocks[0].parts[1].value');
  });
});

describe('annotated-image', () => {
  const IMAGE = {
    type: 'annotated-image',
    src: 'assets/shot-dashboard.webp',
    alt: 'Dashboard',
    notes: [
      { x: 35, y: 60, label: 'Cache miss', text: 'Cold path.' },
      { x: 100, y: 0, label: 'Corner' },
    ],
  };

  it('snaps coordinates to the 5% grid', () => {
    expect([0, 2.4, 2.5, 33, 37.5, 99, 100].map(quantizePin)).toEqual([0, 0, 5, 35, 40, 100, 100]);
  });

  it('emits pin attributes and the notes list, with no inline style', () => {
    const result = compile(page([IMAGE]));
    expect(result.warnings).toEqual([]);
    const html = main(result.html);
    expect(html).toContain('<li class="ak-pin" data-x="35" data-y="60">1</li>');
    expect(html).toContain('<li class="ak-pin" data-x="100" data-y="0">2</li>');
    expect(html).toContain('<ol class="ak-annotated-pins" aria-hidden="true">');
    expect(html).toContain('<p><strong>Cache miss</strong> Cold path.</p>');
    expect(html).not.toMatch(/style="/u);
    expect(result.features).toContain('annotated-image');
    expect(result.html).toContain('.ak-pin[data-x="35"]{left:35%}');
    expect(result.html).toContain('.ak-pin[data-y="60"]{top:60%}');
  });

  it('warns when a coordinate was snapped', () => {
    const { warnings } = diagnostics(page([{ ...IMAGE, notes: [{ x: 33, y: 60, label: 'a' }] }]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ path: '$.blocks[0].notes[0].x', details: { snapped: 35 } });
  });

  it('rejects a remote image the network policy does not allow', () => {
    const remote = page([{ ...IMAGE, src: 'https://cdn.example.com/shot.png' }]);
    expect(diagnostics(remote).errors.map((item) => item.path)).toEqual(['$.blocks[0].src']);
    try {
      compile(remote);
      throw new Error('expected a rejection');
    } catch (error) {
      expect(isRenderError(error)).toBe(true);
      expect((error as RenderError).path).toBe('$.blocks[0].src');
    }
  });

  it('loads an allowed remote image and adds its origin to the CSP', () => {
    const html = compile(
      page([{ ...IMAGE, src: 'https://cdn.example.com/shot.png' }], {
        policy: { network: { allow: ['images'] } },
      }),
    ).html;
    expect(html).toContain('<img src="https://cdn.example.com/shot.png"');
    expect(html).toMatch(/img-src [^"]*https:\/\/cdn\.example\.com; media-src/u);
  });
});

describe('references', () => {
  const ITEMS = [
    {
      id: 'smith-2024',
      title: 'Caching at scale',
      authors: 'A. Smith',
      source: 'ACM Queue',
      year: 2024,
      href: 'https://example.com/paper',
      note: 'Section `3`.',
    },
    { id: 'doe-2023', title: 'Internal memo' },
  ];

  it('gives every entry a stable ref- anchor and never adds a remote origin', () => {
    const result = compile(page([{ type: 'references', title: 'Sources', items: ITEMS }]));
    expect(result.warnings).toEqual([]);
    const html = main(result.html);
    expect(html).toContain('<li id="ref-smith-2024" class="ak-ref">');
    expect(html).toContain(
      '<li id="ref-doe-2023" class="ak-ref"><p class="ak-ref-title"><cite>Internal memo</cite></p></li>',
    );
    expect(html).toContain('<p class="ak-ref-meta">A. Smith · ACM Queue · 2024</p>');
    expect(html).toContain('<p class="ak-ref-note">Section <code>3</code>.</p>');
    expect(result.html).not.toMatch(/-src [^"]*example\.com/u);
  });

  it('lets other blocks link to an entry', () => {
    const { errors } = diagnostics(
      page([
        { type: 'link', label: 'See [1]', href: '#ref-smith-2024' },
        { type: 'references', items: ITEMS },
      ]),
    );
    expect(errors).toEqual([]);
  });

  it('rejects an id used twice, within a list or across lists', () => {
    const within = diagnostics(page([{ type: 'references', items: [ITEMS[0], ITEMS[0]] }])).errors;
    expect(within.map((item) => item.path)).toEqual(['$.blocks[0].items[1].id']);
    const across = diagnostics(
      page([
        { type: 'references', id: 'first', items: [ITEMS[0]] },
        { type: 'references', items: [ITEMS[1], ITEMS[0]] },
      ]),
    ).errors;
    expect(across.map((item) => item.path)).toEqual(['$.blocks[1].items[1].id']);
    expect(across[0]?.message).toContain('block "first"');
  });

  it('rejects an id that is not anchor-safe', () => {
    const { errors } = diagnostics(
      page([{ type: 'references', items: [{ id: 'Smith 2024', title: 'x' }] }]),
    );
    expect(errors.map((item) => item.path)).toEqual(['$.blocks[0].items[0].id']);
  });
});

describe('evidence fixture', () => {
  it('compiles with zero warnings and deterministically', () => {
    const source = readFileSync(fixturePath, 'utf8');
    const first = compile(source, { source: 'evidence-widgets.yaml' });
    expect(first.warnings).toEqual([]);
    expect(compile(source, { source: 'evidence-widgets.yaml' }).hash).toBe(first.hash);
    expect(first.features).toEqual(expect.arrayContaining(['evidence', 'annotated-image']));
  });
});
