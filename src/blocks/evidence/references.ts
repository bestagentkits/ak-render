/**
 * References: a numbered source list with a stable anchor per entry, so any
 * link on the page can point at `#ref-<id>`. Links are emitted as plain
 * anchors; the compiler never fetches them.
 */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { JsonValue } from '../../json.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import {
  anchorProps,
  idProp,
  itemsOf,
  LABEL,
  num,
  OPTIONAL_TITLE,
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
import { escapeAttribute, escapeInlineText, escapeText, escapeUrl } from '../../render/escape.js';

export const REFERENCE_LIMITS = { maxItems: 60 } as const;

/** The element id of a reference entry: the anchor other text links to. */
export function referenceAnchor(id: string): string {
  return `ref-${id}`;
}

function referenceIds(node: IrNode): string[] {
  return objectListProp(node, 'items').map((item) => str(item.id));
}

/**
 * Entry ids must be unique across every references block on the page, because
 * each becomes a document-level anchor. The first occurrence wins; each later
 * one is reported where it is written.
 */
function check(node: IrNode, { bag, byId }: CheckContext): void {
  const seen = new Map<string, string>();
  for (const other of byId.values()) {
    if (other === node) break;
    if (other.type !== 'references') continue;
    for (const id of referenceIds(other)) if (!seen.has(id)) seen.set(id, other.id);
  }
  referenceIds(node).forEach((id, index) => {
    if (id === '') return;
    const owner = seen.get(id);
    if (owner !== undefined) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(pathIndex(pathKey(node.path, 'items'), index), 'id'),
        nodeId: node.id,
        message: `reference id "${id}" is already used${owner === node.id ? ' in this list' : ` by block "${owner}"`}; anchors must be unique`,
        details: { id, anchor: referenceAnchor(id) },
      });
      return;
    }
    seen.set(id, node.id);
  });
}

function entry(item: Record<string, JsonValue>): string {
  const title = escapeText(str(item.title));
  const href = str(item.href);
  const heading =
    href === ''
      ? `<cite>${title}</cite>`
      : `<cite><a href="${escapeAttribute(escapeUrl(href))}" rel="noreferrer noopener">${title}</a></cite>`;
  const meta = [
    str(item.authors),
    str(item.source),
    typeof item.year === 'number' ? String(item.year) : '',
  ].filter((part) => part !== '');
  const note = str(item.note);
  return [
    `<li id="${escapeAttribute(referenceAnchor(str(item.id)))}" class="ak-ref">`,
    `<p class="ak-ref-title">${heading}</p>`,
    meta.length === 0 ? '' : `<p class="ak-ref-meta">${escapeText(meta.join(' · '))}</p>`,
    note === '' ? '' : `<p class="ak-ref-note">${escapeInlineText(note)}</p>`,
    '</li>',
  ].join('');
}

function render(node: IrNode): string {
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-refs' }),
    `${titleHeader(node)}<ol class="ak-ref-list">${objectListProp(node, 'items')
      .map(entry)
      .join('')}</ol>`,
  );
}

export const referencesBlock: BlockModule = {
  definition: semantic({
    type: 'references',
    category: 'content',
    tags: ['citations', 'sources', 'bibliography', 'evidence'],
    useCases: ['research report sources', 'benchmark evidence'],
    purpose: 'Numbered sources with stable anchors (#ref-<id>).',
    summary:
      'References: numbered citations with title, authors, source, year, link and note; anchor #ref-<id>.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf(
        {
          id: { ...idProp('Anchor id; the entry is reachable at #ref-<id>.'), required: true },
          title: LABEL,
          href: urlProp({ description: 'Link to the source; never fetched.' }),
          authors: strProp({ maxLength: 200 }),
          source: strProp({ maxLength: 200, description: 'Publisher, venue or site.' }),
          year: num({ integer: true, min: 1, max: 9999 }),
          note: txt({ maxLength: 600 }),
        },
        { maxItems: REFERENCE_LIMITS.maxItems },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['evidence'],
    a11y: 'An ordered list of <cite> titles; each entry has a stable id, so in-page links land on it.',
  }),
  render,
  check,
};
