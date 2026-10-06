import { describe, expect, it } from 'vitest';
import type { DataScalar } from '../../src/data/dataset-types.js';
import { type FormatSpec, formatValue } from '../../src/data/format-value.js';

const NBSP = ' ';

type Golden = readonly [DataScalar, FormatSpec, string];

const GOLDEN: Record<string, readonly Golden[]> = {
  text: [
    ['hello', {}, 'hello'],
    [42, {}, '42'],
    [null, {}, '—'],
    [true, {}, 'Yes'],
    [false, { format: 'number' }, 'No'],
  ],
  number: [
    [1234567.891, { format: 'number' }, '1,234,567.89'],
    [1.5, { format: 'number' }, '1.5'],
    [-0.001, { format: 'number' }, '0'],
    [-1234, { format: 'number' }, '-1,234'],
    [3, { format: 'number', decimals: 2 }, '3.00'],
    [12, { format: 'number', unit: 'ms' }, `12${NBSP}ms`],
    ['1234.5', { format: 'number' }, '1,234.5'],
    ['n/a', { format: 'number' }, 'n/a'],
  ],
  integer: [
    [1234.6, { format: 'integer' }, '1,235'],
    [-2.5, { format: 'integer' }, '-2'],
  ],
  compact: [
    [950, { format: 'compact' }, '950'],
    [33_700, { format: 'compact' }, '33.7k'],
    [1_200_000, { format: 'compact' }, '1.2M'],
    [999_960, { format: 'compact' }, '1M'],
    [4_500_000_000, { format: 'compact' }, '4.5B'],
    [2e12, { format: 'compact' }, '2T'],
    [-33_700, { format: 'compact', unit: 'req' }, `-33.7k${NBSP}req`],
  ],
  percent: [
    [87, { format: 'percent' }, '87%'],
    [12.345, { format: 'percent' }, '12.3%'],
    [5, { format: 'percent', decimals: 1 }, '5.0%'],
  ],
  currency: [
    [1234.5, { format: 'currency' }, '$1,234.50'],
    [-99, { format: 'currency', currency: 'EUR' }, '-€99.00'],
    [1500, { format: 'currency', currency: 'JPY' }, '¥1,500'],
    [25000, { format: 'currency', currency: 'VND' }, '₫25,000'],
    [10, { format: 'currency', currency: 'XXX' }, '$10.00'],
  ],
  duration: [
    [340, { format: 'duration' }, '340 ms'],
    [1200, { format: 'duration' }, '1.2 s'],
    [150_000, { format: 'duration' }, '2.5 min'],
    [59_990, { format: 'duration' }, '1 min'],
    [7_200_000, { format: 'duration' }, '2 h'],
  ],
  bytes: [
    [512, { format: 'bytes' }, '512 B'],
    [70_200, { format: 'bytes' }, '70.2 kB'],
    [3_000_000_000, { format: 'bytes' }, '3 GB'],
  ],
  date: [
    ['2026-10-06', { format: 'date' }, 'Oct 6, 2026'],
    ['2024-02-29', { format: 'date' }, 'Feb 29, 2024'],
    ['2023-02-29', { format: 'date' }, '2023-02-29'],
    ['yesterday', { format: 'date' }, 'yesterday'],
  ],
};

describe('formatValue golden tables', () => {
  for (const [format, rows] of Object.entries(GOLDEN)) {
    it.each(rows)(`${format}: %j %j → %s`, (value, spec, expected) => {
      expect(formatValue(value, spec)).toBe(expected);
    });
  }

  it('never consults the host locale', () => {
    const original = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = () => 'LOCALE';
    try {
      expect(formatValue(1234567, { format: 'number' })).toBe('1,234,567');
    } finally {
      Number.prototype.toLocaleString = original;
    }
  });
});
