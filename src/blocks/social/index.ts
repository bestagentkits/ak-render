/** Social blocks: one post or a feed of posts, as static, script-free cards. */

import type { BlockGroup } from '../../registry/block-module.js';
import { socialFeedBlock } from './social-feed.js';
import { socialPostBlock } from './social-post.js';
import { SOCIAL_FEATURES } from './social-styles.js';

export const SOCIAL_GROUP: BlockGroup = {
  name: 'social',
  blocks: [socialPostBlock, socialFeedBlock],
  features: SOCIAL_FEATURES,
};
