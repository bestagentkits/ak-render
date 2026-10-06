/**
 * Deterministic, locale-free value formatting.
 *
 * Every data-bound block formats numbers, dates and units through this one
 * function, so a value reads the same in a table cell, a chart label and a
 * metric. Nothing here consults `Intl`, the host locale, or the clock: grouping
 * uses a fixed comma, months use fixed English names, and rounding uses
 * `toFixed`, which is specified exactly by ECMAScript.
 */

import type { PropSchema } from '../registry/prop-schema.js';
import type { DataScalar } from './dataset-types.js';

export const VALUE_FORMATS = [
  'text',
  'number',
  'integer',
  'compact',
  'percent',
  'currency',
  'duration',
  'bytes',
  'date',
] as const;
export type ValueFormat = (typeof VALUE_FORMATS)[number];

export const CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'INR',
  'VND',
  'AUD',
  'CAD',
  'CHF',
  'SGD',
  'KRW',
] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface FormatSpec {
  format?: ValueFormat;
  /** Short unit appended after number, integer and compact values (`ms`, `req/s`). */
  unit?: string;
  currency?: string;
  /** Fixed number of decimals (0–4). Omitted: a sensible maximum, trailing zeros trimmed. */
  decimals?: number;
}

/** Prop-schema fields to spread into a column or axis schema. */
export const FORMAT_FIELDS: Record<string, PropSchema> = {
  format: {
    kind: 'string',
    enum: VALUE_FORMATS,
    default: 'text',
    description: 'percent takes 87 for 87%; duration takes milliseconds; date takes YYYY-MM-DD.',
  },
  unit: { kind: 'string', maxLength: 12, description: 'Appended to number-like values.' },
  currency: { kind: 'string', enum: CURRENCIES, default: 'USD' },
  decimals: { kind: 'number', integer: true, min: 0, max: 4 },
};

/** Shown for a null value or a missing field. */
export const EMPTY_VALUE = '—';

const CURRENCY_SYMBOLS: Readonly<Record<Currency, { symbol: string; decimals: number }>> = {
  USD: { symbol: '$', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 },
  CNY: { symbol: 'CN¥', decimals: 2 },
  INR: { symbol: '₹', decimals: 2 },
  VND: { symbol: '₫', decimals: 0 },
  AUD: { symbol: 'A$', decimals: 2 },
  CAD: { symbol: 'CA$', decimals: 2 },
  CHF: { symbol: 'CHF ', decimals: 2 },
  SGD: { symbol: 'S$', decimals: 2 },
  KRW: { symbol: '₩', decimals: 0 },
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/u;

/**
 * A number with grouped digits. With `fixed`, exactly that many decimals;
 * otherwise rounded to `maxDecimals` with trailing zeros trimmed.
 */
export function groupedNumber(value: number, maxDecimals: number, fixed?: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 1e21) return String(value);
  const places = fixed ?? maxDecimals;
  let text = Math.abs(value).toFixed(places);
  if (fixed === undefined && text.includes('.')) text = text.replace(/\.?0+$/u, '');
  const [whole = '0', fraction] = text.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const body = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  // A value that rounds to zero carries no sign.
  const negative = value < 0 && /[1-9]/u.test(body);
  return `${negative ? '-' : ''}${body}`;
}

function withUnit(text: string, unit: string | undefined): string {
  return unit === undefined || unit === '' ? text : `${text} ${unit}`;
}

/** Scale a value through a unit ladder, carrying to the next step after rounding. */
function scaled(
  value: number,
  ladder: readonly { factor: number; suffix: string }[],
  decimals: number | undefined,
  defaultDecimals: number,
): { amount: number; text: string; suffix: string } {
  const magnitude = Math.abs(value);
  let step = 0;
  for (let index = ladder.length - 1; index >= 0; index -= 1) {
    if (magnitude >= (ladder[index]?.factor ?? 1)) {
      step = index;
      break;
    }
  }
  for (;;) {
    const entry = ladder[step] ?? { factor: 1, suffix: '' };
    const amount = value / entry.factor;
    const text = groupedNumber(amount, defaultDecimals, decimals);
    const next = ladder[step + 1];
    const reached = Math.abs(Number(text.replace(/,/gu, '')));
    if (next !== undefined && reached * entry.factor >= next.factor) {
      step += 1;
      continue;
    }
    return { amount, text, suffix: entry.suffix };
  }
}

const COMPACT_LADDER = [
  { factor: 1, suffix: '' },
  { factor: 1e3, suffix: 'k' },
  { factor: 1e6, suffix: 'M' },
  { factor: 1e9, suffix: 'B' },
  { factor: 1e12, suffix: 'T' },
] as const;
const BYTES_LADDER = [
  { factor: 1, suffix: ' B' },
  { factor: 1e3, suffix: ' kB' },
  { factor: 1e6, suffix: ' MB' },
  { factor: 1e9, suffix: ' GB' },
  { factor: 1e12, suffix: ' TB' },
] as const;
const DURATION_LADDER = [
  { factor: 1, suffix: ' ms' },
  { factor: 1e3, suffix: ' s' },
  { factor: 6e4, suffix: ' min' },
  { factor: 3.6e6, suffix: ' h' },
] as const;

function formatDate(value: string): string {
  const match = ISO_DATE.exec(value);
  if (match === null) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const name = MONTHS[month - 1];
  if (name === undefined || day < 1 || day > (lengths[month - 1] ?? 0)) return value;
  return `${name} ${day}, ${year}`;
}

function formatNumber(value: number, spec: FormatSpec, format: ValueFormat): string {
  const { decimals, unit } = spec;
  switch (format) {
    case 'integer':
      return withUnit(groupedNumber(Math.round(value), 0, 0), unit);
    case 'compact': {
      const result = scaled(value, COMPACT_LADDER, decimals, 1);
      return withUnit(`${result.text}${result.suffix}`, unit);
    }
    case 'percent':
      return `${groupedNumber(value, 1, decimals)}%`;
    case 'currency': {
      const code = (CURRENCIES as readonly string[]).includes(spec.currency ?? '')
        ? (spec.currency as Currency)
        : 'USD';
      const { symbol, decimals: places } = CURRENCY_SYMBOLS[code];
      const text = groupedNumber(Math.abs(value), places, decimals ?? places);
      const negative = value < 0 && /[1-9]/u.test(text);
      return `${negative ? '-' : ''}${symbol}${text}`;
    }
    case 'duration': {
      const result = scaled(value, DURATION_LADDER, decimals, 1);
      return `${result.text}${result.suffix}`;
    }
    case 'bytes': {
      const result = scaled(value, BYTES_LADDER, decimals, 1);
      return `${result.text}${result.suffix}`;
    }
    default:
      return withUnit(groupedNumber(value, 2, decimals), unit);
  }
}

/**
 * Format one value for display. Null reads as an em dash; booleans read as
 * Yes/No; a numeric string is formatted like the number it spells; any other
 * string is returned unchanged (dates excepted, which must be `YYYY-MM-DD`).
 */
export function formatValue(value: DataScalar, spec: FormatSpec = {}): string {
  const format = spec.format ?? 'text';
  if (value === null) return EMPTY_VALUE;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (format === 'date') return typeof value === 'string' ? formatDate(value) : String(value);
  if (format === 'text') {
    return typeof value === 'number' ? withUnit(String(value), spec.unit) : value;
  }
  if (typeof value === 'string') {
    if (!PLAIN_NUMBER.test(value.trim())) return value;
    return formatNumber(Number(value.trim()), spec, format);
  }
  return formatNumber(value, spec, format);
}
