/**
 * Editorial layout: a broadsheet composition of three semantic regions. The
 * author names what each region holds (lead, secondary, aside); the compiler
 * owns the columns, rules and breakpoints. Regions stay in reading order in the
 * DOM at every width, so no column is reordered with CSS.
 */

import type { BlockModule } from '../../registry/block-module.js';
import { anchorProps, blocks, define, enumStr, str } from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp } from '../../render/block-helpers.js';
import { escapeAttribute } from '../../render/escape.js';

export const editorialLayoutBlock: BlockModule = {
  definition: define({
    type: 'editorial-layout',
    category: 'layout',
    tags: ['broadsheet', 'columns', 'newspaper', 'responsive'],
    useCases: ['newspaper front page', 'lead with rail'],
    purpose: 'Broadsheet composition: lead, secondary and aside regions with column rules.',
    summary:
      'Editorial layout: `lead`, `secondary` and `aside` block lists; three columns wide, one when narrow.',
    props: {
      variant: enumStr(['broadsheet'], { default: 'broadsheet' }),
      lead: blocks({ required: true, maxItems: 6, description: 'Widest column: the lead story.' }),
      secondary: blocks({ maxItems: 8, description: 'Middle column: features.' }),
      aside: blocks({ maxItems: 8, description: 'Right rail: briefs, lists.' }),
      label: str({ maxLength: 80, description: 'Accessible name of the aside.' }),
      ...anchorProps,
    },
    runtimeFeatures: ['broadsheet'],
    a11y: 'Regions follow lead, secondary, aside in the DOM; the aside is a labelled <aside>.',
  }),
  render: (node, context) => {
    const secondary = context.renderSlot(node, 'secondary');
    const aside = context.renderSlot(node, 'aside');
    const label = stringProp(node, 'label', 'Briefs');
    return element(
      'div',
      nodeAttributes(node, {
        class: 'ak-block ak-broadsheet',
        'data-variant': stringProp(node, 'variant', 'broadsheet'),
        'data-regions': ['lead', secondary === '' ? '' : 'secondary', aside === '' ? '' : 'aside']
          .filter((region) => region !== '')
          .join(' '),
      }),
      [
        `<div class="ak-bs-lead">${context.renderSlot(node, 'lead')}</div>`,
        secondary === '' ? '' : `<div class="ak-bs-secondary">${secondary}</div>`,
        aside === ''
          ? ''
          : `<aside class="ak-bs-aside" aria-label="${escapeAttribute(label)}">${aside}</aside>`,
      ].join(''),
    );
  },
};
