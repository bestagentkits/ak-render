import { describe, expect, it } from 'vitest';
import type { DataRow } from '../../src/data/dataset-types.js';
import { formatValue } from '../../src/data/format-value.js';
import { citeAgrees, parseAuthoredNumber } from '../../src/data/kpi-cite.js';
import { resolveBlockData } from '../../src/data/resolve-block-data.js';
import { applyTransform, rollupRow } from '../../src/data/transform-pipeline.js';
import { DiagnosticBag } from '../../src/diagnostics.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const MONTHLY: DataRow[] = [
  { month: 'Jul', revenue: 100, cost: 60 },
  { month: 'Aug', revenue: 120, cost: 0 },
  { month: 'Sep', revenue: 150, cost: null },
];

function column(rows: DataRow[], field: string): unknown[] {
  return rows.map((row) => row[field]);
}

describe('applyTransform: derive', () => {
  it('computes ratio and percentOf row by row, null on a zero or missing divisor', () => {
    const rows = applyTransform(MONTHLY, {
      derive: [
        { as: 'perCost', op: 'ratio', field: 'revenue', base: 'cost' },
        { as: 'costShare', op: 'percentOf', field: 'cost', base: 'revenue' },
      ],
    });
    expect(column(rows, 'perCost')).toEqual([100 / 60, null, null]);
    expect(column(rows, 'costShare')).toEqual([60, 0, null]);
  });

  it('compares with the previous row when delta and percentChange have no base', () => {
    const rows = applyTransform(MONTHLY, {
      derive: [
        { as: 'change', op: 'delta', field: 'revenue' },
        { as: 'growth', op: 'percentChange', field: 'revenue' },
      ],
    });
    expect(column(rows, 'change')).toEqual([null, 20, 30]);
    expect(column(rows, 'growth')).toEqual([null, 20, 25]);
  });

  it('compares with another field when delta and percentChange have a base', () => {
    const rows = applyTransform(MONTHLY, {
      derive: [
        { as: 'profit', op: 'delta', field: 'revenue', base: 'cost' },
        { as: 'markup', op: 'percentChange', field: 'revenue', base: 'cost' },
      ],
    });
    expect(column(rows, 'profit')).toEqual([40, 120, null]);
    expect(column(rows, 'markup')).toEqual([((100 - 60) / 60) * 100, null, null]);
  });

  it('computes share of the column total and a running sum', () => {
    const rows = applyTransform(MONTHLY, {
      derive: [
        { as: 'share', op: 'share', field: 'revenue' },
        { as: 'ytd', op: 'cumulative', field: 'cost' },
      ],
    });
    expect(column(rows, 'share')).toEqual([
      (100 / 370) * 100,
      (120 / 370) * 100,
      (150 / 370) * 100,
    ]);
    expect(column(rows, 'ytd')).toEqual([60, 60, 60]);
  });

  it('lets a later derived field read an earlier one, and sort by it', () => {
    const rows = applyTransform(MONTHLY, {
      derive: [
        { as: 'change', op: 'delta', field: 'revenue' },
        { as: 'total', op: 'cumulative', field: 'change' },
      ],
      sort: { by: 'total', direction: 'desc' },
    });
    expect(column(rows, 'month')).toEqual(['Sep', 'Aug', 'Jul']);
    expect(column(rows, 'total')).toEqual([50, 20, 0]);
  });

  it('derives after groupBy, on the grouped rows', () => {
    const rows = applyTransform(
      [
        { team: 'a', hours: 2 },
        { team: 'b', hours: 6 },
        { team: 'a', hours: 2 },
      ],
      {
        groupBy: { field: 'team', aggregate: 'sum', value: 'hours' },
        derive: [{ as: 'share', op: 'share', field: 'hours' }],
      },
    );
    expect(rows).toEqual([
      { team: 'a', hours: 4, share: 40 },
      { team: 'b', hours: 6, share: 60 },
    ]);
  });

  it('never mutates its input', () => {
    const input = MONTHLY.map((row) => ({ ...row }));
    applyTransform(input, { derive: [{ as: 'x', op: 'cumulative', field: 'revenue' }] });
    expect(input).toEqual(MONTHLY);
  });
});

