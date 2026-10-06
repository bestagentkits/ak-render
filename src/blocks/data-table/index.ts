/** Data table blocks: typed, sortable, searchable tables bound to a dataset. */

import type { BlockGroup } from '../../registry/block-module.js';
import { DATA_TABLE_FEATURE, dataTableBlock } from './data-table.js';
import { DATA_TABLE_RUNTIME } from './data-table-runtime.js';
import { DATA_TABLE_CSS } from './data-table-styles.js';

export const DATA_TABLE_GROUP: BlockGroup = {
  name: 'data-table',
  blocks: [dataTableBlock],
  features: [
    {
      name: DATA_TABLE_FEATURE,
      marker: '.ak-data-table',
      css: DATA_TABLE_CSS,
      script: { code: DATA_TABLE_RUNTIME, boot: 'wireDataTables();' },
      announces: true,
    },
  ],
};
