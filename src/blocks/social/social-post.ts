/**
 * Social post: one post from X, Threads, Bluesky, Mastodon, LinkedIn, YouTube,
 * Reddit or Hacker News as a static card drawn from supplied data. It is never
 * a live widget: no frame, no platform script, no beacon.
 */

import type { BlockModule } from '../../registry/block-module.js';
import { anchorProps, semantic } from '../../registry/define-helpers.js';
import { element, nodeAttributes } from '../../render/block-helpers.js';
import { POST_FIELDS } from './social-fields.js';
import { checkPost, renderPost } from './social-render.js';

export const socialPostBlock: BlockModule = {
  definition: semantic({
    type: 'social-post',
    category: 'content',
    tags: ['social', 'post', 'tweet', 'thread', 'news'],
    useCases: ['quote a tweet', 'launch announcement', 'social proof'],
    purpose:
      'One social post (X, Threads, Bluesky, YouTube, Reddit, HN…) as a static card from supplied data.',
    summary:
      'Social post: `platform`, `url`, `author`, `text`, `date`, `media`, `metrics`, `quoted`.',
    props: { ...POST_FIELDS, ...anchorProps },
    runtimeFeatures: ['social-post'],
    network: 'optional',
    assets: ['media'],
    a11y: 'An <article> named by author and date; text in a <blockquote cite>; counts are labelled text; marks have text equivalents.',
  }),
  check: (node, context) => checkPost(node.props, node.path, node, context),
  render: (node, context) =>
    element(
      'section',
      nodeAttributes(node, { class: 'ak-block ak-social-block', 'data-layout': 'featured' }),
      renderPost(node.props, context, { id: node.id, path: node.path }),
    ),
};
