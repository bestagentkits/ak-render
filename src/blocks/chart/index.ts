/** Chart blocks: deterministic SVG charts. */

import type { BlockGroup } from '../../registry/block-module.js';
import { chartBlock } from './chart.js';

export const CHART_GROUP: BlockGroup = {
  name: 'chart',
  blocks: [chartBlock],
  features: [],
};