describe('rollupRow', () => {
  it('totals the given rows, labelled in the first untotalled field', () => {
    const rows = applyTransform(MONTHLY, { limit: 2 });
    expect(rollupRow(rows, { fields: ['revenue', 'cost'] }, ['month', 'revenue', 'cost'])).toEqual({
      month: 'Total',
      revenue: 220,
      cost: 60,
    });
  });

  it('averages with mean, skipping nulls, and takes a custom label and field', () => {
    expect(
      rollupRow(
        MONTHLY,
        { fields: ['cost'], aggregate: 'mean', label: 'Average', labelField: 'month' },
        ['month', 'revenue', 'cost'],
      ),
    ).toEqual({ month: 'Average', revenue: null, cost: 30 });
  });

  it('turns a non-finite total into null', () => {
    const huge: DataRow[] = [{ n: Number.MAX_VALUE }, { n: Number.MAX_VALUE }];
    expect(rollupRow(huge, { fields: ['n'], label: 'x', labelField: 'n' }, ['n']).n).toBeNull();
  });
});

describe('applyTransform: non-finite results', () => {
  it('maps an overflowing derived or grouped value to null', () => {
    const rows = applyTransform(
      [
        { g: 'a', n: Number.MAX_VALUE },
        { g: 'a', n: Number.MAX_VALUE },
      ],
      {
        groupBy: { field: 'g', aggregate: 'sum', value: 'n' },
      },
    );
    expect(rows).toEqual([{ g: 'a', n: null }]);
    const derived = applyTransform([{ a: Number.MAX_VALUE, b: Number.MIN_VALUE }], {
      derive: [{ as: 'r', op: 'ratio', field: 'a', base: 'b' }],
    });
    expect(derived[0]?.r).toBeNull();
  });
});

describe('resolveBlockData: derive and rollup checks', () => {
  const datasets = { monthly: MONTHLY };

  function errors(transform: unknown, total = true): string[] {
    const bag = new DiagnosticBag();
    resolveBlockData({ dataRef: 'monthly', transform }, datasets, '$.blocks[0]', bag, { total });
    return bag.errors().map((item) => `${item.path}: ${item.message}`);
  }

  it('exposes derived fields to later stages and to the block', () => {
    const bag = new DiagnosticBag();
    const data = resolveBlockData(
      {
        dataRef: 'monthly',
        transform: {
          derive: [{ as: 'growth', op: 'percentChange', field: 'revenue' }],
          select: ['month', 'growth'],
          rollup: { fields: ['growth'], aggregate: 'mean' },
        },
      },
      datasets,
      '$.blocks[0]',
      bag,
      { total: true },
    );
    expect(bag.list()).toEqual([]);
    expect(data?.fields).toEqual(['month', 'growth']);
    expect(data?.rows).toHaveLength(3);
    expect(data?.total).toEqual({ month: 'Total', growth: 22.5 });
  });

  it('requires base for ratio and percentOf and refuses it for share and cumulative', () => {
    expect(
      errors({
        derive: [
          { as: 'a', op: 'ratio', field: 'revenue' },
          { as: 'b', op: 'share', field: 'revenue', base: 'cost' },
        ],
      }),
    ).toEqual([
      '$.blocks[0].transform.derive[0].base: "ratio" needs a "base" field to divide by',
      '$.blocks[0].transform.derive[1].base: "share" reads one field and takes no "base"',
    ]);
  });

  it('reports unknown fields, an overwriting name and a reserved name at their paths', () => {
    expect(
      errors({
        derive: [
          { as: 'revenue', op: 'delta', field: 'revenue' },
          { as: '__proto__', op: 'delta', field: 'nope' },
          { as: 'x', op: 'ratio', field: 'revenue', base: 'missing' },
        ],
      }).map((line) => line.split(':')[0]),
    ).toEqual([
      '$.blocks[0].transform.derive[0].as',
      '$.blocks[0].transform.derive[1].field',
      '$.blocks[0].transform.derive[1].as',
      '$.blocks[0].transform.derive[2].base',
    ]);
  });

  it('rejects an unknown op and more than eight derived fields through the schema', () => {
    expect(errors({ derive: [{ as: 'x', op: 'eval', field: 'revenue' }] })).toHaveLength(1);
    const many = Array.from({ length: 9 }, (_, index) => ({
      as: `d${index}`,
      op: 'cumulative',
      field: 'revenue',
    }));
    expect(errors({ derive: many })).toHaveLength(1);
  });

  it('checks rollup fields, its label field and that a label has a home', () => {
    expect(errors({ rollup: { fields: ['revenue', 'revenue', 'nope'] } })).toEqual([
      '$.blocks[0].transform.rollup.fields[1]: field "revenue" is totalled twice',
      '$.blocks[0].transform.rollup.fields[2]: unknown field "nope" in dataset "monthly"',
    ]);
    expect(errors({ rollup: { fields: ['revenue'], labelField: 'revenue' } })).toEqual([
      '$.blocks[0].transform.rollup.labelField: "revenue" is totalled, so it cannot also hold the label',
    ]);
    expect(
      errors({ select: ['revenue'], rollup: { fields: ['revenue'] } }).map(
        (line) => line.split(':')[0],
      ),
    ).toEqual(['$.blocks[0].transform.rollup.fields']);
  });

  it('rejects rollup on a block that cannot show a total row', () => {
    expect(
      errors({ rollup: { fields: ['revenue'] } }, false).map((line) => line.split(':')[0]),
    ).toEqual(['$.blocks[0].transform.rollup']);
  });
});

