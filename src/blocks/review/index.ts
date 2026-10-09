/** Review: decisions the reader answers and the feedback panel that copies them, with comments, for the agent. */

import type { BlockGroup } from '../../registry/block-module.js';
import { decisionBlock } from './decision.js';
import { feedbackBlock } from './feedback.js';
import { REVIEW_RUNTIME } from './review-runtime.js';
import { REVIEW_CSS } from './review-styles.js';

export const REVIEW_GROUP: BlockGroup = {
  name: 'review',
  blocks: [decisionBlock, feedbackBlock],
  features: [
    {
      name: 'review',
      marker: '.ak-decision{',
      css: REVIEW_CSS,
      script: { code: REVIEW_RUNTIME, boot: 'wireReview();' },
      announces: true,
    },
  ],
};
