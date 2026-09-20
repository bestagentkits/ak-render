/**
 * Diagnostics: how the compiler reports everything it found wrong.
 *
 * A diagnostic always carries a JSON path into the author-facing spec, and a
 * node ID when the failure belongs to a node that already has one. Callers
 * branch on `code`; `message` is for humans and may be reworded between
 * releases.
 */

import type { RenderErrorCode } from './errors.js';

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
}

export interface DiagnosticInput {
  code: RenderErrorCode;
  message: string;
  path: string;
  severity?: DiagnosticSeverity;
  nodeId?: string;
  details?: Record<string, unknown>;
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
