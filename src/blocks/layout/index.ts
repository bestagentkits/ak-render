/** Layout blocks: containers that arrange child blocks. */

import type { BlockGroup } from '../../registry/block-module.js';
import { gridBlock } from './grid.js';
import { splitBlock } from './split.js';
import { stackBlock } from './stack.js';

export const LAYOUT_GROUP: BlockGroup = {
  name: 'layout',
  blocks: [stackBlock, gridBlock, splitBlock],
  features: [],
};
