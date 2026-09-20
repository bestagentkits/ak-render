/**
 * Stable error surface for the compiler.
 *
 * Every failure an author can trigger is reported as a `RenderError` with a
 * machine-readable `code` and, where the failure belongs to a spec location,
 * a JSON path and normalized node ID. Callers (CLI, worker, skills) branch on
 * `code`; they must not parse message text.
 */

export type RenderErrorCode =
  | 'SPEC_PARSE_ERROR'
  | 'SPEC_VALIDATION_ERROR'
  | 'SPEC_BOUNDS_ERROR'
  | 'SPEC_UNKNOWN_BLOCK'
  | 'POLICY_VIOLATION'
  | 'INTERNAL_ERROR';

export interface RenderErrorOptions {
  /** JSON path of the offending value, e.g. `blocks[2].items[0].url`. */
  path?: string | undefined;
  /** Normalized node ID when the failure is attached to a node. */
  nodeId?: string | undefined;
  /** Non-sensitive structured detail for logs and JSON output. */
  details?: Record<string, unknown> | undefined;
  cause?: unknown;
}

export class RenderError extends Error {
  readonly code: RenderErrorCode;
  readonly path: string | undefined;
  readonly nodeId: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: RenderErrorCode, message: string, options: RenderErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RenderError';
    this.code = code;
    this.path = options.path;
    this.nodeId = options.nodeId;
    this.details = options.details;
  }

  /** JSON-safe representation used by `--json` CLI output and the cloud API. */
  toJSON(): {
    name: string;
    code: RenderErrorCode;
    message: string;
    path?: string;
    nodeId?: string;
    details?: Record<string, unknown>;
  } {
    const payload: ReturnType<RenderError['toJSON']> = {
      name: this.name,
      code: this.code,
      message: this.message,
    };
    if (this.path !== undefined) payload.path = this.path;
    if (this.nodeId !== undefined) payload.nodeId = this.nodeId;
    if (this.details !== undefined) payload.details = this.details;
    return payload;
  }
}

/** Narrow an unknown thrown value to a `RenderError`. */
export function isRenderError(value: unknown): value is RenderError {
  return value instanceof RenderError;
}
