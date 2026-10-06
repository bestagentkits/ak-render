/** Engineering widgets: boards, plans, test runs, logs, API and schema references. */

import type { BlockGroup, FeatureModule } from '../../registry/block-module.js';
import { apiEndpointBlock } from './api-endpoint.js';
import {
  API_ENDPOINT_CSS,
  KANBAN_CSS,
  LOG_VIEWER_CSS,
  ROADMAP_CSS,
  SCHEMA_VIEWER_CSS,
  TEST_RESULTS_CSS,
} from './engineering-styles.js';
import { kanbanBlock } from './kanban.js';
import { logViewerBlock } from './log-viewer.js';
import { roadmapBlock } from './roadmap.js';
import { schemaViewerBlock } from './schema-viewer.js';
import { testResultsBlock } from './test-results.js';

/** One CSS-only feature per widget, so a page ships only the sheets it uses. */
const ENGINEERING_FEATURES: readonly FeatureModule[] = [
  { name: 'kanban', marker: '.ak-kanban-cols{', css: KANBAN_CSS },
  { name: 'roadmap', marker: '.ak-roadmap-grid{', css: ROADMAP_CSS },
  { name: 'test-results', marker: '.ak-tests-summary{', css: TEST_RESULTS_CSS },
  { name: 'log-viewer', marker: '.ak-log-lines{', css: LOG_VIEWER_CSS },
  { name: 'api-endpoint', marker: '.ak-api-head{', css: API_ENDPOINT_CSS },
  { name: 'schema-viewer', marker: '.ak-schema-row{', css: SCHEMA_VIEWER_CSS },
];

export const ENGINEERING_GROUP: BlockGroup = {
  name: 'engineering',
  blocks: [
    kanbanBlock,
    roadmapBlock,
    testResultsBlock,
    logViewerBlock,
    apiEndpointBlock,
    schemaViewerBlock,
  ],
  features: ENGINEERING_FEATURES,
};
