/** Logo cloud block: a wall of customer or partner marks. */

import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  itemsOf,
  LABEL,
  OPTIONAL_TITLE,
  semantic,
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
import { escapeAttribute, escapeText } from '../../render/escape.js';
import { authoredLink } from './product-helpers.js';

export const logoCloudBlock: BlockModule = {
  definition: semantic({
    type: 'logo-cloud',
    category: 'media',
    tags: ['logos', 'customers', 'partners', 'social-proof'],
    useCases: ['customer logos', 'partner wall', 'trusted by strip'],
    purpose: 'Customer or partner logos.',
    summary: 'Logo cloud: 2-24 logos; the name is the alt text and the blocked fallback.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf(
        {
          name: LABEL,
          src: urlProp({ required: true, asset: 'images' }),
          href: urlProp(),
        },
        { minItems: 2, maxItems: 24 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['logo-cloud'],
    network: 'optional',
    assets: ['media'],
    a11y: 'Each logo uses the organisation name as alt text; a blocked remote logo shows the name as text.',
  }),
  render: (node, context) => {
    const items = objectListProp(node, 'items').map((item) => {
      const name = str(item.name);
      const resolved = resolveMedia(str(item.src), context.ir.policy.network, 'images');
      // Under a denying policy the name is the logo: a wordmark, not a request.
      const mark = resolved.allowed
        ? `<img src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(
            name,
          )}" loading="lazy" decoding="async" />`
        : `<span class="ak-logo-name">${escapeText(name)}</span>`;
      const href = str(item.href);
      return `<li>${href === '' ? mark : authoredLink(href, mark)}</li>`;
    });
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      `${titleHeader(node)}<ul class="ak-logo-cloud">${items.join('')}</ul>`,
    );
  },
};
