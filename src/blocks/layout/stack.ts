/** Stack block: a vertical flow container. */

import type { BlockModule } from '../../registry/block-module.js';
import { anchorProps, define, enumStr } from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp } from '../../render/block-helpers.js';
import { LAYOUT_OPTIONS_FEATURE, useFeature } from './layout-styles.js';

export const stackBlock: BlockModule = {
  definition: define({
    type: 'stack',
    category: 'layout',
    tags: ['container', 'vertical'],
    useCases: ['vertical flow of blocks'],
    purpose: 'Vertical flow container.',
    summary: 'Stack: children flow vertically with a controlled gap.',
    props: {
      gap: enumStr(['tight', 'normal', 'loose'], { default: 'normal' }),
      align: enumStr(['start', 'center', 'end', 'stretch'], {
        default: 'stretch',
        description: 'Horizontal placement of children; stretch fills the width.',
      }),
      ...anchorProps,
    },
    slots: { children: { accepts: '*', min: 1, max: 200 } },
  }),
  render: (node, context) => {
    const align = stringProp(node, 'align', 'stretch');
    return element(
      'div',
      nodeAttributes(node, {
        class: 'ak-block ak-stack',
        'data-gap': stringProp(node, 'gap', 'normal'),
        'data-align': align === 'stretch' ? undefined : align,
      }),
      context.renderChildren(node),
    );
  },
  check: (node) => {
    if (stringProp(node, 'align', 'stretch') !== 'stretch')
      useFeature(node, LAYOUT_OPTIONS_FEATURE);
  },
};
