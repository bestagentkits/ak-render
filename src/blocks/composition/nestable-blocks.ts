/**
 * Nested content for the composition blocks: a tab panel, an accordion
 * section, a carousel slide or a bento tile may hold typed child blocks in
 * `items[i].blocks`.
 *
 * Every block type may nest except the page-level ones listed in
 * `NOT_NESTABLE`. The slot itself accepts any type and the exclusion is checked
 * here, so a block another group registers later is nestable without a list to
 * keep in sync, and `describe` stays small (no long `accepts` enumeration).
 */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject } from '../../json.js';
import type { CheckContext } from '../../registry/block-module.js';
import { blocks } from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';
import { escapeInlineText } from '../../render/escape.js';
import { type RenderContext, slotKey } from '../../render/render-context.js';

/** Page-level blocks that never sit inside an item: they own landmarks and the page heading. */
export const NOT_NESTABLE: readonly string[] = ['page', 'section', 'hero'];

/** The `blocks` field of a composition item whose other content lives in `contentField`. */
export function nestedBlocks(contentField: string, maxItems: number): PropSchema {
  return blocks({
    maxItems,
    description: `Child blocks inside the item; it needs ${contentField} or blocks. Not ${NOT_NESTABLE.join('/')}.`,
  });
}

/** The IR node ids nested in item `index`; empty when the item has no blocks. */
export function itemSlot(node: IrNode, index: number): readonly string[] {
  return node.slots?.[slotKey('items', index, 'blocks')] ?? [];
}

/** Item `index`'s nested blocks in a wrapper that keeps wide children inside its column; '' without blocks. */
export function renderItemBlocks(node: IrNode, index: number, context: RenderContext): string {
  if (itemSlot(node, index).length === 0) return '';
  return `<div class="ak-nested">${context.renderSlot(node, slotKey('items', index, 'blocks'))}</div>`;
}

/**
 * The body of item `index`. A text-only item renders exactly as it did before
 * items could nest blocks: its text bare, or in one paragraph when
 * `paragraph` is set, even when empty. An item with blocks shows its text as a
 * paragraph only when present, then the blocks in a wrapper that spaces them
 * from the text and keeps wide children inside the item's column.
 */
export function renderItemBody(
  node: IrNode,
  index: number,
  context: RenderContext,
  text: string,
  paragraph: boolean,
): string {
  const escaped = escapeInlineText(text);
  if (itemSlot(node, index).length === 0) return paragraph ? `<p>${escaped}</p>` : escaped;
  return `${text === '' ? '' : `<p>${escaped}</p>`}${renderItemBlocks(node, index, context)}`;
}

/**
 * Report a nested block whose type may not sit inside an item, at the child's
 * `.type` path, the same place a slot's `accepts` rule reports.
 */
function checkNestedTypes(node: IrNode, index: number, context: CheckContext): void {
  for (const id of itemSlot(node, index)) {
    const child = context.byId.get(id);
    if (child === undefined || !NOT_NESTABLE.includes(child.type)) continue;
    context.bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(child.path, 'type'),
      nodeId: child.id,
      message: `"${node.type}" items cannot hold a "${child.type}" block`,
      details: { type: child.type, excluded: [...NOT_NESTABLE] },
    });
  }
}

/**
 * Every item needs content: `contentField` (text, or a bento tile's title) or
 * nested blocks. Without either the item would render empty, so it is
 * reported at the item's path. Nested types are checked as well.
 */
export function checkItemContent(
  node: IrNode,
  context: CheckContext,
  contentField: string,
  message: string,
): void {
  const items = node.props.items;
  if (!Array.isArray(items)) return;
  items.forEach((item, index) => {
    checkNestedTypes(node, index, context);
    if (!isPlainObject(item)) return;
    // Presence, not emptiness: an explicit empty text stays valid, as it was
    // when the field was required.
    if (typeof item[contentField] === 'string' || itemSlot(node, index).length > 0) return;
    context.bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathIndex(pathKey(node.path, 'items'), index),
      nodeId: node.id,
      message,
      details: { required: [contentField, 'blocks'] },
    });
  });
}
