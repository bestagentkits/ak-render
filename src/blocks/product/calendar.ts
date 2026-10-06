/**
 * Calendar block: one month with its events.
 *
 * The month grid is computed with integer date math (`calendar-dates.ts`), so
 * it never depends on the clock, the time zone or the host locale, and no day
 * is marked as "today". One list of days serves both layouts: a seven-column
 * grid on wide screens and, at ≤560px, an agenda that keeps only the days with
 * events.
 */

import type { JsonValue } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  enumStr,
  LABEL,
  list,
  OPTIONAL_TITLE,
  obj,
  semantic,
  str as strProp,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  stringProp,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import {
  type CalendarMonth,
  daysInMonth,
  isTime,
  layoutMonth,
  monthIso,
  monthLabel,
  parseDateParts,
  parseMonth,
  WEEK_STARTS,
  WEEKDAY_NAMES,
  type WeekStart,
  weekdayHeaders,
} from './calendar-dates.js';
import { reportAt } from './product-helpers.js';

const TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const;

interface CalendarEvent {
  date: string;
  title: string;
  time: string;
  tone: string;
  /** Authored position, the final tie-breaker so ordering is stable. */
  order: number;
}

/** Code-unit order: dates and times are fixed-width ASCII, so this is chronological. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function readEvents(events: Record<string, JsonValue>[]): CalendarEvent[] {
  return events
    .map((event, order) => ({
      date: str(event.date),
      title: str(event.title),
      time: str(event.time),
      tone: str(event.tone, 'neutral'),
      order,
    }))
    .sort(
      (a, b) =>
        compareText(a.date, b.date) ||
        // All-day events lead their day, then by time, then as authored.
        (a.time === '' ? 0 : 1) - (b.time === '' ? 0 : 1) ||
        compareText(a.time, b.time) ||
        a.order - b.order,
    );
}

function eventItem(event: CalendarEvent): string {
  return `<li data-tone="${escapeAttribute(event.tone)}">${
    event.time === ''
      ? ''
      : `<time class="ak-calendar-time" datetime="${escapeAttribute(event.time)}">${escapeText(
          event.time,
        )}</time> `
  }<span class="ak-calendar-title">${escapeText(event.title)}</span></li>`;
}

function renderMonth(month: CalendarMonth, weekStart: WeekStart, events: CalendarEvent[]): string {
  const layout = layoutMonth(month, weekStart);
  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  const pad = '<li class="ak-calendar-pad" aria-hidden="true"></li>';
  const days = layout.days.map((day) => {
    const dayEvents = byDate.get(day.iso) ?? [];
    return `<li class="ak-calendar-day"${
      dayEvents.length > 0 ? ' data-events="true"' : ''
    }${day.weekday >= 5 ? ' data-weekend="true"' : ''}><time datetime="${day.iso}"><span class="ak-calendar-dow">${
      WEEKDAY_NAMES[day.weekday]
    }</span> <span class="ak-calendar-num">${day.day}</span></time>${
      dayEvents.length === 0
        ? ''
        : `<ul class="ak-calendar-events">${dayEvents.map(eventItem).join('')}</ul>`
    }</li>`;
  });
  const label = monthLabel(month);
  return `<ol class="ak-calendar-weekdays" aria-hidden="true">${weekdayHeaders(weekStart)
    .map((name) => `<li>${name}</li>`)
    .join('')}</ol><ol class="ak-calendar-days" aria-label="${escapeAttribute(label)}">${pad.repeat(
    layout.leading,
  )}${days.join('')}${pad.repeat(layout.trailing)}</ol>`;
}

export const calendarBlock: BlockModule = {
  definition: semantic({
    type: 'calendar',
    category: 'data',
    tags: ['calendar', 'schedule', 'events', 'dates'],
    useCases: ['event schedule', 'release calendar', 'month agenda'],
    purpose: 'Month calendar with events.',
    summary: 'Calendar: one YYYY-MM month grid with dated events; an agenda on phones.',
    props: {
      title: OPTIONAL_TITLE,
      month: strProp({ required: true, maxLength: 7, description: 'The month shown, YYYY-MM.' }),
      weekStart: enumStr(WEEK_STARTS, {
        default: 'monday',
        description: 'First column of the week (ISO 8601 Monday by default).',
      }),
      events: list(
        obj({
          date: strProp({
            required: true,
            maxLength: 10,
            description: 'YYYY-MM-DD, inside the month.',
          }),
          title: LABEL,
          time: strProp({ maxLength: 5, description: '24-hour HH:MM.' }),
          tone: enumStr(TONES, { default: 'neutral' }),
        }),
        { maxItems: 60 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['calendar'],
    a11y: 'Days are an ordered list of <time> elements with weekday names; the tone dot is decorative and the event title carries the meaning.',
  }),
  render: (node) => {
    const month = parseMonth(stringProp(node, 'month'));
    const weekStart: WeekStart = stringProp(node, 'weekStart') === 'sunday' ? 'sunday' : 'monday';
    const events = readEvents(objectListProp(node, 'events'));
    // Validation guarantees a real month; the guard keeps the renderer total.
    if (month === undefined) {
      return element('section', nodeAttributes(node, { class: 'ak-block' }), titleHeader(node));
    }
    const label = monthLabel(month);
    const count = `${events.length} event${events.length === 1 ? '' : 's'}`;
    return element(
      'section',
      nodeAttributes(node, {
        class: 'ak-block ak-calendar',
        'data-week-start': weekStart,
        ...(events.length === 0 ? { 'data-empty': true } : {}),
      }),
      `${titleHeader(node)}<p class="ak-calendar-caption"><time datetime="${monthIso(
        month,
      )}">${label}</time><span class="ak-calendar-count">${count}</span></p>${renderMonth(
        month,
        weekStart,
        events,
      )}${events.length === 0 ? `<p class="ak-calendar-empty">No events in ${label}.</p>` : ''}`,
    );
  },
  check: (node, context) => {
    const month = parseMonth(stringProp(node, 'month'));
    if (month === undefined) {
      reportAt(context, node, '.month', 'expected a month as YYYY-MM, such as 2026-10');
      return;
    }
    const prefix = monthIso(month);
    const lastDay = daysInMonth(month);
    objectListProp(node, 'events').forEach((event, index) => {
      const date = str(event.date);
      const parts = parseDateParts(date);
      if (parts === undefined || parts.day < 1 || parts.day > 31) {
        reportAt(context, node, `.events[${index}].date`, 'expected a date as YYYY-MM-DD');
      } else if (!date.startsWith(`${prefix}-`) || parts.day > lastDay) {
        reportAt(
          context,
          node,
          `.events[${index}].date`,
          `date ${date} is not in ${monthLabel(month)} (${prefix}-01 to ${prefix}-${String(
            lastDay,
          ).padStart(2, '0')})`,
          { month: prefix },
        );
      }
      const time = str(event.time);
      if (time !== '' && !isTime(time)) {
        reportAt(context, node, `.events[${index}].time`, 'expected a 24-hour time as HH:MM');
      }
    });
  },
};
