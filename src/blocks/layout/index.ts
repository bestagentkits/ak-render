/** Layout blocks: containers that arrange child blocks. */

import type { BlockGroup } from '../../registry/block-module.js';
import { gridBlock } from './grid.js';
import { gridItemBlock } from './grid-item.js';
import { LAYOUT_FEATURES } from './layout-styles.js';
import { mainAsideBlock } from './main-aside.js';
import { railLayoutBlock } from './rail-layout.js';
import { sidebarLayoutBlock } from './sidebar-layout.js';
import { splitBlock } from './split.js';
import { stackBlock } from './stack.js';

export const LAYOUT_GROUP: BlockGroup = {
  name: 'layout',
  blocks: [
    stackBlock,
    gridBlock,
    splitBlock,
    gridItemBlock,
    sidebarLayoutBlock,
    mainAsideBlock,
    railLayoutBlock,
  ],
  features: LAYOUT_FEATURES,
};
