/**
 * Diagnostics: how the compiler reports everything it found wrong.
 *
 * A diagnostic always carries a JSON path into the author-facing spec, and a
 * node ID when the failure belongs to a node that already has one. Callers
 * branch on `code`; `message` is for humans and may be reworded between
 * releases.
 */

import type { RenderErrorCode } from './errors.js';
import type { JsonValue } from './json.js';

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  code: RenderErrorCode;
  severity: DiagnosticSeverity;
  message: string;
  /** JSON path in the author-facing spec, e.g. `blocks[2].items[0].url`. */
  path: string;
  /** Normalized node ID, when the diagnostic belongs to a node. */
  nodeId?: string;
  details?: Record<string, unknown>;
  /**
   * Suggested edits, present only when the caller asked for them
   * (`validate(spec, { suggest: true })`). Each entry is one alternative.
   */
  fixes?: DiagnosticFix[];
}

/** `safe`: provably keeps the author's meaning. `ambiguous`: a guess to confirm. */
export type FixClassification = 'safe' | 'ambiguous';

/** An RFC 6902 operation; `path` and `from` are JSON Pointers into the spec. */
export type PatchOperation =
  | { op: 'test'; path: string; value: JsonValue }
  | { op: 'replace'; path: string; value: JsonValue }
  | { op: 'move'; from: string; path: string };

/** One suggested edit: an RFC 6902 patch whose first operation is a `test` precondition. */
export interface DiagnosticFix {
  /** Stable rule id, e.g. `list/wrap-scalar`. */
  rule: string;
  classification: FixClassification;
  /** The diagnostic's spec path the patch edits. */
  path: string;
  patch: PatchOperation[];
}

/**
 * The edit a validation site knows would clear its diagnostic, before it is
 * anchored to the document as a patch: replace the value at the diagnostic
 * path, or rename the key at the diagnostic path.
 */
export type FixHint = { rule: string; classification: FixClassification } & (
  | { replaceWith: JsonValue }
  | { renameTo: string }
);

export interface DiagnosticInput {
  code: RenderErrorCode;
  message: string;
  path: string;
  severity?: DiagnosticSeverity;
  nodeId?: string;
  details?: Record<string, unknown>;
  /** Candidate edits; kept off the diagnostic until a caller asks for them. */
  fixes?: readonly FixHint[];
}

// Hints ride beside a diagnostic instead of on it, so default diagnostics stay
// byte-identical whether or not a site knows a fix.
const FIX_HINTS = new WeakMap<Diagnostic, readonly FixHint[]>();

/** The fix hints recorded for a diagnostic by the site that reported it. */
export function fixHintsOf(diagnostic: Diagnostic): readonly FixHint[] {
  return FIX_HINTS.get(diagnostic) ?? [];
}

/** Ordered, de-duplicating collector for diagnostics. */
export class DiagnosticBag {
  private readonly items: Diagnostic[] = [];
  private readonly seen = new Set<string>();

  add(input: DiagnosticInput): void {
    const key = `${input.code}|${input.path}|${input.message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const diagnostic: Diagnostic = {
      code: input.code,
      severity: input.severity ?? 'error',
      message: input.message,
      path: input.path,
    };
    if (input.nodeId !== undefined) diagnostic.nodeId = input.nodeId;
    if (input.details !== undefined) diagnostic.details = input.details;
    if (input.fixes !== undefined && input.fixes.length > 0) FIX_HINTS.set(diagnostic, input.fixes);
    this.items.push(diagnostic);
  }

  get size(): number {
    return this.items.length;
  }

  get errorCount(): number {
    return this.items.filter((item) => item.severity === 'error').length;
  }

  get hasErrors(): boolean {
    return this.errorCount > 0;
  }

  list(): Diagnostic[] {
    return [...this.items];
  }

  errors(): Diagnostic[] {
    return this.items.filter((item) => item.severity === 'error');
  }

  warnings(): Diagnostic[] {
    return this.items.filter((item) => item.severity === 'warning');
  }
}

/** Append an index or key to a JSON path. */
export function pathKey(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`;
}

/** Append an array index to a JSON path. */
export function pathIndex(base: string, index: number): string {
  return `${base}[${index}]`;
}

// Validation drops an invalid list item and compacts the list. Each compacted
// list remembers where its items sat in the authored one, so a later check
// reports the index the author wrote, not the compacted one.
const authoredLists = new WeakMap<
  readonly unknown[],
  { readonly indexes: readonly number[]; readonly length: number }
>();

/**
 * Record, for a list built from `source`, the authored index of each item it
 * kept. `source` is the authored list or an earlier compacted one.
 */
export function keepAuthoredIndexes(
  list: readonly unknown[],
  indexes: readonly number[],
  source: readonly unknown[],
): void {
  const length = authoredLists.get(source)?.length ?? source.length;
  if (indexes.length === length) return;
  authoredLists.set(list, { indexes, length });
}

/** True when validation dropped an item from this list, so its length is not the authored one. */
export function wasCompacted(list: unknown): boolean {
  return Array.isArray(list) && authoredLists.has(list);
}

/** The authored index of item `index` of a validated list. */
export function authoredIndex(list: unknown, index: number): number {
  return (Array.isArray(list) ? authoredLists.get(list)?.indexes[index] : undefined) ?? index;
}

/** Append the authored index of item `index` of a validated list to a JSON path. */
export function listItemPath(base: string, list: unknown, index: number): string {
  return pathIndex(base, authoredIndex(list, index));
}