describe('formatValue: signed', () => {
  it.each([
    [12.5, { format: 'percent', signed: true }, '+12.5%'],
    [-12.5, { format: 'percent', signed: true }, '-12.5%'],
    [0, { format: 'percent', signed: true }, '0%'],
    [0.001, { format: 'number', signed: true }, '0'],
    [1200, { format: 'currency', signed: true }, '+$1,200.00'],
    [1500, { format: 'compact', signed: true }, '+1.5k'],
    [7, { signed: true }, '+7'],
    [7, { format: 'percent' }, '7%'],
  ] as const)('formats %s with %o as %s', (value, spec, expected) => {
    expect(formatValue(value, spec)).toBe(expected);
  });
});

describe('parseAuthoredNumber and citeAgrees', () => {
  it('reads one number with its scale and the precision it was written to', () => {
    expect(parseAuthoredNumber('$1.2M')).toEqual({ value: 1.2e6, tolerance: 0.05e6 });
    expect(parseAuthoredNumber('-€1,234')).toEqual({ value: -1234, tolerance: 0.5 });
    expect(parseAuthoredNumber('87%')).toEqual({ value: 87, tolerance: 0.5 });
    expect(parseAuthoredNumber('1.2 s', 'duration')).toEqual({ value: 1200, tolerance: 50 });
    expect(parseAuthoredNumber('3 GB', 'bytes')).toEqual({ value: 3e9, tolerance: 0.5e9 });
    expect(parseAuthoredNumber('n/a')).toBeUndefined();
  });

  it('agrees to the authored precision and disagrees beyond it', () => {
    expect(citeAgrees('$1.2M', 1_234_000, { format: 'currency' })).toBe(true);
    expect(citeAgrees('$1.3M', 1_234_000, { format: 'currency' })).toBe(false);
    expect(citeAgrees('42%', 41.6, { format: 'percent' })).toBe(true);
    expect(citeAgrees('41%', 41.6, { format: 'percent' })).toBe(false);
    expect(citeAgrees('n/a', 3, {})).toBe(false);
    expect(citeAgrees('north', 'north', { format: 'text' })).toBe(true);
  });

  it('ignores how the author spaced a unit', () => {
    expect(citeAgrees('120 ms', 120, { unit: 'ms' })).toBe(true);
    expect(citeAgrees('120  ms', 120, { unit: 'ms' })).toBe(true);
  });

  it('reads a suffix that is the unit as a label, not a scale', () => {
    expect(citeAgrees('3 B', 3, { unit: 'B' })).toBe(true);
    expect(citeAgrees('7 M', 7, { unit: 'M' })).toBe(true);
    expect(citeAgrees('7 M', 7, {})).toBe(false);
  });

  it('agrees when any number in the text states the cited value', () => {
    expect(citeAgrees('FY24 $1.2M', 1_200_000, { format: 'currency' })).toBe(true);
    expect(citeAgrees('FY24 $1.5M', 1_200_000, { format: 'currency' })).toBe(false);
    expect(citeAgrees('1.2 million', 1_200_000, {})).toBe(true);
  });
});

