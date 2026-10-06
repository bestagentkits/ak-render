/** Accordion block: collapsible sections. */

import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  itemsOf,
  LABEL,
  OPTIONAL_TITLE,
  onProp,
  txt,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeInlineText, escapeText, renderAttributes } from '../../render/escape.js';

export const accordionBlock: BlockModule = {
  definition: define({
    type: 'accordion',
    purpose: 'Collapsible sections.',
    summary: 'Accordion: disclosure sections that expand and collapse.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({ title: LABEL, text: txt({ required: true }) }),
      on: onProp('Optional state binding fired when a section toggles.'),
      ...anchorProps,
    },
    runtimeFeatures: ['accordion'],
    actions: ['toggle', 'expand', 'collapse'],
    a11y: 'Native <details>/<summary> where possible; otherwise button + region with aria-expanded.',
  }),
  render: (node) => {
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block ak-accordion' }),
      [
        titleHeader(node),
        items
          .map(
            (item, index) =>
              // Each disclosure carries its own id so a declarative expand or
              // collapse action can address one section. Native <details> remains
              // the behavior; the action only drives it.
              `<details${index === 0 ? ' open' : ''}${renderAttributes({
                'data-ak-id': `${node.id}-item-${index}`,
              })}><summary>${escapeText(str(item.title))}</summary><p>${escapeInlineText(
                str(item.text),
              )}</p></details>`,
          )
          .join(''),
      ].join(''),
    );
  },
};
