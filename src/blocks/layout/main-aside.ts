/** Main and aside layout: main content with a related column that sticks on wide screens. */

import type { BlockModule } from '../../registry/block-module.js';
import { anchorProps, blocks, define } from '../../registry/define-helpers.js';
import { element, nodeAttributes } from '../../render/block-helpers.js';
import { SEMANTIC_LAYOUT_BASE } from './semantic-layout-parts.js';

export const mainAsideBlock: BlockModule = {
  definition: define({
    type: 'main-aside',
    ...SEMANTIC_LAYOUT_BASE,
    tags: ['aside', 'two-column', 'sticky', 'responsive'],
    useCases: ['report with a summary column', 'article with key facts'],
    purpose: 'Main content with an aside column that stays in view on wide screens.',
    summary: 'Main/aside: main `blocks` with an `aside` column; stacks below it when narrow.',
    a11y: 'The aside is an <aside> after the main content, in DOM and visual order.',
    props: {
      aside: blocks({ required: true, maxItems: 6, description: 'Aside blocks.' }),
      ...anchorProps,
    },
  }),
  render: (node, context) =>
    element(
      'div',
      nodeAttributes(node, { class: 'ak-block ak-main-aside' }),
      `<div class="ak-layout-main">${context.renderChildren(node)}</div><aside class="ak-layout-side">${context.renderSlot(node, 'aside')}</aside>`,
    ),
};
