/**
 * Deterministic calendar arithmetic for the calendar block.
 *
 * Integer epoch-day math only: no `Date`, no time zone, no locale and no clock,
 * so a month lays out identically on every machine and on every day. Weekday
 * and month names are fixed English, like the value formatter's month names.
 */

export type WeekStart = 'monday' | 'sunday';

export const WEEK_STARTS: readonly WeekStart[] = ['monday', 'sunday'];

/** Monday-first, matching ISO 8601 weekday numbering minus one. */
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export interface CalendarMonth {
  year: number;
  /** 1–12. */
  month: number;
}

/** Parse `YYYY-MM`; undefined when the text is not a real month. */
export function parseMonth(text: string): CalendarMonth | undefined {
  const match = MONTH_PATTERN.exec(text);
  if (match === null) return undefined;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** Parse `YYYY-MM-DD` into its parts without checking the day range. */
export function parseDateParts(
  text: string,
): { year: number; month: number; day: number } | undefined {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return undefined;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** `HH:MM`, 24-hour. */
export function isTime(text: string): boolean {
  return TIME_PATTERN.test(text);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth({ year, month }: CalendarMonth): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's
 * `days_from_civil`). Pure integer arithmetic, valid for any year.
 */
export function epochDay(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/** Weekday index with Monday = 0 … Sunday = 6. 1970-01-01 was a Thursday (3). */
export function mondayIndex(year: number, month: number, day: number): number {
  return (((epochDay(year, month, day) + 3) % 7) + 7) % 7;
}

/** The column (0-based) a weekday falls in for the given first day of the week. */
export function weekColumn(weekday: number, weekStart: WeekStart): number {
  return weekStart === 'monday' ? weekday : (weekday + 1) % 7;
}

/** Weekday header labels in column order. */
export function weekdayHeaders(weekStart: WeekStart): string[] {
  return weekStart === 'monday'
    ? [...WEEKDAY_NAMES]
    : [WEEKDAY_NAMES[6], ...WEEKDAY_NAMES.slice(0, 6)];
}

export interface CalendarDay {
  day: number;
  /** `YYYY-MM-DD`. */
  iso: string;
  /** Monday = 0. */
  weekday: number;
}

export interface MonthLayout {
  /** Empty cells before the 1st. */
  leading: number;
  days: CalendarDay[];
  /** Empty cells after the last day, completing the final week row. */
  trailing: number;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

export function monthLabel({ year, month }: CalendarMonth): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function monthIso({ year, month }: CalendarMonth): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}`;
}

/** The month grid: leading blanks, every day with its weekday, trailing blanks. */
export function layoutMonth(month: CalendarMonth, weekStart: WeekStart): MonthLayout {
  const total = daysInMonth(month);
  const first = mondayIndex(month.year, month.month, 1);
  const prefix = monthIso(month);
  const days: CalendarDay[] = [];
  for (let day = 1; day <= total; day += 1) {
    days.push({ day, iso: `${prefix}-${pad2(day)}`, weekday: (first + day - 1) % 7 });
  }
  const leading = weekColumn(first, weekStart);
  const trailing = (7 - ((leading + total) % 7)) % 7;
  return { leading, days, trailing };
}
