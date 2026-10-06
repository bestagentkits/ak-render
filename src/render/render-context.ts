/**
 * The context every renderer receives.
 *
 * Renderers are pure functions of a node and this context: no clock, no
 * randomness, no module-level mutable state.
 */

import type { Diagnostic } from '../diagnostics.js';
import type { DiagramAdapter } from '../diagram/adapter.js';
import type { IrDocument, IrNode } from '../ir.js';
import type { BlockRegistry } from '../registry/block-module.js';
import type { RuntimeFeature } from '../registry/roster.js';
import type { ResolvedTheme } from '../theme/load-theme.js';

export interface RenderContext {
  ir: IrDocument;
  theme: ResolvedTheme;
  features: Set<RuntimeFeature>;
  /** Block modules and features for this compile. */
  registry: BlockRegistry;
  /**
   * Optional diagram adapter. Without one, every diagram-panel emits the
   * structured semantic fallback, which is the Core and Marketing behavior.
   */
  diagramAdapter?: DiagramAdapter;
  /** Diagnostics raised while rendering, such as a rejected adapter output. */
  warnings?: Diagnostic[];
  renderChildren(node: IrNode): string;
  /**
   * Renders the child blocks of one nested slot (`IrNode.slots[key]`); '' when
   * the slot is absent. Children are wrapped for `visibleWhen` exactly like
   * `renderChildren`.
   */
  renderSlot(node: IrNode, key: string): string;
  byId(id: string): IrNode | undefined;
}

/**
 * The IR key of a nested slot: `prop` for a top-level `blocks` prop, or
 * `prop[index].field` for a `blocks` field inside a list item.
 */
export function slotKey(prop: string, index?: number, field?: string): string {
  if (index === undefined) return prop;
  return field === undefined ? `${prop}[${index}]` : `${prop}[${index}].${field}`;
}
