import { describe, expect, it } from 'vitest';
import type { DataRow } from '../../src/data/dataset-types.js';
import { resolveBlockData } from '../../src/data/resolve-block-data.js';
import { applyTransform, compareScalars } from '../../src/data/transform-pipeline.js';
import { DiagnosticBag } from '../../src/diagnostics.js';

const ROWS: DataRow[] = [
  { region: 'apac', product: 'a', revenue: 120, units: 3 },
  { region: 'emea', product: 'b', revenue: 80, units: 2 },
  { region: 'apac', product: 'c', revenue: 40, units: null },
  { region: 'amer', product: 'd', revenue: 80, units: 5 },
  { region: 'emea', product: 'e', revenue: null, units: 1 },
];

function products(rows: DataRow[]): unknown[] {
  return rows.map((row) => row.product);
}

describe('applyTransform: sort', () => {
  it('is stable: ties keep their original order', () => {
    const sorted = applyTransform(ROWS, { sort: { by: 'revenue', direction: 'desc' } });
    expect(products(sorted)).toEqual(['a', 'b', 'd', 'c', 'e']);
    const ascending = applyTransform(ROWS, { sort: { by: 'revenue' } });
    expect(products(ascending)).toEqual(['c', 'b', 'd', 'a', 'e']);
  });

  it('sorts nulls last in both directions', () => {
    expect(products(applyTransform(ROWS, { sort: { by: 'units' } }))).toEqual([
      'e',
      'b',
      'a',
      'd',
      'c',
    ]);
    expect(products(applyTransform(ROWS, { sort: { by: 'units', direction: 'desc' } }))).toEqual([
      'd',
      'a',
      'b',
      'e',
      'c',
    ]);
  });

  it('applies up to three keys in order', () => {
    const sorted = applyTransform(ROWS, {
      sort: [{ by: 'region' }, { by: 'revenue', direction: 'desc' }],
    });
    expect(products(sorted)).toEqual(['d', 'a', 'c', 'b', 'e']);
  });

  it('orders across types number < string < boolean, strings by code unit', () => {
    const values = ['b', true, 2, 'B', false, null, 10, 'a'] as const;
    const sorted = [...values].sort((left, right) => compareScalars(left, right));
    expect(sorted).toEqual([2, 10, 'B', 'a', 'b', false, true, null]);
  });
});

describe('applyTransform: filter', () => {
  it.each([
    [{ field: 'region', equals: 'apac' }, ['a', 'c']],
    [{ field: 'region', notEquals: 'apac' }, ['b', 'd', 'e']],
    [{ field: 'region', in: ['amer', 'emea'] }, ['b', 'd', 'e']],
    [{ field: 'revenue', gt: 80 }, ['a']],
    [{ field: 'revenue', gte: 80 }, ['a', 'b', 'd']],
    [{ field: 'revenue', lt: 80 }, ['c']],
    [{ field: 'revenue', lte: 80 }, ['b', 'c', 'd']],
    [{ field: 'units', equals: null }, ['c']],
  ])('%j', (clause, expected) => {
    expect(products(applyTransform(ROWS, { filter: [clause] }))).toEqual(expected);
  });

  it('combines clauses with AND', () => {
    const rows = applyTransform(ROWS, {
      filter: [
        { field: 'region', equals: 'apac' },
        { field: 'revenue', gt: 50 },
      ],
    });
    expect(products(rows)).toEqual(['a']);
  });
});

describe('applyTransform: groupBy', () => {
  it.each([
    ['count', undefined, { apac: 2, emea: 2, amer: 1 }],
    ['sum', 'revenue', { apac: 160, emea: 80, amer: 80 }],
    ['mean', 'revenue', { apac: 80, emea: 80, amer: 80 }],
    ['min', 'units', { apac: 3, emea: 1, amer: 5 }],
    ['max', 'revenue', { apac: 120, emea: 80, amer: 80 }],
  ] as const)('%s', (aggregate, value, expected) => {
    const rows = applyTransform(ROWS, {
      groupBy: { field: 'region', aggregate, ...(value === undefined ? {} : { value }) },
    });
    const output = value ?? 'count';
    expect(rows.map((row) => row.region)).toEqual(['apac', 'emea', 'amer']);
    expect(Object.fromEntries(rows.map((row) => [row.region, row[output]]))).toEqual(expected);
  });

  it('keeps the number 1 and the string "1" in separate groups', () => {
    const rows = applyTransform([{ k: 1 }, { k: '1' }, { k: 1 }], {
      groupBy: { field: 'k', aggregate: 'count' },
    });
    expect(rows).toEqual([
      { k: 1, count: 2 },
      { k: '1', count: 1 },
    ]);
  });

  it('reads mean, min and max of no numbers as null, and their sum as 0', () => {
    const rows: DataRow[] = [{ g: 'x', v: null }];
    for (const aggregate of ['mean', 'min', 'max'] as const) {
      expect(applyTransform(rows, { groupBy: { field: 'g', aggregate, value: 'v' } })).toEqual([
        { g: 'x', v: null },
      ]);
    }
    expect(
      applyTransform(rows, { groupBy: { field: 'g', aggregate: 'sum', value: 'v', as: 'total' } }),
    ).toEqual([{ g: 'x', total: 0 }]);
  });
});

