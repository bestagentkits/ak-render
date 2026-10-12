/** Digest list: short dated items for a rail, such as diary dates or briefs. */

import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  itemsOf,
  LABEL,
  OPTIONAL_TITLE,
  semantic,
  str as strProp,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, objectListProp, str } from '../../render/block-helpers.js';
import { escapeAttribute, escapeInlineText, escapeText } from '../../render/escape.js';
import { anchor, timeElement } from './editorial-helpers.js';

export const digestListBlock: BlockModule = {
  definition: semantic({
    type: 'digest-list',
    category: 'content',
    tags: ['briefs', 'diary', 'rail', 'newspaper'],
    useCases: ['dates for the diary', 'short briefs'],
    purpose: 'Short dated items separated by rules, for the rail of an editorial page.',
    summary: 'Digest list: optional `title`, `items` of `{date, title, text, href}`.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf(
        {
          date: strProp({ maxLength: 40, description: 'Supplied date text.' }),
          title: LABEL,
          text: txt({ maxLength: 300 }),
          href: urlProp(),
        },
        { minItems: 1, maxItems: 30 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['story'],
    a11y: 'A titled <section> holding a list; each date is a <time>.',
  }),
  render: (node) => {
    const title = str(node.props.title);
    const titleId = `${node.id}-title`;
    const items = objectListProp(node, 'items')
      .map((item) => {
        const date = str(item.date);
        const href = str(item.href);
        const label = escapeText(str(item.title));
        const text = str(item.text);
        return `<li class="ak-digest-item">${date === '' ? '' : timeElement(date, 'ak-digest-date')}<span class="ak-digest-title-line">${
          href === '' ? label : anchor(href, label)
        }</span>${text === '' ? '' : `<span class="ak-digest-text">${escapeInlineText(text)}</span>`}</li>`;
      })
      .join('');
    return element(
      'section',
      nodeAttributes(node, {
        class: 'ak-block ak-digest',
        'aria-labelledby': title === '' ? undefined : titleId,
      }),
      `${title === '' ? '' : `<h2 class="ak-digest-title" id="${escapeAttribute(titleId)}">${escapeText(title)}</h2>`}<ul class="ak-digest-list">${items}</ul>`,
    );
  },
};
