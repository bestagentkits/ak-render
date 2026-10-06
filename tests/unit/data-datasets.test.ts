import { describe, expect, it } from 'vitest';
import { DATA_LIMITS } from '../../src/data/dataset-types.js';
import { validateDatasets, validateRows } from '../../src/data/validate-datasets.js';
import { DiagnosticBag } from '../../src/diagnostics.js';
import { scanForbiddenKeys } from '../../src/spec/forbidden.js';

function rows(count: number): Array<Record<string, number>> {
  return Array.from({ length: count }, (_, index) => ({ n: index }));
}

describe('validateDatasets', () => {
  it('accepts named datasets in declaration order', () => {
    const bag = new DiagnosticBag();
    const datasets = validateDatasets(
      { sales: [{ region: 'apac', revenue: 1 }], 'q3-costs': [{ cost: null, ok: true }] },
      '$.datasets',
      bag,
    );
    expect(bag.list()).toEqual([]);
    expect(Object.keys(datasets)).toEqual(['sales', 'q3-costs']);
  });

  it('returns nothing for an absent envelope', () => {
    expect(validateDatasets(undefined, '$.datasets', new DiagnosticBag())).toEqual({});
  });

  it(`rejects more than ${DATA_LIMITS.maxDatasets} datasets`, () => {
    const bag = new DiagnosticBag();
    const value = Object.fromEntries(
      Array.from({ length: DATA_LIMITS.maxDatasets + 1 }, (_, index) => [`d${index}`, rows(1)]),
    );
    validateDatasets(value, '$.datasets', bag);
    expect(bag.errors()).toEqual([
      expect.objectContaining({ code: 'SPEC_BOUNDS_ERROR', path: '$.datasets' }),
    ]);
  });

  it('rejects a dataset name that is not a node id', () => {
    const bag = new DiagnosticBag();
    validateDatasets({ Sales: rows(1) }, '$.datasets', bag);
    expect(bag.errors().map((item) => item.path)).toEqual(['$.datasets.Sales']);
  });

  it('rejects a non-object envelope', () => {
    const bag = new DiagnosticBag();
    validateDatasets([rows(1)], '$.datasets', bag);
    expect(bag.errors().map((item) => item.path)).toEqual(['$.datasets']);
  });
});

describe('validateRows', () => {
  it(`rejects more than ${DATA_LIMITS.maxRows} rows`, () => {
    const bag = new DiagnosticBag();
    validateRows(rows(DATA_LIMITS.maxRows + 1), '$.datasets.big', bag);
    expect(bag.errors()).toEqual([
      expect.objectContaining({ code: 'SPEC_BOUNDS_ERROR', path: '$.datasets.big' }),
    ]);
  });

  it(`rejects more than ${DATA_LIMITS.maxFields} fields, once`, () => {
    const bag = new DiagnosticBag();
    const wide = Object.fromEntries(
      Array.from({ length: DATA_LIMITS.maxFields + 1 }, (_, index) => [`f${index}`, index]),
    );
    const valid = validateRows([wide, wide], '$.data', bag);
    expect(bag.errors()).toEqual([
      expect.objectContaining({ code: 'SPEC_BOUNDS_ERROR', path: '$.data[0].f32' }),
    ]);
    expect(Object.keys(valid[0] ?? {})).toHaveLength(DATA_LIMITS.maxFields);
  });

  it('rejects non-scalar values, bad keys, long strings and NUL, keeping the rest', () => {
    const bag = new DiagnosticBag();
    const valid = validateRows(
      [
        { ok: 1, nested: { a: 1 }, list: [1], nan: Number.NaN },
        { '1bad': 1, long: 'x'.repeat(DATA_LIMITS.maxStringLength + 1), nul: 'a\u0000b' },
        'not a row',
      ],
      '$.data',
      bag,
    );
    expect(bag.errors().map((item) => item.path)).toEqual([
      '$.data[0].nested',
      '$.data[0].list',
      '$.data[0].nan',
      '$.data[1].1bad',
      '$.data[1].long',
      '$.data[1].nul',
      '$.data[2]',
    ]);
    expect(valid).toEqual([{ ok: 1 }, {}]);
  });

  it('rejects an empty or non-list value', () => {
    for (const value of [[], { a: 1 }, 'rows']) {
      const bag = new DiagnosticBag();
      validateRows(value, '$.data', bag);
      expect(bag.errors().map((item) => item.path)).toEqual(['$.data']);
    }
  });

  it('leaves forbidden row keys to the document-wide scan, which reports a policy violation', () => {
    const spec = { datasets: { sales: [{ region: 'apac', style: 'color:red' }] } };
    const bag = new DiagnosticBag();
    scanForbiddenKeys(spec, bag);
    expect(bag.errors()).toEqual([
      expect.objectContaining({ code: 'POLICY_VIOLATION', path: '$.datasets.sales[0].style' }),
    ]);
  });
});
