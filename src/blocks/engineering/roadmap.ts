/**
 * Roadmap block: items placed on an ordered period grid, one row group per lane.
 *
 * Placement is static markup: each item carries `data-ak-start`/`data-ak-end`
 * period indexes that the feature sheet maps to grid columns (1-24), so the
 * output has no inline style. Phones and print get an agenda grouped by start
 * period instead of the grid. There is no "today" marker: it would depend on
 * the clock and break determinism.
 */

import { type DiagnosticBag, pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  itemsOf,
  LABEL,
  list,
  OPTIONAL_TITLE,
  obj,
  str as strProp,
} from '../../registry/define-helpers.js';
import {
  element,
  listProp,
  nodeAttributes,
  objectListProp,
  str,
  stringProp,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeText, renderAttributes } from '../../render/escape.js';

export const ROADMAP_MAX_PERIODS = 24;

const STATUS_LABELS: Readonly<Record<string, string>> = {
  planned: 'Planned',
  active: 'In progress',
  done: 'Done',
  'at-risk': 'At risk',
};
const STATUSES = Object.keys(STATUS_LABELS);

interface RoadmapItem {
  title: string;
  lane: string;
  start: number;
  end: number;
  status: string;
}

function roadmapItems(node: IrNode, periods: readonly string[]): RoadmapItem[] {
  return objectListProp(node, 'items').flatMap((item) => {
    const start = periods.indexOf(str(item.start));
    const endValue = str(item.end);
    const end = endValue === '' ? start : periods.indexOf(endValue);
    // A check has already reported an unknown or reversed range; skip it here.
    if (start < 0 || end < start) return [];
    const status = str(item.status, 'planned');
    return [
      {
        title: str(item.title),
        lane: str(item.lane),
        start,
        end,
        status: STATUSES.includes(status) ? status : 'planned',
      },
    ];
  });
}

function range(item: RoadmapItem, periods: readonly string[]): string {
  const first = periods[item.start] ?? '';
  return item.end === item.start ? first : `${first} – ${periods[item.end] ?? ''}`;
}

function statusText(status: string): string {
  return `<span class="ak-roadmap-status">${escapeText(STATUS_LABELS[status] ?? status)}</span>`;
}

function gridItem(item: RoadmapItem, periods: readonly string[]): string {
  return `<li${renderAttributes({
    class: 'ak-roadmap-item',
    'data-status': item.status,
    'data-ak-start': item.start + 1,
    'data-ak-end': item.end + 1,
  })}><span class="ak-roadmap-item-title">${escapeText(item.title)}</span><span class="ak-roadmap-meta"><span class="ak-roadmap-when">${escapeText(
    range(item, periods),
  )}</span>${statusText(item.status)}</span></li>`;
}

function renderRoadmap(node: IrNode): string {
  const periods = listProp(node, 'periods').map((period) => str(period));
  const lanes = objectListProp(node, 'lanes').map((lane) => ({
    id: str(lane.id),
    title: str(lane.title),
  }));
  const items = roadmapItems(node, periods);
  const laneTitles = new Map(lanes.map((lane) => [lane.id, lane.title]));
  const groups = lanes.length === 0 ? [{ id: '', title: '' }] : lanes;

  const lanesMarkup = groups
    .map((lane) => {
      const inLane = items.filter((item) => item.lane === lane.id);
      const head =
        lane.title === '' ? '' : `<h3 class="ak-roadmap-lane-title">${escapeText(lane.title)}</h3>`;
      const body =
        inLane.length === 0
          ? '<p class="ak-roadmap-empty">Nothing scheduled</p>'
          : `<ol class="ak-roadmap-items">${inLane.map((item) => gridItem(item, periods)).join('')}</ol>`;
      return `<div class="ak-roadmap-lane">${head}${body}</div>`;
    })
    .join('');

  const agenda = periods
    .map((period, index) => {
      const starting = items.filter((item) => item.start === index);
      if (starting.length === 0) return '';
      const entries = starting
        .map((item) => {
          const lane = laneTitles.get(item.lane) ?? '';
          const until = item.end === item.start ? '' : `until ${periods[item.end] ?? ''}`;
          const meta = [lane, until].filter((part) => part !== '').join(' · ');
          return `<li${renderAttributes({ class: 'ak-roadmap-entry', 'data-status': item.status })}><span class="ak-roadmap-item-title">${escapeText(
            item.title,
          )}</span><span class="ak-roadmap-meta">${
            meta === '' ? '' : `<span class="ak-roadmap-when">${escapeText(meta)}</span>`
          }${statusText(item.status)}</span></li>`;
        })
        .join('');
      return `<li><h3 class="ak-roadmap-period">${escapeText(period)}</h3><ul>${entries}</ul></li>`;
    })
    .join('');

  const title = stringProp(node, 'title');
  const head = periods.map((period) => `<li>${escapeText(period)}</li>`).join('');
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-roadmap-block' }),
    `${titleHeader(node)}<div${renderAttributes({
      class: 'ak-roadmap',
      role: 'region',
      tabindex: 0,
      'aria-label': title === '' ? 'Roadmap' : title,
    })}><div class="ak-roadmap-grid" data-ak-cols="${periods.length}"><ol class="ak-roadmap-periods">${head}</ol>${lanesMarkup}</div></div><ol class="ak-roadmap-agenda">${agenda}</ol>`,
  );
}

