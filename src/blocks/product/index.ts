/** Product and media blocks: gallery, pricing, feature matrix, testimonials, logos, people and calendar. */

import type { BlockGroup, FeatureModule } from '../../registry/block-module.js';
import { calendarBlock } from './calendar.js';
import { featureMatrixBlock } from './feature-matrix.js';
import { galleryBlock } from './gallery.js';
import { logoCloudBlock } from './logo-cloud.js';
import { peopleBlock } from './people.js';
import { pricingBlock } from './pricing.js';
import { LIGHTBOX } from './product-runtime.js';
import {
  CALENDAR_CSS,
  FEATURE_MATRIX_CSS,
  LIGHTBOX_CSS,
  LOGO_CLOUD_CSS,
  PEOPLE_CSS,
  PRICING_CSS,
  TESTIMONIAL_CSS,
} from './product-styles.js';
import { testimonialBlock } from './testimonial.js';

/** One feature per block, so a page ships only the sheets its blocks use. */
const PRODUCT_FEATURES: readonly FeatureModule[] = [
  { name: 'pricing', marker: '.ak-pricing', css: PRICING_CSS },
  { name: 'feature-matrix', marker: '.ak-feature-matrix', css: FEATURE_MATRIX_CSS },
  { name: 'testimonial', marker: '.ak-testimonial', css: TESTIMONIAL_CSS },
  { name: 'logo-cloud', marker: '.ak-logo-cloud', css: LOGO_CLOUD_CSS },
  { name: 'people', marker: '.ak-people', css: PEOPLE_CSS },
  { name: 'calendar', marker: '.ak-calendar', css: CALENDAR_CSS },
  {
    name: 'lightbox',
    marker: '.ak-lightbox',
    css: LIGHTBOX_CSS,
    script: { code: LIGHTBOX, boot: 'wireLightbox();' },
    announces: true,
  },
];

export const PRODUCT_GROUP: BlockGroup = {
  name: 'product',
  blocks: [
    galleryBlock,
    pricingBlock,
    featureMatrixBlock,
    testimonialBlock,
    logoCloudBlock,
    peopleBlock,
    calendarBlock,
  ],
  features: PRODUCT_FEATURES,
};
