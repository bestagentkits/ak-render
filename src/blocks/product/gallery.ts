/** Gallery block: a responsive image grid. */

import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  itemsOf,
  num,
  OPTIONAL_TITLE,
  semantic,
  str as strProp,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  numberProp,
  objectListProp,
  resolveMedia,
  str,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeAttribute, escapeInlineText, escapeText } from '../../render/escape.js';

export const galleryBlock: BlockModule = {
  definition: semantic({
    type: 'gallery',
    category: 'media',
    tags: ['images', 'grid'],
    useCases: ['screenshot set', 'photo grid'],
    purpose: 'Image grid.',
    summary: 'Gallery: responsive image grid with captions.',
    props: {
      title: OPTIONAL_TITLE,
      columns: num({ integer: true, min: 1, max: 6, default: 3 }),
      items: itemsOf({
        src: urlProp({ required: true, asset: 'images' }),
        alt: strProp({ required: true, maxLength: 300 }),
        caption: txt(),
      }),
      ...anchorProps,
    },
    network: 'optional',
    assets: ['media'],
    a11y: 'Every image keeps its alt text; captions are visible text, not tooltips.',
  }),
  render: (node, context) => {
    const columns = Math.min(Math.max(numberProp(node, 'columns', 3), 1), 6);
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        titleHeader(node),
        `<ul class="ak-gallery" data-ak-columns="${columns}">${items
          .map((item) => {
            const resolved = resolveMedia(str(item.src), context.ir.policy.network, 'images');
            const captionText = str(item.caption);
            const body = resolved.allowed
              ? `<img src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(
                  str(item.alt),
                )}" loading="lazy" decoding="async" />`
              : `<a href="${escapeAttribute(resolved.src)}" rel="noreferrer noopener">${escapeText(
                  str(item.alt),
                )}</a>`;
            return `<li><figure>${body}${
              captionText === '' ? '' : `<figcaption>${escapeInlineText(captionText)}</figcaption>`
            }</figure></li>`;
          })
          .join('')}</ul>`,
      ].join(''),
    );
  },
};
