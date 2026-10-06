/** Product and media blocks. */

import type { BlockGroup } from '../../registry/block-module.js';
import { galleryBlock } from './gallery.js';

export const PRODUCT_GROUP: BlockGroup = {
  name: 'product',
  blocks: [galleryBlock],
  features: [],
};
