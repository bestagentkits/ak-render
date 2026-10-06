/** Composition blocks: tabbed, collapsible, sequenced and mosaic groupings of content. */

import type { BlockGroup } from '../../registry/block-module.js';
import { accordionBlock } from './accordion.js';
import { bentoBlock } from './bento.js';
import { carouselBlock } from './carousel.js';
import { tabsBlock } from './tabs.js';

export const COMPOSITION_GROUP: BlockGroup = {
  name: 'composition',
  blocks: [tabsBlock, accordionBlock, carouselBlock, bentoBlock],
  features: [],
};
