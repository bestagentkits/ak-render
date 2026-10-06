/** Split block: two child groups side by side. */

import type { BlockModule } from '../../registry/block-module.js';
import { anchorProps, define, enumStr } from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp } from '../../render/block-helpers.js';

export const splitBlock: BlockModule = {
  definition: define({
    type: 'split',
    purpose: 'Two-column split container.',
    summary: 'Split: two child groups side by side, stacking when narrow.',
    props: {
      ratio: enumStr(['even', 'wide-left', 'wide-right'], { default: 'even' }),
      ...anchorProps,
    },
    slots: { children: { accepts: '*', min: 2, max: 2 } },
  }),
  render: (node, context) =>
    element(
      'div',
      nodeAttributes(node, {
        class: 'ak-block ak-split',
        'data-ratio': stringProp(node, 'ratio', 'even'),
      }),
      context.renderChildren(node),
    ),
};
