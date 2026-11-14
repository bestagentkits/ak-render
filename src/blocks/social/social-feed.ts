/**
 * Social feed: several posts in the supplied order. One post is featured; two
 * or more form a responsive grid that drops to one column when narrow. The
 * compiler adds no sorting or "trending" logic: the author ranks the posts.
 */

import type { BlockModule } from '../../registry/block-module.js';
import { anchorProps, itemsOf, OPTIONAL_TITLE, semantic } from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  titleHeader,
} from '../../render/block-helpers.js';
import { POST_FIELDS } from './social-fields.js';
import { checkPost, renderPost } from './social-render.js';

export const socialFeedBlock: BlockModule = {
  definition: semantic({
    type: 'social-feed',
    category: 'content',
    tags: ['social', 'posts', 'feed', 'buzz', 'news'],
    useCases: ['community buzz', 'reactions roundup', 'social proof wall'],
    purpose: 'Several social posts as static cards, in the supplied order.',
    summary: 'Social feed: `title`, 1-24 `posts` shaped like social-post.',
    props: {
      title: OPTIONAL_TITLE,
      posts: itemsOf(POST_FIELDS, { minItems: 1, maxItems: 24 }),
      ...anchorProps,
    },
    runtimeFeatures: ['social-post'],
    network: 'optional',
    assets: ['media'],
    a11y: 'A list of <article> posts, each named by author and date; order is the supplied order.',
  }),
  check: (node, context) => {
    objectListProp(node, 'posts').forEach((post, at) => {
      checkPost(post, `${node.path}.posts[${at}]`, node, context);
    });
  },
  render: (node, context) => {
    const posts = objectListProp(node, 'posts');
    const featured = posts.length === 1;
    const cards = posts.map((post, at) =>
      renderPost(post, context, { id: `${node.id}-p${at + 1}`, path: `${node.path}.posts[${at}]` }),
    );
    const body = featured
      ? (cards[0] ?? '')
      : `<ul class="ak-social-feed">${cards.map((card) => `<li>${card}</li>`).join('')}</ul>`;
    return element(
      'section',
      nodeAttributes(node, {
        class: 'ak-block ak-social-block',
        'data-layout': featured ? 'featured' : 'grid',
      }),
      `${titleHeader(node)}${body}`,
    );
  },
};