describe('kpi cite', () => {
  function page(items: unknown[]) {
    return {
      version: 1,
      meta: { title: 'KPIs' },
      datasets: { monthly: MONTHLY },
      blocks: [{ type: 'kpi', items }],
    };
  }

  function kpiValues(spec: unknown) {
    const result = normalizeSpec(spec);
    const node = result.ir.nodes.find((candidate) => candidate.type === 'kpi');
    const items = (node?.props.items ?? []) as Array<Record<string, unknown>>;
    return { diagnostics: result.diagnostics, values: items.map((item) => item.value) };
  }

  it('fills an omitted value from the cited dataset, through a transform', () => {
    const { diagnostics, values } = kpiValues(
      page([
        {
          label: 'Q3 revenue',
          cite: { dataRef: 'monthly', field: 'revenue', aggregate: 'sum', format: 'currency' },
        },
        {
          label: 'Sep growth',
          cite: {
            dataRef: 'monthly',
            field: 'growth',
            transform: { derive: [{ as: 'growth', op: 'percentChange', field: 'revenue' }] },
            format: 'percent',
            signed: true,
          },
        },
        { label: 'Months', cite: { dataRef: 'monthly', field: 'month', aggregate: 'count' } },
      ]),
    );
    expect(diagnostics).toEqual([]);
    expect(values).toEqual(['$370.00', '+25%', '3']);
  });

  it('keeps an agreeing authored value without a diagnostic', () => {
    const { diagnostics, values } = kpiValues(
      page([
        {
          label: 'Revenue',
          value: '$0.37k',
          cite: { dataRef: 'monthly', field: 'revenue', aggregate: 'sum' },
        },
      ]),
    );
    expect(diagnostics).toEqual([]);
    expect(values).toEqual(['$0.37k']);
  });

  it('warns, without rewriting, when an authored value disagrees with its cite', () => {
    const { diagnostics, values } = kpiValues(
      page([
        {
          label: 'Revenue',
          value: '$400',
          cite: { dataRef: 'monthly', field: 'revenue', aggregate: 'sum', format: 'currency' },
        },
      ]),
    );
    expect(values).toEqual(['$400']);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'SPEC_VALIDATION_ERROR',
        severity: 'warning',
        path: '$.blocks[0].items[0].value',
        details: expect.objectContaining({
          rule: 'kpi-cite',
          cited: 370,
          expected: '$370.00',
          authored: '$400',
        }),
      }),
    ]);
  });

  it('reports a missing value and cite, an unknown dataset and an unknown field as errors', () => {
    const { diagnostics } = kpiValues(
      page([
        { label: 'Nothing' },
        { label: 'Bad set', cite: { dataRef: 'nope', field: 'revenue' } },
        { label: 'Bad field', cite: { dataRef: 'monthly', field: 'profit' } },
      ]),
    );
    expect(diagnostics.map((item) => [item.severity, item.path])).toEqual([
      ['error', '$.blocks[0].items[0].value'],
      ['error', '$.blocks[0].items[1].cite.dataRef'],
      ['error', '$.blocks[0].items[2].cite.field'],
    ]);
    expect(diagnostics[2]?.details).toEqual(
      expect.objectContaining({ allowed: ['month', 'revenue', 'cost'] }),
    );
  });

  it('warns when a filled value has no number to show', () => {
    const { diagnostics, values } = kpiValues(
      page([{ label: 'Last cost', cite: { dataRef: 'monthly', field: 'cost' } }]),
    );
    expect(values).toEqual(['—']);
    expect(diagnostics.map((item) => [item.severity, item.path])).toEqual([
      ['warning', '$.blocks[0].items[0].cite'],
    ]);
  });

  it('rejects a filled value too long for the card', () => {
    const { diagnostics } = kpiValues({
      ...page([{ label: 'Note', cite: { dataRef: 'notes', field: 'text', format: 'text' } }]),
      datasets: { notes: [{ text: 'x'.repeat(41) }] },
    });
    expect(diagnostics.map((item) => [item.severity, item.path])).toEqual([
      ['error', '$.blocks[0].items[0].cite'],
    ]);
  });

  it('rejects a rollup inside a cite', () => {
    const { diagnostics } = kpiValues(
      page([
        {
          label: 'Revenue',
          cite: {
            dataRef: 'monthly',
            field: 'revenue',
            transform: { rollup: { fields: ['revenue'] } },
          },
        },
      ]),
    );
    expect(diagnostics.map((item) => item.path)).toEqual([
      '$.blocks[0].items[0].cite.transform.rollup',
    ]);
  });

  it('renders the filled value and compiles deterministically', () => {
    const spec = page([
      {
        label: 'Q3 revenue',
        cite: { dataRef: 'monthly', field: 'revenue', aggregate: 'sum', format: 'compact' },
      },
    ]);
    const first = compile(spec);
    expect(first.html).toContain('<p class="ak-kpi-value" data-ak-count>370</p>');
    expect(compile(spec).html).toBe(first.html);
  });
});

