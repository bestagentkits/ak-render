/**
 * Story: one article of an editorial page. Its prominence picks the type scale
 * and the treatment; the compiler decides the rest. A story is an <article>
 * named by its headline, so it stays navigable out of its layout slot.
 */

import type { IrNode } from '../../ir.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  enumStr,
  semantic,
  str as strProp,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import {
  blockedReason,
  element,
  nodeAttributes,
  resolveMedia,
  stringProp,
} from '../../render/block-helpers.js';
import { escapeAttribute, escapeInlineText, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { anchor } from './editorial-helpers.js';

function photo(node: IrNode, context: RenderContext): string {
  const source = stringProp(node, 'image');
  if (source === '') return '';
  const alt = stringProp(node, 'alt');
  const caption = stringProp(node, 'caption');
  const credit = stringProp(node, 'credit');
  const resolved = resolveMedia(source, context.ir.policy.network, 'images');
  const picture = resolved.allowed
    ? `<img src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(alt)}" loading="lazy" decoding="async" />`
    : `<p class="ak-story-photo-fallback"><strong>${escapeText(alt)}</strong> <span>Remote image not loaded: ${blockedReason(context.ir.policy.network, 'images')}.</span></p>`;
  const text = [
    caption === '' ? '' : escapeInlineText(caption),
    credit === '' ? '' : `<span class="ak-story-credit">${escapeText(credit)}</span>`,
  ]
    .filter((part) => part !== '')
    .join(' ');
  return `<figure class="ak-story-photo">${picture}${text === '' ? '' : `<figcaption>${text}</figcaption>`}</figure>`;
}

export const storyBlock: BlockModule = {
  definition: semantic({
    type: 'story',
    category: 'content',
    tags: ['article', 'news', 'headline', 'newspaper'],
    useCases: ['newspaper article', 'lead story', 'brief'],
    purpose: 'An editorial story: kicker, headline, source, optional photo, summary and body.',
    summary:
      'Story: `title`, `prominence` lead|feature|brief, `category`, `source`, `byline`, `summary`, `body`, `image`.',
    props: {
      title: strProp({ required: true, maxLength: 240 }),
      prominence: enumStr(['lead', 'feature', 'brief'], {
        default: 'feature',
        description: 'Sets the type scale: lead is the front-page story, brief the smallest.',
      }),
      category: strProp({ maxLength: 60, description: 'Small kicker above the headline.' }),
      source: strProp({ maxLength: 120 }),
      byline: strProp({ maxLength: 120 }),
      meta: strProp({
        maxLength: 120,
        description: 'Supplied extra line, e.g. engagement counts.',
      }),
      summary: txt({ maxLength: 600, description: 'Standfirst under the headline.' }),
      body: txt({
        maxLength: 6000,
        description:
          'Story text; blank lines split paragraphs. A lead story opens with a drop cap.',
      }),
      href: urlProp({ description: 'Makes the headline a link.' }),
      image: urlProp({ asset: 'images', description: 'Local photo or allowlisted URL.' }),
      alt: strProp({
        maxLength: 300,
        description: 'Required when image is set; empty marks it decorative.',
      }),
      caption: txt({ maxLength: 300 }),
      credit: strProp({ maxLength: 120, description: 'Photo credit, shown after the caption.' }),
      ...anchorProps,
    },
    network: 'optional',
    assets: ['media'],
    runtimeFeatures: ['story'],
    a11y: 'An <article> labelled by its <h2> headline; the photo keeps its alt text and a figcaption.',
  }),
  check: (node, { bag }) => {
    if (typeof node.props.image === 'string' && typeof node.props.alt !== 'string') {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: `${node.path}.alt`,
        nodeId: node.id,
        message: 'a story image needs alt text (an empty string marks it decorative)',
      });
    }
  },
  render: (node, context) => {
    const prominence = stringProp(node, 'prominence', 'feature');
    const titleId = `${node.id}-title`;
    const title = escapeText(stringProp(node, 'title'));
    const href = stringProp(node, 'href');
    const category = stringProp(node, 'category');
    const source = stringProp(node, 'source');
    const byline = stringProp(node, 'byline');
    const meta = stringProp(node, 'meta');
    const summary = stringProp(node, 'summary');
    const paragraphs = stringProp(node, 'body')
      .split(/\n{2,}/u)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    const byLine = [source, byline, meta].filter((part) => part !== '');
    return element(
      'article',
      nodeAttributes(node, {
        class: 'ak-block ak-story',
        'data-prominence': prominence,
        'aria-labelledby': titleId,
      }),
      [
        photo(node, context),
        category === '' ? '' : `<p class="ak-story-kicker">${escapeText(category)}</p>`,
        `<h2 class="ak-story-title" id="${escapeAttribute(titleId)}">${href === '' ? title : anchor(href, title)}</h2>`,
        byLine.length === 0
          ? ''
          : `<p class="ak-story-meta">${byLine.map((part) => `<span>${escapeText(part)}</span>`).join('')}</p>`,
        summary === '' ? '' : `<p class="ak-story-summary">${escapeInlineText(summary)}</p>`,
        paragraphs.length === 0
          ? ''
          : `<div class="ak-story-body">${paragraphs
              .map((part) => `<p>${escapeInlineText(part.replace(/\n/gu, ' '))}</p>`)
              .join('')}</div>`,
      ].join(''),
    );
  },
};
