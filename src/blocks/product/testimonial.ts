/**
 * Testimonial block: customer quotes with attribution. One quote is featured
 * large; two or more form a responsive grid (this covers a quote grid). The
 * compiler decides the layout from the count; there is no carousel.
 */

import type { JsonValue } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  itemsOf,
  LABEL,
  OPTIONAL_TITLE,
  semantic,
  str as strProp,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  resolveMedia,
  str,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeAttribute, escapeInlineText, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { avatar } from './product-helpers.js';

function quoteFigure(item: Record<string, JsonValue>, context: RenderContext): string {
  const policy = context.ir.policy.network;
  const name = str(item.name);
  const role = str(item.role);
  const logoSource = str(item.logo);
  // A blocked logo never reaches here: the prop rejects it at validation.
  const logoMedia = logoSource === '' ? undefined : resolveMedia(logoSource, policy, 'images');
  const logo =
    logoMedia?.allowed === true
      ? `<img class="ak-testimonial-logo" src="${escapeAttribute(logoMedia.src)}" alt="" loading="lazy" decoding="async" />`
      : '';
  return `<figure class="ak-testimonial"><blockquote><p>${escapeInlineText(
    str(item.quote),
  )}</p></blockquote><figcaption>${avatar(
    str(item.avatar),
    name,
    policy,
  )}<span class="ak-testimonial-who"><span class="ak-testimonial-name">${escapeText(name)}</span>${
    role === '' ? '' : `<span class="ak-testimonial-role">${escapeText(role)}</span>`
  }</span>${logo}</figcaption></figure>`;
}

export const testimonialBlock: BlockModule = {
  definition: semantic({
    type: 'testimonial',
    category: 'product',
    tags: ['quotes', 'social-proof', 'customers'],
    useCases: ['customer quote', 'quote grid', 'social proof'],
    purpose: 'Customer quotes with attribution.',
    summary: 'Testimonial: 1 featured quote, or 2-9 quotes in a grid.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf(
        {
          quote: txt({ required: true, maxLength: 600 }),
          name: LABEL,
          role: strProp({ maxLength: 120 }),
          avatar: urlProp({
            asset: 'images',
            description: 'Falls back to initials when absent or blocked.',
          }),
          logo: urlProp({
            asset: 'images',
            rejectBlocked: true,
            description: 'Decorative company mark; a remote logo needs images allowed.',
          }),
        },
        { minItems: 1, maxItems: 9 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['testimonial'],
    network: 'optional',
    assets: ['media'],
    a11y: 'Each quote is a <figure> with a <blockquote> and a <figcaption> naming the speaker; avatars and logos are decorative.',
  }),
  render: (node, context) => {
    const items = objectListProp(node, 'items');
    const featured = items.length === 1;
    const body = featured
      ? quoteFigure(items[0] ?? {}, context)
      : `<ul class="ak-testimonials">${items
          .map((item) => `<li>${quoteFigure(item, context)}</li>`)
          .join('')}</ul>`;
    return element(
      'section',
      nodeAttributes(node, {
        class: 'ak-block ak-testimonial-block',
        'data-layout': featured ? 'featured' : 'grid',
      }),
      `${titleHeader(node)}${body}`,
    );
  },
};
