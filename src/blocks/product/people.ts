/** People block: a team or speaker roster with avatars, roles, short bios and links. */

import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  itemsOf,
  LABEL,
  list,
  OPTIONAL_TITLE,
  obj,
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
import { authoredLink, avatar } from './product-helpers.js';

export const peopleBlock: BlockModule = {
  definition: semantic({
    type: 'people',
    category: 'product',
    tags: ['team', 'profiles', 'people', 'speakers'],
    useCases: ['team page', 'speaker list', 'contact roster'],
    purpose: 'People profiles.',
    summary: 'People: up to 24 profiles with avatar, role, short bio and links.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf(
        {
          name: LABEL,
          role: strProp({ maxLength: 120 }),
          avatar: urlProp({
            asset: 'images',
            description: 'Falls back to initials when absent or blocked.',
          }),
          bio: txt({ maxLength: 280 }),
          links: list(obj({ label: LABEL, href: urlProp({ required: true }) }), {
            maxItems: 3,
          }),
        },
        { minItems: 1, maxItems: 24 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['people'],
    network: 'optional',
    assets: ['media'],
    a11y: 'Each person is a list item headed by their name; the avatar is decorative because the name is text.',
  }),
  render: (node, context) => {
    const policy = context.ir.policy.network;
    const people = objectListProp(node, 'items').map((person) => {
      const name = str(person.name);
      const role = str(person.role);
      const bio = str(person.bio);
      const links = Array.isArray(person.links)
        ? person.links.filter(
            (link): link is Record<string, string> =>
              link !== null && typeof link === 'object' && !Array.isArray(link),
          )
        : [];
      return `<li class="ak-person">${avatar(str(person.avatar), name, policy)}<h3>${escapeText(
        name,
      )}</h3>${role === '' ? '' : `<p class="ak-person-role">${escapeText(role)}</p>`}${
        bio === '' ? '' : `<p class="ak-person-bio">${escapeInlineText(bio)}</p>`
      }${
        links.length === 0
          ? ''
          : `<ul class="ak-person-links">${links
              .map(
                (link) => `<li>${authoredLink(str(link.href), escapeText(str(link.label)))}</li>`,
              )
              .join('')}</ul>`
      }</li>`;
    });
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      `${titleHeader(node)}<ul class="ak-people">${people.join('')}</ul>`,
    );
  },
};
