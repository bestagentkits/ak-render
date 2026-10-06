/**
 * Block modules: the unit a block group contributes to the registry.
 *
 * A module pairs a block definition with its renderer and its cross-field
 * checks, so one file owns everything one block type needs. A feature module
 * is the CSS, and optionally the runtime script, that a block declares through
 * `runtimeFeatures`; the compiler emits it only when a page uses the feature.
 */

import type { DataRow } from '../data/dataset-types.js';
import type { DiagnosticBag } from '../diagnostics.js';
import type { IrNode } from '../ir.js';
import type { JsonValue } from '../json.js';
import type { RenderContext } from '../render/render-context.js';
import type { BlockDefinition } from './roster.js';

/** Catalog grouping for discovery. Every block has exactly one category. */
export type BlockCategory =
  | 'layout'
  | 'content'
  | 'data'
  | 'interaction'
  | 'media'
  | 'showcase'
  | 'engineering'
  | 'product';

export const BLOCK_CATEGORIES: readonly BlockCategory[] = [
  'layout',
  'content',
  'data',
  'interaction',
  'media',
  'showcase',
  'engineering',
  'product',
];

/** What a module's `check` sees: the whole normalized document, read-only. */
export interface CheckContext {
  bag: DiagnosticBag;
  byId: ReadonlyMap<string, IrNode>;
  state: Record<string, JsonValue>;
  datasets: Record<string, DataRow[]>;
}

export interface BlockModule {
  definition: BlockDefinition;
  render(node: IrNode, context: RenderContext): string;
  /** Cross-field checks; runs after normalization, in IR order. */
  check?(node: IrNode, context: CheckContext): void;
}

export interface FeatureModule {
  /** Kebab-case, unique across core and module features. */
  name: string;
  /** A substring that must appear in the emitted CSS exactly when the feature is used. */
  marker: string;
  /**
   * Token-driven CSS, emitted only when the feature is used. Animations sit
   * behind `(prefers-reduced-motion:no-preference)`.
   */
  css: string;
  /** ES5-style runtime code, like `runtime.ts`, and the call that wires it, e.g. `wireTables();`. */
  script?: { code: string; boot?: string };
  /** True when the feature announces changes and so needs the live region. */
  announces?: boolean;
}

export interface BlockGroup {
  name: string;
  blocks: readonly BlockModule[];
  features: readonly FeatureModule[];
}

/** The resolved set of blocks and features one compile uses. */
export interface BlockRegistry {
  /** Core definitions first, then each group's blocks in group order. */
  definitions: readonly BlockDefinition[];
  byType: ReadonlyMap<string, BlockDefinition>;
  /** Modules by block type; a type without a module uses a core renderer. */
  modules: ReadonlyMap<string, BlockModule>;
  /** Module features in group order. */
  features: readonly FeatureModule[];
}
