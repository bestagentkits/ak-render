/**
 * Internal IR.
 *
 * The IR is what the renderer consumes and what future diff/patch/editor
 * tooling will operate on. It is compiler-versioned, not a public schema:
 * the Page Spec is the compatibility boundary, and the IR may change without a
 * spec migration.
 */

import type { DataRow, MaterializedData } from './data/dataset-types.js';
import type { Diagnostic } from './diagnostics.js';
import type { JsonValue } from './json.js';
import type { RuntimeFeature } from './registry/roster.js';
import type { BindingMap } from './spec/bindings.js';
import type { Condition } from './spec/conditions.js';

export interface IrNode {
  /** Stable node ID: author-provided when present, otherwise content-derived. */
  id: string;
  type: string;
  typeVersion: number;
  kind: 'semantic' | 'primitive';
  /** JSON path of this block in the author-facing spec. */
  path: string;
  parentId: string | null;
  depth: number;
  /** Validated props with defaults applied, verbatim from the spec otherwise. */
  props: Record<string, JsonValue>;
  /** Normalized declarative action bindings, keyed by event. */
  bindings: BindingMap;
  /** Child node IDs, in authored order. */
  children: string[];
  /**
   * Nested slot lists, keyed by `slotKey()` (`aside`, `items[1].blocks`). Set
   * only when non-empty, so a node without nested blocks has no `slots` key.
   * `children` and `slots` never share a node.
   */
  slots?: Record<string, string[]>;
  /** `visibleWhen`: the block shows only while this state condition holds. */
  when?: Condition;
  /** Rows the block resolved from `dataRef` or `data`, after its transform. */
  data?: MaterializedData;
  /** Accessibility contract inherited from the block definition. */
  a11y: string;
  runtimeFeatures: RuntimeFeature[];
  assets: string[];
  network: 'none' | 'optional';
}

/**
 * `deny` is the default. An allow list opts into named capabilities, and an
 * optional provider list narrows remote media to that provider's own hosts.
 */
export type NetworkPolicy = 'deny' | { allow: string[]; providers?: string[] };

export interface IrMeta {
  title: string;
  description?: string;
  locale: string;
  slug?: string;
}

export interface IrTheme {
  preset: string;
  extends?: string;
  tokens?: JsonValue;
  /** Dark-scheme token overrides, resolved by the theme loader. */
  dark?: JsonValue;
  /** Presentation recipe per surface, e.g. `{ cards: 'flat' }`. */
  recipes?: Record<string, string>;
}

export interface IrDocument {
  /** Version of the IR shape itself. */
  irVersion: 1;
  /** Page Spec schema version the document was normalized from. */
  specVersion: number;
  /** Compiler version that produced this IR. */
  compilerVersion: string;
  meta: IrMeta;
  theme: IrTheme;
  policy: { network: NetworkPolicy };
  state: Record<string, JsonValue>;
  /** Named datasets declared in the spec envelope. */
  datasets: Record<string, DataRow[]>;
  rootId: string;
  /** All nodes in deterministic depth-first pre-order, root first. */
  nodes: IrNode[];
  /** Non-fatal diagnostics (deprecations, skipped heading levels, and similar). */
  warnings: Diagnostic[];
}

/** Index nodes by ID for O(1) lookup by the renderer. */
export function indexNodes(ir: IrDocument): Map<string, IrNode> {
  return new Map(ir.nodes.map((node) => [node.id, node]));
}

/** Direct children of a node, in authored order. */
export function childrenOf(ir: IrDocument, node: IrNode): IrNode[] {
  const byId = indexNodes(ir);
  return node.children
    .map((id) => byId.get(id))
    .filter((child): child is IrNode => child !== undefined);
}
