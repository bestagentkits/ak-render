/** Pricing block: plan cards with a price, a feature list and an optional call to action. */

import { CURRENCIES, formatValue } from '../../data/format-value.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  bool,
  enumStr,
  itemsOf,
  LABEL,
  list,
  num,
  OPTIONAL_TITLE,
  obj,
  oneOf,
  semantic,
  str as strProp,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeInlineText, escapeText } from '../../render/escape.js';
import { authoredLink, reportAt } from './product-helpers.js';

const PERIODS = ['month', 'year', 'once'] as const;

/** A price is authored text (`$0`, `Custom`) or a number formatted in `currency`. */
function priceText(price: unknown, currency: unknown): string {
  if (typeof price === 'string') return price;
  if (typeof price !== 'number') return '';
  return formatValue(price, {
    format: 'currency',
    currency: typeof currency === 'string' ? currency : 'USD',
    // Whole prices read as `$29`, not `$29.00`.
    ...(Number.isInteger(price) ? { decimals: 0 } : {}),
  });
}

function periodText(period: string): string {
  if (period === 'once') return '<span class="ak-plan-period">one-time</span>';
  // The slash is visual shorthand; a screen reader hears "per month".
  return `<span class="ak-plan-period"><span aria-hidden="true">/</span><span class="ak-sr">per </span>${escapeText(
    period,
  )}</span>`;
}

export const pricingBlock: BlockModule = {
  definition: semantic({
    type: 'pricing',
    category: 'product',
    tags: ['plans', 'pricing', 'tiers'],
    useCases: ['pricing page', 'plan comparison cards'],
    purpose: 'Pricing plans.',
    summary: 'Pricing: 1-4 plan cards with price, features and a call to action.',
    props: {
      title: OPTIONAL_TITLE,
      plans: itemsOf(
        {
          name: LABEL,
          price: oneOf([strProp({ maxLength: 40 }), num({ min: 0 })], {
            required: true,
            description: 'Text such as "$0" or "Custom", or a number formatted in currency.',
          }),
          currency: enumStr(CURRENCIES, { description: 'Used when price is a number.' }),
          period: enumStr(PERIODS),
          summary: txt({ maxLength: 280 }),
          features: list(txt({ maxLength: 200 }), { maxItems: 12 }),
          cta: obj({ label: LABEL, href: urlProp({ required: true }) }),
          highlight: bool({ description: 'Marks the recommended plan; at most one.' }),
        },
        { minItems: 1, maxItems: 4 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['pricing'],
    a11y: 'Each plan is a list item headed by its name; the recommended plan says so in text, not only by colour.',
  }),
  render: (node) => {
    const plans = objectListProp(node, 'plans');
    const cards = plans.map((plan) => {
      const highlighted = plan.highlight === true;
      const period = str(plan.period);
      const summary = str(plan.summary);
      const features = Array.isArray(plan.features)
        ? plan.features.filter((item): item is string => typeof item === 'string')
        : [];
      const cta =
        plan.cta !== null && typeof plan.cta === 'object' && !Array.isArray(plan.cta)
          ? plan.cta
          : undefined;
      return `<li class="ak-plan"${highlighted ? ' data-highlight="true"' : ''}>${
        highlighted ? '<p class="ak-plan-badge">Recommended</p>' : ''
      }<h3 class="ak-plan-name">${escapeText(str(plan.name))}</h3><p class="ak-plan-price"><span class="ak-plan-amount">${escapeText(
        priceText(plan.price, plan.currency),
      )}</span>${period === '' ? '' : periodText(period)}</p>${
        summary === '' ? '' : `<p class="ak-plan-summary">${escapeInlineText(summary)}</p>`
      }${
        features.length === 0
          ? ''
          : `<ul class="ak-plan-features">${features
              .map((feature) => `<li>${escapeInlineText(feature)}</li>`)
              .join('')}</ul>`
      }${
        cta === undefined
          ? ''
          : authoredLink(
              str(cta.href),
              escapeText(str(cta.label)),
              ` class="ak-btn ak-plan-cta"${highlighted ? ' data-variant="primary"' : ''}`,
            )
      }</li>`;
    });
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      `${titleHeader(node)}<ul class="ak-pricing" data-ak-count="${plans.length}">${cards.join(
        '',
      )}</ul>`,
    );
  },
  check: (node, context) => {
    const highlighted = objectListProp(node, 'plans')
      .map((plan, index) => (plan.highlight === true ? index : -1))
      .filter((index) => index >= 0);
    if (highlighted.length > 1) {
      reportAt(
        context,
        node,
        `.plans[${highlighted[1]}].highlight`,
        'only one plan may be highlighted',
        { highlighted },
      );
    }
  },
};
