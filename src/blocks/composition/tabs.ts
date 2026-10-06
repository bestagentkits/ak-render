/** Tabs block: tabbed groups of related content. */

import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  idProp,
  itemsOf,
  LABEL,
  OPTIONAL_TITLE,
  onProp,
  txt,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  stringProp,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeAttribute, escapeInlineText, escapeText } from '../../render/escape.js';

export const tabsBlock: BlockModule = {
  definition: define({
    type: 'tabs',
    category: 'interaction',
    tags: ['tabbed', 'panels'],
    useCases: ['alternate views', 'grouped content'],
    purpose: 'Tabbed groups of related content.',
    summary: 'Tabs: roving-tabindex tablist with tabpanels.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf(
        { id: idProp('Tab id.'), title: LABEL, text: txt({ required: true }) },
        { minItems: 2 },
      ),
      on: onProp('Optional state binding fired when a tab is selected.'),
      ...anchorProps,
    },
    runtimeFeatures: ['tabs'],
    actions: ['select-tab'],
    a11y: 'role="tablist" with arrow-key roving focus, aria-selected, aria-controls, and labelled tabpanels.',
  }),
  render: (node) => {
    const items = objectListProp(node, 'items');
    const base = node.id;
    const tabs = items
      .map((item, index) => {
        const tabId = str(item.id, `${base}-tab-${index}`);
        return `<button type="button" role="tab" id="${escapeAttribute(
          tabId,
        )}" data-ak-tab-id="${escapeAttribute(tabId)}" aria-controls="${escapeAttribute(
          `${base}-panel-${index}`,
        )}" aria-selected="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}">${escapeText(
          str(item.title),
        )}</button>`;
      })
      .join('');
    const panels = items
      .map(
        (item, index) =>
          `<div role="tabpanel" id="${escapeAttribute(`${base}-panel-${index}`)}" aria-labelledby="${escapeAttribute(
            str(item.id, `${base}-tab-${index}`),
          )}" tabindex="${index === 0 ? '0' : '-1'}"><p class="ak-tab-panel-title">${escapeText(
            str(item.title),
          )}</p>${escapeInlineText(str(item.text))}</div>`,
      )
      .join('');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block ak-tabs', 'data-ak-tabs': 'true' }),
      [
        titleHeader(node),
        `<div role="tablist" aria-label="${escapeAttribute(stringProp(node, 'title', 'Tabs'))}">${tabs}</div>${panels}`,
      ].join(''),
    );
  },
};
