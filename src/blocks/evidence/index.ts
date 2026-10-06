/** Evidence widgets: measured comparisons, breakdowns, annotated captures and sources. */

import type { BlockGroup } from '../../registry/block-module.js';
import { annotatedImageBlock } from './annotated-image.js';
import { benchmarkComparisonBlock } from './benchmark-comparison.js';
import { ANNOTATED_IMAGE_CSS, EVIDENCE_CSS } from './evidence-styles.js';
import { metricBreakdownBlock } from './metric-breakdown.js';
import { referencesBlock } from './references.js';

export const EVIDENCE_GROUP: BlockGroup = {
  name: 'evidence',
  blocks: [benchmarkComparisonBlock, metricBreakdownBlock, annotatedImageBlock, referencesBlock],
  features: [
    { name: 'evidence', marker: '.ak-bench', css: EVIDENCE_CSS },
    { name: 'annotated-image', marker: '.ak-annotated', css: ANNOTATED_IMAGE_CSS },
  ],
};
