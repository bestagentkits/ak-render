/** Sidebar layout: a sidebar column beside the main content. */

import type { BlockModule } from '../../registry/block-module.js';
import { anchorProps, blocks, define, enumStr } from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp } from '../../render/block-helpers.js';
import { SEMANTIC_LAYOUT_BASE } from './semantic-layout-parts.js';

export const sidebarLayoutBlock: BlockModule = {
  definition: define({
    type: 'sidebar-layout',
    ...SEMANTIC_LAYOUT_BASE,
    tags: ['sidebar', 'two-column', 'responsive'],
    useCases: ['filters beside results', 'docs page with a side panel'],
    purpose: 'Main content with a sidebar column that stacks first on narrow screens.',
    summary: 'Sidebar layout: `sidebar` blocks beside the main `blocks`; stacks when narrow.',
    a11y: 'The sidebar is an <aside>; DOM order matches the visual order at every width.',
    props: {
      sidebar: blocks({ required: true, maxItems: 8, description: 'Sidebar blocks.' }),
      side: enumStr(['start', 'end'], { default: 'start' }),
      ...anchorProps,
    },
  }),
  render: (node, context) => {
    const end = stringProp(node, 'side', 'start') === 'end';
    const sidebar = `<aside class="ak-layout-side">${context.renderSlot(node, 'sidebar')}</aside>`;
    const main = `<div class="ak-layout-main">${context.renderChildren(node)}</div>`;
    return element(
      'div',
      nodeAttributes(node, {
        class: 'ak-block ak-sidebar-layout',
        'data-side': end ? 'end' : undefined,
      }),
      end ? main + sidebar : sidebar + main,
    );
  },
};
