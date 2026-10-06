/**
 * Log-viewer block: structured log lines with time, level, source and message.
 *
 * Unlike `terminal`, which replays a session, this is a scannable record: a
 * monospace list with level badges. Every line carries the shared filter row
 * contract, so a filter bar can narrow it by level. A log longer than
 * `LOG_SEARCH_THRESHOLD` lines also gets the core text search.
 */

import type { DataRow } from '../../data/dataset-types.js';
import { pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  list,
  OPTIONAL_TITLE,
  obj,
  str as strProp,
  txt,
} from '../../registry/define-helpers.js';
import {
  element,
  filterRowAttributes,
  nodeAttributes,
  objectListProp,
  str,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeAttribute, escapeText, renderAttributes } from '../../render/escape.js';
import {
  checkItemSource,
  checkMappedFields,
  fieldMap,
  fieldMapProp,
  partText,
  partValue,
  scalarRow,
} from './engineering-helpers.js';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
/** More lines than this get a search box. */
export const LOG_SEARCH_THRESHOLD = 20;

const LINE_PARTS = ['time', 'level', 'source', 'message'] as const;
const LEVEL_TONES: Readonly<Record<string, string>> = {
  debug: 'neutral',
  info: 'info',
  warn: 'warning',
  error: 'danger',
};

/** `2026-10-06T10:42:13.120Z` → date `2026-10-06`, clock `10:42:13.120`. Anything else stays whole. */
const ISO_TIME =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)(Z|[+-]\d{2}:?\d{2})?$/u;

interface LogLine {
  time: string;
  level: string;
  source: string;
  message: string;
  row: DataRow;
}

function logLines(node: IrNode): LogLine[] {
  if (node.data !== undefined) {
    const fields = fieldMap(node, LINE_PARTS);
    return node.data.rows.map((row) => ({
      time: partText(partValue(row, fields.time)),
      level: partText(partValue(row, fields.level)).toLowerCase(),
      source: partText(partValue(row, fields.source)),
      message: partText(partValue(row, fields.message)),
      row,
    }));
  }
  return objectListProp(node, 'lines').map((line) => ({
    time: str(line.time),
    level: str(line.level),
    source: str(line.source),
    message: str(line.message),
    row: scalarRow(line),
  }));
}

/**
 * When every timestamp is an ISO time on one shared date, lines show only the
 * clock and the date is stated once in the header; otherwise each line shows
 * its full timestamp.
 */
function sharedDate(lines: readonly LogLine[]): string {
  let date = '';
  for (const line of lines) {
    if (line.time === '') continue;
    const match = ISO_TIME.exec(line.time);
    if (match === null) return '';
    const day = match[1] ?? '';
    if (date !== '' && day !== date) return '';
    date = day;
  }
  return date;
}

/** The tone for a level, read only from the table's own keys (never `constructor`). */
function levelTone(level: string): string {
  return Object.hasOwn(LEVEL_TONES, level) ? (LEVEL_TONES[level] ?? 'neutral') : 'neutral';
}

function renderLine(line: LogLine, date: string): string {
  const shown = date === '' ? line.time : (ISO_TIME.exec(line.time)?.[2] ?? line.time);
  const time =
    line.time === ''
      ? '<span class="ak-log-time"></span>'
      : `<time class="ak-log-time" datetime="${escapeAttribute(line.time)}">${escapeText(shown)}</time>`;
  return `<li${renderAttributes({
    class: 'ak-log-line',
    'data-level': line.level,
    ...filterRowAttributes(line.row),
  })}>${time}<span class="ak-log-level" data-tone="${levelTone(line.level)}">${escapeText(
    line.level.toUpperCase(),
  )}</span><span class="ak-log-source">${escapeText(line.source)}</span><span class="ak-log-message">${escapeText(
    line.message,
  )}</span></li>`;
}

function renderLogViewer(node: IrNode): string {
  const lines = logLines(node);
  const date = sharedDate(lines);
  const counts = LOG_LEVELS.map(
    (level) => [level, lines.filter((line) => line.level === level).length] as const,
  )
    .filter(([, count]) => count > 0)
    .map(([level, count]) => `<li data-tone="${levelTone(level)}">${count} ${level}</li>`)
    .join('');
  const facts = `<div class="ak-log-head"><p class="ak-log-total">${lines.length} ${
    lines.length === 1 ? 'line' : 'lines'
  }${date === '' ? '' : ` · <time datetime="${date}">${date}</time>`}</p><ul class="ak-log-counts">${counts}</ul></div>`;
  const inputId = `ak-log-search-${node.id}`;
  const search =
    lines.length > LOG_SEARCH_THRESHOLD
      ? `<div class="ak-search ak-log-search"><label for="${inputId}">Search lines</label><input${renderAttributes(
          {
            type: 'search',
            id: inputId,
            'data-ak-search': node.id,
            'data-ak-match': 'text',
            placeholder: 'Message, source or level',
          },
        )} /></div>`
      : '';
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-log-block' }),
    `${titleHeader(node)}${search}<div class="ak-log">${facts}<ol class="ak-log-lines">${lines
      .map((line) => renderLine(line, date))
      .join('')}</ol></div>`,
  );
}

export const logViewerBlock: BlockModule = {
  definition: define({
    type: 'log-viewer',
    kind: 'semantic',
    category: 'engineering',
    tags: ['logs', 'observability', 'debugging', 'incident'],
    useCases: ['incident log excerpt', 'service log review', 'debug trace'],
    filterable: true,
    data: { required: false, description: 'Rows become lines; "fields" names the columns read.' },
    purpose:
      'Structured log excerpt: time, level, source and message per line, searchable when long.',
    summary:
      'Log viewer: up to 200 leveled log lines with time and source; searchable and filterable by level.',
    props: {
      title: OPTIONAL_TITLE,
      lines: list(
        obj({
          time: strProp({ maxLength: 40, description: 'ISO 8601 timestamp.' }),
          level: enumStr(LOG_LEVELS, { required: true }),
          source: strProp({ maxLength: 80 }),
          message: txt({ required: true, maxLength: 400, description: 'Emitted verbatim.' }),
        }),
        { maxItems: 200 },
      ),
      fields: fieldMapProp(LINE_PARTS, 'Dataset field per line part; defaults to the same name.'),
      ...anchorProps,
    },
    runtimeFeatures: ['log-viewer', 'filter'],
    sizing: {
      sizes: ['medium', 'large'],
      default: 'large',
      responsive:
        'Aligned columns on wide screens; on phones the message wraps under time, level and source.',
    },
    a11y: 'An ordered list of lines; the level is text, timestamps use <time datetime>, and the search box is labelled.',
  }),
  render: renderLogViewer,
  check(node, { bag }) {
    if (!checkItemSource(node, bag, 'lines', 'lines')) return;
    const data = node.data;
    if (data === undefined) return;
    if (!checkMappedFields(node, bag, LINE_PARTS, ['level', 'message'])) return;
    const field = fieldMap(node, LINE_PARTS).level ?? 'level';
    const allowed: readonly string[] = LOG_LEVELS;
    data.rows.forEach((row, index) => {
      const level = partText(partValue(row, field)).toLowerCase();
      if (allowed.includes(level)) return;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        severity: 'warning',
        path: pathKey(node.path, data.source === null ? 'data' : 'dataRef'),
        message: `row ${index} has level "${level}", which renders without a level tone`,
        details: { row: index, allowed: [...allowed] },
        nodeId: node.id,
      });
    });
  },
};
