/** Editorial blocks: a publication masthead, stories, a rail digest and a broadsheet layout. */

import type { BlockGroup } from '../../registry/block-module.js';
import { digestListBlock } from './digest-list.js';
import { editorialLayoutBlock } from './editorial-layout.js';
import { EDITORIAL_FEATURES } from './editorial-styles.js';
import { publicationHeaderBlock } from './publication-header.js';
import { storyBlock } from './story.js';

export const EDITORIAL_GROUP: BlockGroup = {
  name: 'editorial',
  blocks: [publicationHeaderBlock, storyBlock, digestListBlock, editorialLayoutBlock],
  features: EDITORIAL_FEATURES,
};
