/**
 * Block groups, in their fixed registration order. The order decides where a
 * group's blocks appear in the catalog and where its feature CSS and runtime
 * parts are emitted, so it never depends on discovery.
 */

import type { BlockGroup } from '../registry/block-module.js';
import { CHART_GROUP } from './chart/index.js';
import { COMPOSITION_GROUP } from './composition/index.js';
import { CONTROLS_GROUP } from './controls/index.js';
import { DATA_TABLE_GROUP } from './data-table/index.js';
import { ENGINEERING_GROUP } from './engineering/index.js';
import { EVIDENCE_GROUP } from './evidence/index.js';
import { LAYOUT_GROUP } from './layout/index.js';
import { PRODUCT_GROUP } from './product/index.js';
import { REVIEW_GROUP } from './review/index.js';

export const BLOCK_GROUPS: readonly BlockGroup[] = [
  COMPOSITION_GROUP,
  LAYOUT_GROUP,
  DATA_TABLE_GROUP,
  CHART_GROUP,
  ENGINEERING_GROUP,
  EVIDENCE_GROUP,
  PRODUCT_GROUP,
  CONTROLS_GROUP,
  REVIEW_GROUP,
];
