/**
 * Kanban block: cards grouped into ordered columns.
 *
 * Columns sit in one scroll strip that is a plain grid when they fit and snaps
 * column by column on a phone. The strip is a focusable, labelled region, so a
 * keyboard can scroll it, and it is a list of lists for screen readers. Every
 * card carries the shared filter row contract.
 */

import type { DataRow } from '../../data/dataset-types.js';
import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  itemsOf,
  LABEL,
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
  stringProp,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeInlineText, escapeText, renderAttributes } from '../../render/escape.js';
import { toneBadge } from '../../render/tone.js';
import {
  checkItemSource,
  checkMappedFields,
  fieldMap,
  fieldMapProp,
  partText,
  partValue,
  scalarRow,
} from './engineering-helpers.js';

const CARD_PARTS = ['title', 'column', 'text', 'owner', 'status'] as const;

interface KanbanCard {
  title: string;
  column: string;
  text: string;
  owner: string;
  status: string;
  tags: string[];
  row: DataRow;
}

/** Cards from the inline list, or from bound rows through the field map. */
function kanbanCards(node: IrNode): KanbanCard[] {
  if (node.data !== undefined) {
    const fields = fieldMap(node, CARD_PARTS);
    return node.data.rows.map((row) => ({
      title: partText(partValue(row, fields.title)),
      column: partText(partValue(row, fields.column)),
      text: partText(partValue(row, fields.text)),
      owner: partText(partValue(row, fields.owner)),
      status: partText(partValue(row, fields.status)),
      tags: [],
      row,
    }));
  }
  return objectListProp(node, 'cards').map((card) => ({
    title: str(card.title),
    column: str(card.column),
    text: str(card.text),
    owner: str(card.owner),
    status: str(card.status),
    tags: (Array.isArray(card.tags) ? card.tags : []).map((tag) => str(tag)),
    row: scalarRow(card),
  }));
}

function renderCard(card: KanbanCard): string {
  const meta = [
    card.owner === '' ? '' : `<span class="ak-kanban-owner">${escapeText(card.owner)}</span>`,
    ...card.tags.map((tag) => `<span class="ak-kanban-tag">${escapeText(tag)}</span>`),
    card.status === '' ? '' : toneBadge(card.status),
  ].join('');
  return `<li${renderAttributes({ class: 'ak-kanban-card', ...filterRowAttributes(card.row) })}><p class="ak-kanban-card-title">${escapeText(
    card.title,
  )}</p>${card.text === '' ? '' : `<p class="ak-kanban-card-text">${escapeInlineText(card.text)}</p>`}${
    meta === '' ? '' : `<p class="ak-kanban-meta">${meta}</p>`
  }</li>`;
}

function renderKanban(node: IrNode): string {
  const cards = kanbanCards(node);
  const title = stringProp(node, 'title');
  const columns = objectListProp(node, 'columns').map((column) => {
    const id = str(column.id);
    const name = str(column.title);
    const inColumn = cards.filter((card) => card.column === id);
    const count = `<span class="ak-kanban-count">${inColumn.length}<span class="ak-sr"> ${
      inColumn.length === 1 ? 'card' : 'cards'
    }</span></span>`;
    const body =
      inColumn.length === 0
        ? '<p class="ak-kanban-empty">No cards</p>'
        : `<ul class="ak-kanban-cards"${renderAttributes({ 'aria-label': name })}>${inColumn
            .map(renderCard)
            .join('')}</ul>`;
    return `<li class="ak-kanban-col"><h3 class="ak-kanban-col-head"><span>${escapeText(
      name,
    )}</span>${count}</h3>${body}</li>`;
  });
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-kanban-block' }),
    `${titleHeader(node)}<div${renderAttributes({
      class: 'ak-kanban',
      role: 'region',
      tabindex: 0,
      'aria-label': title === '' ? 'Board' : title,
    })}><ul class="ak-kanban-cols">${columns.join('')}</ul></div>`,
  );
}

export const kanbanBlock: BlockModule = {
  definition: define({
    type: 'kanban',
    kind: 'semantic',
    category: 'engineering',
    tags: ['board', 'cards', 'workflow', 'sprint'],
    useCases: ['sprint board', 'work in progress', 'triage queue'],
    filterable: true,
    data: { required: false, description: 'Rows become cards; "fields" names the columns read.' },
    purpose: 'Work board: cards grouped into ordered columns such as to do, doing and done.',
    summary:
      'Kanban: 2-8 columns of cards with owner, tags and status; cards may come from a dataset.',
    props: {
      title: OPTIONAL_TITLE,
      columns: itemsOf(
        { id: strProp({ required: true, id: true }), title: LABEL },
        { minItems: 2, maxItems: 8 },
      ),
      cards: list(
        obj({
          title: LABEL,
          column: strProp({ required: true, maxLength: 64, description: 'A column id.' }),
          text: txt({ maxLength: 600 }),
          owner: strProp({ maxLength: 80 }),
          tags: list(strProp({ maxLength: 40 }), { maxItems: 4 }),
          status: strProp({
            maxLength: 40,
            description: 'Short status word; known words get a tone.',
          }),
        }),
        { maxItems: 60 },
      ),
      fields: fieldMapProp(CARD_PARTS, 'Dataset field per card part; defaults to the same name.'),
      ...anchorProps,
    },
    runtimeFeatures: ['kanban'],
    sizing: {
      sizes: ['large'],
      default: 'large',
      responsive:
        'Columns share the width when they fit and scroll sideways otherwise; on phones each column takes 85% and snaps.',
    },
    a11y: 'A labelled, focusable scroll region holding a list of columns, each a headed list of cards; status is text.',
  }),
  render: renderKanban,
  check(node, { bag }) {
    if (!checkItemSource(node, bag, 'cards', 'cards')) return;
    const columnIds = new Set(objectListProp(node, 'columns').map((column) => str(column.id)));
    const seen = new Set<string>();
    objectListProp(node, 'columns').forEach((column, index) => {
      const id = str(column.id);
      if (seen.has(id)) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: pathKey(pathIndex(pathKey(node.path, 'columns'), index), 'id'),
          message: `column id "${id}" is used twice`,
          nodeId: node.id,
        });
      }
      seen.add(id);
    });
    const allowed = [...columnIds];
    if (node.data !== undefined) {
      if (!checkMappedFields(node, bag, CARD_PARTS, ['title', 'column'])) return;
      const field = fieldMap(node, CARD_PARTS).column ?? 'column';
      node.data.rows.forEach((row, index) => {
        const column = partText(partValue(row, field));
        if (columnIds.has(column)) return;
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: pathKey(node.path, node.data?.source === null ? 'data' : 'dataRef'),
          message: `row ${index} has column "${column}", which is not a column id`,
          details: { row: index, allowed },
          nodeId: node.id,
        });
      });
      return;
    }
    const cards = node.props.cards;
    if (!Array.isArray(cards)) return;
    cards.forEach((card, index) => {
      if (!isPlainObject(card) || typeof card.column !== 'string') return;
      if (columnIds.has(card.column)) return;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(pathIndex(pathKey(node.path, 'cards'), index), 'column'),
        message: `"${card.column}" is not a column id`,
        details: { allowed },
        nodeId: node.id,
      });
    });
  },
};
