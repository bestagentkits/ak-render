/**
 * A test-only filterable block: it lists its data rows with the filter row
 * contract, so filter-bar checks and rendering can be exercised without
 * depending on a production filterable block.
 */

import { BLOCK_GROUPS } from '../../../src/blocks/index.js';
import type { BlockGroup, BlockModule } from '../../../src/registry/block-module.js';
import { anchorProps, define, OPTIONAL_TITLE } from '../../../src/registry/define-helpers.js';
import { buildRegistry } from '../../../src/registry/registry.js';
import { element, filterRowAttributes, nodeAttributes } from '../../../src/render/block-helpers.js';
import { escapeText, renderAttributes } from '../../../src/render/escape.js';

export const probeRows: BlockModule = {
  definition: define({
    type: 'probe-rows',
    category: 'data',
    tags: ['probe'],
    useCases: ['filter-bar test'],
    filterable: true,
    data: { required: true, description: 'Rows to list.' },
    purpose: 'Filterable probe.',
    summary: 'Probe list whose rows carry the filter row contract.',
    props: { title: OPTIONAL_TITLE, ...anchorProps },
  }),
  render: (node) =>
    element(
      'ul',
      nodeAttributes(node, { class: 'ak-block' }),
      (node.data?.rows ?? [])
        .map(
          (row) =>
            `<li${renderAttributes(filterRowAttributes(row))}>${escapeText(
              Object.values(row).map(String).join(' '),
            )}</li>`,
        )
        .join(''),
    ),
};

export const PROBE_FILTERABLE_GROUP: BlockGroup = {
  name: 'probe-filterable',
  blocks: [probeRows],
  features: [],
};

export const FILTERABLE_REGISTRY = buildRegistry([...BLOCK_GROUPS, PROBE_FILTERABLE_GROUP]);
