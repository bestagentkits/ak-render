/** Carousel block: sequenced slides with manual navigation. */

import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  itemsOf,
  LABEL,
  onProp,
  str as strProp,
  txt,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  stringProp,
} from '../../render/block-helpers.js';
import { escapeText } from '../../render/escape.js';
import { checkItemContent, nestedBlocks, renderItemBody } from './nestable-blocks.js';

export const carouselBlock: BlockModule = {
  definition: define({
    type: 'carousel',
    category: 'interaction',
    tags: ['slides', 'sequence'],
    useCases: ['slide sequence', 'walkthrough'],
    purpose: 'Sequenced slides with manual navigation.',
    summary: 'Carousel: prev/next, keyboard, and swipe across slides.',
    props: {
      ariaLabel: strProp({ required: true, maxLength: 120 }),
      items: itemsOf(
        {
          title: LABEL,
          text: txt(),
          blocks: nestedBlocks('text', 12),
        },
        { minItems: 1 },
      ),
      on: onProp('Optional state binding fired when the active slide changes.'),
      ...anchorProps,
    },
    runtimeFeatures: ['carousel'],
    actions: ['next', 'previous'],
    a11y: 'Labeled region with prev/next buttons, arrow-key support, a slide counter, and no autoplay.',
  }),
  render: (node, context) => {
    const items = objectListProp(node, 'items');
    const label = stringProp(node, 'ariaLabel', 'Carousel');
    const slides = items
      .map(
        (item, index) =>
          `<div class="ak-carousel-slide" data-ak-slide tabindex="-1"><h3>${escapeText(
            str(item.title),
          )}</h3>${renderItemBody(node, index, context, str(item.text), true)}</div>`,
      )
      .join('');
    return element(
      'section',
      nodeAttributes(node, {
        class: 'ak-block ak-carousel',
        'data-ak-carousel-root': 'true',
        role: 'group',
        'aria-roledescription': 'carousel',
        'aria-label': label,
      }),
      [
        `<div class="ak-carousel-slides">${slides}</div>`,
        `<div class="ak-carousel-controls">
<button type="button" class="ak-btn" data-ak-carousel="prev" aria-label="Previous slide">Previous</button>
<button type="button" class="ak-btn" data-ak-carousel="next" aria-label="Next slide">Next</button>
<span class="ak-carousel-status" data-ak-carousel-status aria-live="polite">1 / ${Math.max(items.length, 1)}</span>
</div>`,
      ].join(''),
    );
  },
  check: (node, context) =>
    checkItemContent(node, context, 'text', 'a carousel slide needs text or blocks'),
};
