/**
 * `validate()` — report everything wrong with a spec without normalizing or
 * rendering it. Used by the CLI and by skills that want a pre-flight check.
 */

import type { Diagnostic } from '../diagnostics.js';
import { isRenderError, RenderError } from '../errors.js';
import { normalizeSpec } from './normalize.js';
import { type ParseOptions, parseSpec } from './parse.js';

export interface ValidateSummary {
  title: string;
  themePreset: string;
  blocks: number;
  nodes: number;
  depth: number;
  bytes: number;
}

export interface ValidateResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  summary: ValidateSummary;
}

/**
 * Validate a spec given as a string (JSON or YAML) or an already-parsed object.
 * Never throws for spec problems; a thrown error is reserved for programmer
 * error.
 */
export function validate(input: unknown, options: ParseOptions = {}): ValidateResult {
  let document: unknown = input;
  try {
    document = parseSpec(input, options);
  } catch (error) {
    const diagnostics: Diagnostic[] = [];
    if (isRenderError(error)) {
      diagnostics.push({
        code: error.code,
        severity: 'error',
        message: error.message,
        path: error.path ?? '$',
      });
    } else {
      throw error;
    }
    return {
      ok: false,
      diagnostics,
      summary: emptySummary(),
    };
  }

  const result = normalizeSpec(document);
  const errors = result.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  return {
    ok: !errors,
    diagnostics: result.diagnostics,
    summary: {
      title: result.ir.meta.title,
      themePreset: result.ir.theme.preset,
      blocks: Math.max(result.ir.nodes.length - 1, 0),
      nodes: result.ir.nodes.length,
      depth: result.bounds.depth,
      bytes: result.bounds.bytes,
    },
  };
}

/** Validate or throw the first error, for callers that want exception flow. */
export function validateOrThrow(input: unknown, options: ParseOptions = {}): ValidateResult {
  const result = validate(input, options);
  const first = result.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (first !== undefined) {
    throw new RenderError(first.code, first.message, {
      path: first.path,
      ...(first.nodeId === undefined ? {} : { nodeId: first.nodeId }),
      details: { diagnostics: result.diagnostics },
    });
  }
  return result;
}

function emptySummary(): ValidateSummary {
  return { title: '', themePreset: '', blocks: 0, nodes: 0, depth: 0, bytes: 0 };
}