describe('applyTransform: select, limit and order', () => {
  it('select keeps only the named fields, in that order', () => {
    const rows = applyTransform(ROWS, { select: ['revenue', 'product'], limit: 2 });
    expect(rows).toEqual([
      { revenue: 120, product: 'a' },
      { revenue: 80, product: 'b' },
    ]);
  });

  it('runs filter, groupBy, sort, select, limit in that fixed order', () => {
    const rows = applyTransform(ROWS, {
      limit: 1,
      select: ['region'],
      sort: { by: 'total', direction: 'desc' },
      groupBy: { field: 'region', aggregate: 'sum', value: 'revenue', as: 'total' },
      filter: [{ field: 'product', notEquals: 'a' }],
    });
    expect(rows).toEqual([{ region: 'emea' }]);
  });

  it('never mutates its input', () => {
    const before = JSON.stringify(ROWS);
    applyTransform(ROWS, { sort: { by: 'revenue' }, select: ['product'] });
    expect(JSON.stringify(ROWS)).toBe(before);
  });
});

describe('resolveBlockData', () => {
  const datasets = { sales: ROWS };

  it('materializes a dataRef with its transform and derived fields', () => {
    const bag = new DiagnosticBag();
    const data = resolveBlockData(
      {
        dataRef: 'sales',
        transform: { groupBy: { field: 'region', aggregate: 'sum', value: 'revenue' } },
      },
      datasets,
      '$.blocks[0]',
      bag,
    );
    expect(bag.list()).toEqual([]);
    expect(data).toEqual({
      source: 'sales',
      fields: ['region', 'revenue'],
      rows: [
        { region: 'apac', revenue: 160 },
        { region: 'emea', revenue: 80 },
        { region: 'amer', revenue: 80 },
      ],
    });
  });

  it('keeps the field list when a filter removes every row', () => {
    const bag = new DiagnosticBag();
    const data = resolveBlockData(
      { data: [{ a: 1, b: 2 }], transform: { filter: [{ field: 'a', gt: 5 }] } },
      {},
      '$.blocks[0]',
      bag,
    );
    expect(data).toEqual({ source: null, fields: ['a', 'b'], rows: [] });
  });

  it('reports an unknown sort field with its path and the allowed fields', () => {
    const bag = new DiagnosticBag();
    const data = resolveBlockData(
      { dataRef: 'sales', transform: { sort: [{ by: 'region' }, { by: 'price' }] } },
      datasets,
      '$.blocks[2]',
      bag,
    );
    expect(data).toBeUndefined();
    expect(bag.errors()).toEqual([
      expect.objectContaining({
        path: '$.blocks[2].transform.sort[1].by',
        details: { field: 'price', allowed: ['region', 'product', 'revenue', 'units'] },
      }),
    ]);
  });

  it('checks fields per stage: a sort after groupBy sees only the grouped fields', () => {
    const bag = new DiagnosticBag();
    resolveBlockData(
      {
        dataRef: 'sales',
        transform: { groupBy: { field: 'region', aggregate: 'count' }, sort: { by: 'revenue' } },
      },
      datasets,
      '$.blocks[0]',
      bag,
    );
    expect(bag.errors()).toEqual([
      expect.objectContaining({
        path: '$.blocks[0].transform.sort.by',
        details: { field: 'revenue', allowed: ['region', 'count'] },
      }),
    ]);
  });

  it('reports an unknown dataset with the known names', () => {
    const bag = new DiagnosticBag();
    expect(resolveBlockData({ dataRef: 'costs' }, datasets, '$.blocks[1]', bag)).toBeUndefined();
    expect(bag.errors()).toEqual([
      expect.objectContaining({
        path: '$.blocks[1].dataRef',
        details: { dataRef: 'costs', known: ['sales'] },
      }),
    ]);
  });

  it('rejects dataRef and data together, and a transform without data', () => {
    const both = new DiagnosticBag();
    resolveBlockData({ dataRef: 'sales', data: [{ a: 1 }] }, datasets, '$.blocks[0]', both);
    expect(both.errors().map((item) => item.path)).toEqual(['$.blocks[0].dataRef']);

    const orphan = new DiagnosticBag();
    expect(resolveBlockData({ transform: { limit: 1 } }, datasets, '$', orphan)).toBeUndefined();
    expect(orphan.errors().map((item) => item.path)).toEqual(['$.transform']);
  });

  it('rejects a filter clause with zero or two operators, and a sum without value', () => {
    const bag = new DiagnosticBag();
    resolveBlockData(
      {
        dataRef: 'sales',
        transform: {
          filter: [{ field: 'region' }, { field: 'revenue', gt: 1, lt: 9 }],
          groupBy: { field: 'region', aggregate: 'sum' },
        },
      },
      datasets,
      '$.blocks[0]',
      bag,
    );
    expect(bag.errors().map((item) => item.path)).toEqual([
      '$.blocks[0].transform.filter[0]',
      '$.blocks[0].transform.filter[1]',
      '$.blocks[0].transform.groupBy.value',
    ]);
  });

  it('rejects an out-of-range limit through the prop schema', () => {
    const bag = new DiagnosticBag();
    resolveBlockData({ dataRef: 'sales', transform: { limit: 500 } }, datasets, '$.blocks[0]', bag);
    expect(bag.errors().map((item) => item.path)).toEqual(['$.blocks[0].transform.limit']);
  });
});
