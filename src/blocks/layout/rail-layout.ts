/** Rail layout: a compact vertical rail beside the main content, a top strip when narrow. */

import type { IrNode } from '../../ir.js';
import type { BlockModule } from '../../registry/block-module.js';
import { anchorProps, blocks, define, str } from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp } from '../../render/block-helpers.js';
import type { RenderContext } from '../../render/render-context.js';
import { SEMANTIC_LAYOUT_BASE } from './semantic-layout-parts.js';

/** Rail blocks that are pure navigation; a rail of only these renders as <nav>. */
const NAVIGATION_TYPES = new Set(['link', 'toolbar']);

function railIsNavigation(node: IrNode, context: RenderContext): boolean {
  const ids = node.slots?.rail ?? [];
  return ids.length > 0 && ids.every((id) => NAVIGATION_TYPES.has(context.byId(id)?.type ?? ''));
}

export const railLayoutBlock: BlockModule = {
  definition: define({
    type: 'rail-layout',
    ...SEMANTIC_LAYOUT_BASE,
    tags: ['rail', 'navigation', 'responsive'],
    useCases: ['section links beside content', 'compact side toolbar'],
    purpose: 'Main content with a compact rail that becomes a top strip on narrow screens.',
    summary: 'Rail layout: compact `rail` beside the main `blocks`; a top strip when narrow.',
    a11y: 'A rail of only links or toolbars is a labelled <nav>; otherwise a labelled region.',
    props: {
      rail: blocks({ required: true, maxItems: 8, description: 'Rail blocks.' }),
      label: str({ maxLength: 80, description: 'Accessible name of the rail.' }),
      ...anchorProps,
    },
  }),
  render: (node, context) => {
    const navigation = railIsNavigation(node, context);
    const label = stringProp(node, 'label', navigation ? 'Section links' : 'Side rail');
    const rail = element(
      navigation ? 'nav' : 'div',
      { class: 'ak-rail', role: navigation ? undefined : 'region', 'aria-label': label },
      context.renderSlot(node, 'rail'),
    );
    return element(
      'div',
      nodeAttributes(node, { class: 'ak-block ak-rail-layout' }),
      `${rail}<div class="ak-layout-main">${context.renderChildren(node)}</div>`,
    );
  },
};