describe('rollup rendering', () => {
  const datasets = { monthly: MONTHLY };

  it('renders a data-table total as a table footer, outside the body rows', () => {
    const result = compile({
      version: 1,
      meta: { title: 'Totals' },
      datasets,
      blocks: [
        {
          type: 'data-table',
          dataRef: 'monthly',
          transform: { rollup: { fields: ['revenue'] } },
          columns: [{ key: 'month' }, { key: 'revenue', format: 'number' }],
        },
      ],
    });
    const body = result.html.slice(result.html.indexOf('<tbody'), result.html.indexOf('</tbody>'));
    expect(body).not.toContain('Total');
    expect(result.html).toMatch(/<tfoot><tr class="ak-dt-total">.*Total.*370.*<\/tr><\/tfoot>/su);
  });

  it('rejects a rollup on a chart', () => {
    const { diagnostics } = normalizeSpec({
      version: 1,
      meta: { title: 'Chart' },
      datasets,
      blocks: [
        {
          type: 'chart',
          kind: 'bar',
          dataRef: 'monthly',
          transform: { rollup: { fields: ['revenue'] } },
          x: { field: 'month' },
          y: { field: 'revenue' },
        },
      ],
    });
    expect(
      diagnostics.filter((item) => item.severity === 'error').map((item) => item.path),
    ).toEqual(['$.blocks[0].transform.rollup']);
  });

  it('keeps signed off the evidence widgets, which sign their own differences', () => {
    const { diagnostics } = normalizeSpec({
      version: 1,
      meta: { title: 'Bench' },
      blocks: [
        {
          type: 'benchmark-comparison',
          signed: true,
          items: [{ label: 'a', value: 1 }],
        },
      ],
    });
    expect(diagnostics.some((item) => item.path === '$.blocks[0].signed')).toBe(true);
  });
});
