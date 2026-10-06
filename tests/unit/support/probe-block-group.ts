/**
 * A test-only block group that exercises nested slots: a panel with a
 * top-level `aside` slot and a `blocks` field on each item, plus a cell that
 * may only sit directly inside a probe grid, and a data-bound list.
 */

import { BLOCK_GROUPS } from '../../../src/blocks/index.js';
import type { BlockGroup, BlockModule } from '../../../src/registry/block-module.js';
import {
  blocks,
  define,
  itemsOf,
  LABEL,
  OPTIONAL_TITLE,
} from '../../../src/registry/define-helpers.js';
import { buildRegistry } from '../../../src/registry/registry.js';
import { element, nodeAttributes, objectListProp } from '../../../src/render/block-helpers.js';
import { escapeText } from '../../../src/render/escape.js';
import { slotKey } from '../../../src/render/render-context.js';

const META = { category: 'layout', tags: ['probe'], useCases: ['nested slot test'] } as const;

export const probePanel: BlockModule = {
  definition: define({
    type: 'probe-panel',
    ...META,
    purpose: 'Nested slot probe.',
    summary: 'Probe panel with an aside slot and per-item blocks.',
    props: {
      title: OPTIONAL_TITLE,
      aside: blocks({ maxItems: 3 }),
      items: itemsOf({ title: LABEL, blocks: blocks({ accepts: ['text', 'image', 'tabs'] }) }),
    },
  }),
  render: (node, context) =>
    element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        `<aside>${context.renderSlot(node, 'aside')}</aside>`,
        ...objectListProp(node, 'items').map(
          (item, index) =>
            `<div><h3>${escapeText(String(item.title))}</h3>${context.renderSlot(
              node,
              slotKey('items', index, 'blocks'),
            )}</div>`,
        ),
      ].join(''),
    ),
};

export const probeGrid: BlockModule = {
  definition: define({
    type: 'probe-grid',
    ...META,
    purpose: 'Parent probe.',
    summary: 'Probe grid holding probe cells.',
    props: { cells: blocks({ accepts: ['probe-cell'] }) },
  }),
  render: (node, context) =>
    element('div', nodeAttributes(node, { class: 'ak-block' }), context.renderSlot(node, 'cells')),
};

export const probeCell: BlockModule = {
  definition: define({
    type: 'probe-cell',
    ...META,
    parents: ['probe-grid'],
    purpose: 'Child probe.',
    summary: 'Probe cell, only inside a probe grid.',
    props: { title: LABEL },
  }),
  render: (node) => element('div', nodeAttributes(node, { class: 'ak-block' }), ''),
};

export const PROBE_GROUP: BlockGroup = {
  name: 'probe',
  blocks: [probePanel, probeGrid, probeCell],
  features: [],
};

export const PROBE_REGISTRY = buildRegistry([...BLOCK_GROUPS, PROBE_GROUP]);
