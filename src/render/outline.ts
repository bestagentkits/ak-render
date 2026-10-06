/**
 * Page outline ("On this page").
 *
 * A long artifact gets a table of contents built from its top-level titled
 * sections. It is derived from the IR alone, so it is deterministic, and it
 * only appears once there is enough structure to navigate: below the threshold
 * an outline is noise.
 */

import type { IrDocument } from '../ir.js';
import { sectionAnchor } from './blocks.js';
import { escapeAttribute, escapeText } from './escape.js';

/** Fewest titled top-level sections that justify an outline. */
export const OUTLINE_MIN_SECTIONS = 3;

export interface OutlineEntry {
  anchor: string;
  title: string;
}

/** Always-visible titled sections that are direct children of the page root, in document order. */
export function outlineEntries(ir: IrDocument): OutlineEntry[] {
  const byId = new Map(ir.nodes.map((node) => [node.id, node]));
  const root = byId.get(ir.rootId);
  if (root === undefined) return [];
  const entries: OutlineEntry[] = [];
  for (const childId of root.children) {
    const child = byId.get(childId);
    if (child === undefined || child.type !== 'section') continue;
    // A section behind visibleWhen can be hidden, so a link to it could go nowhere.
    if (child.when !== undefined) continue;
    const title = child.props.title;
    if (typeof title !== 'string' || title.trim() === '') continue;
    entries.push({ anchor: sectionAnchor(child.id), title });
  }
  return entries;
}

export function hasOutline(ir: IrDocument): boolean {
  return outlineEntries(ir).length >= OUTLINE_MIN_SECTIONS;
}

/** The outline navigation landmark, or an empty string when the page is too short. */
export function renderOutline(ir: IrDocument): string {
  const entries = outlineEntries(ir);
  if (entries.length < OUTLINE_MIN_SECTIONS) return '';
  const items = entries
    .map(
      (entry) =>
        `<li><a href="#${escapeAttribute(entry.anchor)}" data-ak-outline-link>${escapeText(entry.title)}</a></li>`,
    )
    .join('');
  return `<nav class="ak-toc" aria-label="On this page"><p class="ak-toc-title">On this page</p><ol>${items}</ol></nav>`;
}
