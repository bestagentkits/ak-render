/**
 * Publication header: the masthead of an editorial front page. An issue and
 * date band, the publication name as the page's h1, a strapline, an edition
 * blurb and a section navigation. Issue and date are supplied, never read from
 * a clock.
 */

import type { JsonValue } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  list,
  obj,
  oneOf,
  semantic,
  str as strProp,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp } from '../../render/block-helpers.js';
import { escapeInlineText, escapeText } from '../../render/escape.js';
import { anchor, timeElement } from './editorial-helpers.js';

function sectionItem(item: JsonValue | undefined): string {
  if (typeof item === 'string') return `<li><span>${escapeText(item)}</span></li>`;
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return '';
  const label = typeof item.label === 'string' ? item.label : '';
  const href = typeof item.href === 'string' ? item.href : '';
  if (label === '') return '';
  return `<li>${href === '' ? `<span>${escapeText(label)}</span>` : anchor(href, escapeText(label))}</li>`;
}

export const publicationHeaderBlock: BlockModule = {
  definition: semantic({
    type: 'publication-header',
    category: 'content',
    tags: ['masthead', 'newspaper', 'edition', 'navigation'],
    useCases: ['newspaper front page', 'editorial masthead'],
    purpose: 'Masthead of a publication page: issue band, name, strapline, blurb, section links.',
    summary:
      'Publication header: `name` (the h1), supplied `date`/`issue`/`edition`, `tagline`, `description`, `sections`.',
    props: {
      name: strProp({
        required: true,
        maxLength: 120,
        description: 'Publication name; the page h1.',
      }),
      date: strProp({
        maxLength: 60,
        description: 'Supplied date text. An ISO date (2026-10-12) also becomes the time value.',
      }),
      issue: strProp({ maxLength: 60, description: 'Supplied issue label, e.g. "No. 282".' }),
      edition: strProp({ maxLength: 80 }),
      tagline: strProp({
        maxLength: 160,
        description: 'Small uppercase strapline under the name.',
      }),
      description: txt({ maxLength: 400, description: 'Edition blurb under the strapline.' }),
      sections: list(
        oneOf([
          strProp({ maxLength: 40 }),
          obj({
            label: strProp({ required: true, maxLength: 40 }),
            href: urlProp({ description: 'Link target; without one the label is plain text.' }),
          }),
        ]),
        { maxItems: 12, description: 'Section navigation: labels, or label with href.' },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['masthead'],
    a11y: 'The name is the page <h1>; the date is a <time>; sections are a labelled <nav> list of real links.',
  }),
  render: (node) => {
    const date = stringProp(node, 'date');
    const issue = stringProp(node, 'issue');
    const edition = stringProp(node, 'edition');
    const meta = [
      issue === '' ? '' : `<span>${escapeText(issue)}</span>`,
      date === '' ? '' : timeElement(date, 'ak-masthead-date'),
      edition === '' ? '' : `<span>${escapeText(edition)}</span>`,
    ].join('');
    const tagline = stringProp(node, 'tagline');
    const blurb = stringProp(node, 'description');
    const sections = Array.isArray(node.props.sections) ? node.props.sections : [];
    return element(
      'header',
      nodeAttributes(node, { class: 'ak-block ak-masthead' }),
      [
        meta === '' ? '' : `<p class="ak-masthead-meta">${meta}</p>`,
        `<h1 class="ak-masthead-name">${escapeText(stringProp(node, 'name'))}</h1>`,
        tagline === '' ? '' : `<p class="ak-masthead-tagline">${escapeText(tagline)}</p>`,
        blurb === '' ? '' : `<p class="ak-masthead-blurb">${escapeInlineText(blurb)}</p>`,
        sections.length === 0
          ? ''
          : `<nav class="ak-masthead-nav" aria-label="Sections"><ul>${sections.map(sectionItem).join('')}</ul></nav>`,
      ].join(''),
    );
  },
};
