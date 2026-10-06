/** Grid block: a responsive grid container. */

import type { BlockModule } from '../../registry/block-module.js';
import { anchorProps, define, num } from '../../registry/define-helpers.js';
import { element, nodeAttributes, numberProp } from '../../render/block-helpers.js';

export const gridBlock: BlockModule = {
  definition: define({
    type: 'grid',
    category: 'layout',
    tags: ['container', 'columns', 'responsive'],
    useCases: ['side-by-side cards', 'multi-column layout'],
    purpose: 'Responsive grid container.',
    summary: 'Grid: children in N columns that collapse on narrow viewports.',
    props: {
      columns: num({ integer: true, min: 1, max: 6, default: 3 }),
      ...anchorProps,
    },
    slots: { children: { accepts: '*', min: 1, max: 200 } },
  }),
  render: (node, context) =>
    element(
      'div',
      nodeAttributes(node, {
        class: 'ak-block ak-grid',
        'data-ak-columns': String(Math.min(Math.max(numberProp(node, 'columns', 3), 1), 6)),
      }),
      context.renderChildren(node),
    ),
};
