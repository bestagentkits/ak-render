/** Controls that drive page state, and the filter bar that groups them over a filterable block. */

import type { BlockGroup } from '../../registry/block-module.js';
import { checkboxBlock } from './checkbox.js';
import { CONTROLS_RUNTIME, FILTER_BAR_RUNTIME } from './controls-runtime.js';
import { CONTROLS_CSS, FILTER_BAR_CSS } from './controls-styles.js';
import { dateInputBlock } from './date-input.js';
import { filterBarBlock } from './filter-bar.js';
import { numberInputBlock } from './number-input.js';
import { radioGroupBlock } from './radio-group.js';
import { selectBlock } from './select.js';
import { switchBlock } from './switch.js';
import { textInputBlock } from './text-input.js';

export const CONTROLS_GROUP: BlockGroup = {
  name: 'controls',
  blocks: [
    selectBlock,
    radioGroupBlock,
    checkboxBlock,
    switchBlock,
    textInputBlock,
    numberInputBlock,
    dateInputBlock,
    filterBarBlock,
  ],
  // `filter-bar` reuses the control readers, so `controls` must come first.
  features: [
    {
      name: 'controls',
      marker: '.ak-control{',
      css: CONTROLS_CSS,
      script: { code: CONTROLS_RUNTIME, boot: 'wireControls();' },
    },
    {
      name: 'filter-bar',
      marker: '.ak-filter-bar{',
      css: FILTER_BAR_CSS,
      script: { code: FILTER_BAR_RUNTIME, boot: 'wireFilterBars();' },
      announces: true,
    },
  ],
};
