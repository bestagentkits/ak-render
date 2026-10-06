/** Definition fields the semantic page layouts share. */

import { SEMANTIC_LAYOUT_FEATURE } from './layout-styles.js';

export const SEMANTIC_LAYOUT_BASE = {
  category: 'layout',
  runtimeFeatures: [SEMANTIC_LAYOUT_FEATURE],
  /** The main column is the block's own `blocks`. */
  slots: { children: { accepts: '*', min: 1, max: 40 } },
} as const;