function reportDuplicates(
  values: readonly string[],
  path: (index: number) => string,
  noun: string,
  node: IrNode,
  bag: DiagnosticBag,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: path(index),
        message: `${noun} "${value}" is listed twice`,
        nodeId: node.id,
      });
    }
    seen.add(value);
  });
}

function checkRoadmap(node: IrNode, bag: DiagnosticBag): void {
  const periods = listProp(node, 'periods').map((period) => str(period));
  const laneIds = objectListProp(node, 'lanes').map((lane) => str(lane.id));
  reportDuplicates(
    periods,
    (index) => pathIndex(pathKey(node.path, 'periods'), index),
    'period',
    node,
    bag,
  );
  reportDuplicates(
    laneIds,
    (index) => pathKey(pathIndex(pathKey(node.path, 'lanes'), index), 'id'),
    'lane id',
    node,
    bag,
  );
  const items = node.props.items;
  if (!Array.isArray(items)) return;
  objectListProp(node, 'items').forEach((item, index) => {
    const itemPath = pathIndex(pathKey(node.path, 'items'), index);
    const error = (key: string, message: string, allowed: readonly string[]): void =>
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(itemPath, key),
        message,
        details: { allowed: [...allowed] },
        nodeId: node.id,
      });
    const start = periods.indexOf(str(item.start));
    if (start < 0) error('start', `"${str(item.start)}" is not one of the periods`, periods);
    if (typeof item.end === 'string') {
      const end = periods.indexOf(item.end);
      if (end < 0) error('end', `"${item.end}" is not one of the periods`, periods);
      else if (start >= 0 && end < start) {
        error(
          'end',
          `ends at "${item.end}", before its start "${str(item.start)}"`,
          periods.slice(start),
        );
      }
    }
    const lane = typeof item.lane === 'string' ? item.lane : undefined;
    if (laneIds.length === 0 && lane !== undefined) {
      error('lane', `lane "${lane}" is set, but the roadmap declares no lanes`, []);
    } else if (laneIds.length > 0 && lane === undefined) {
      error('lane', 'an item needs a lane when the roadmap declares lanes', laneIds);
    } else if (lane !== undefined && !laneIds.includes(lane)) {
      error('lane', `"${lane}" is not a lane id`, laneIds);
    }
  });
}

export const roadmapBlock: BlockModule = {
  definition: define({
    type: 'roadmap',
    kind: 'semantic',
    category: 'engineering',
    tags: ['timeline', 'gantt', 'plan', 'milestones'],
    useCases: ['quarterly roadmap', 'release plan', 'project schedule'],
    purpose: 'Plan over time: items spanning ordered periods, optionally split into lanes.',
    summary:
      'Roadmap: items spanning 2-24 ordered periods in up to 8 lanes, with planned/active/done/at-risk status.',
    props: {
      title: OPTIONAL_TITLE,
      periods: list(strProp({ maxLength: 40 }), {
        required: true,
        minItems: 2,
        maxItems: ROADMAP_MAX_PERIODS,
        description: 'Ordered period labels, such as 2026-Q3.',
      }),
      lanes: list(obj({ id: strProp({ required: true, id: true }), title: LABEL }), {
        maxItems: 8,
      }),
      items: itemsOf(
        {
          title: LABEL,
          lane: strProp({ maxLength: 64, description: 'A lane id; required when lanes are set.' }),
          start: strProp({ required: true, maxLength: 40, description: 'A period label.' }),
          end: strProp({ maxLength: 40, description: 'A period label; defaults to start.' }),
          status: enumStr(STATUSES, { default: 'planned' }),
        },
        { minItems: 1, maxItems: 40 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['roadmap'],
    sizing: {
      sizes: ['large'],
      default: 'large',
      responsive:
        'A period grid that scrolls sideways when the periods do not fit; at 560px and below, an agenda grouped by period.',
    },
    a11y: 'Each item states its title, period range and status in text; the grid is a labelled, focusable scroll region.',
  }),
  render: renderRoadmap,
  check(node, { bag }) {
    checkRoadmap(node, bag);
  },
};
