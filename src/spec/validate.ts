/**
 * `validate()` — report everything wrong with a spec without normalizing or
 * rendering it. Used by the CLI and by skills that want a pre-flight check.
 */

import { type Diagnostic, type DiagnosticFix, type FixHint, fixHintsOf } from '../diagnostics.js';
import { isRenderError, RenderError } from '../errors.js';
import { isJsonValue } from '../json.js';
import { documentSegments, toPointer, valueAt } from './json-patch.js';
import { normalizeSpec } from './normalize.js';
import { type ParseOptions, parseSpec } from './parse.js';

export interface ValidateOptions extends ParseOptions {
  /**
   * Attach `fixes` to diagnostics: RFC 6902 patches with a `test`
   * precondition, a rule id and a `safe` or `ambiguous` classification.
   * Without it, diagnostics are exactly what they always were.
   */
  suggest?: boolean;
}

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
export function validate(input: unknown, options: ValidateOptions = {}): ValidateResult {
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
    diagnostics:
      options.suggest === true ? withFixes(result.diagnostics, document) : result.diagnostics,
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

/** Copies of the diagnostics with their hints anchored to the document as patches. */
function withFixes(diagnostics: readonly Diagnostic[], document: unknown): Diagnostic[] {
  return diagnostics.map((diagnostic) => {
    const fixes = fixHintsOf(diagnostic)
      .map((hint) => anchorFix(hint, diagnostic.path, document))
      .filter((fix): fix is DiagnosticFix => fix !== undefined);
    return fixes.length === 0 ? diagnostic : { ...diagnostic, fixes };
  });
}

/**
 * Turn a hint into a patch against the document as written. The `test`
 * operation pins the current value, so the patch refuses to apply to a spec
 * that has changed since. A hint whose path does not resolve is dropped
 * rather than guessed.
 */
function anchorFix(hint: FixHint, path: string, document: unknown): DiagnosticFix | undefined {
  const segments = documentSegments(path, document);
  if (segments === undefined || segments.length === 0) return undefined;
  const current = valueAt(document, segments);
  if (current === undefined || !isJsonValue(current)) return undefined;
  const pointer = toPointer(segments);
  const base = { rule: hint.rule, classification: hint.classification, path };
  if ('replaceWith' in hint) {
    return {
      ...base,
      patch: [
        { op: 'test', path: pointer, value: current },
        { op: 'replace', path: pointer, value: hint.replaceWith },
      ],
    };
  }
  const parentSegments = segments.slice(0, -1);
  const parent = valueAt(document, parentSegments);
  if (typeof parent !== 'object' || parent === null || Array.isArray(parent)) return undefined;
  if (Object.hasOwn(parent, hint.renameTo)) return undefined;
  return {
    ...base,
    patch: [
      { op: 'test', path: pointer, value: current },
      { op: 'move', from: pointer, path: toPointer([...parentSegments, hint.renameTo]) },
    ],
  };
}

function emptySummary(): ValidateSummary {
  return { title: '', themePreset: '', blocks: 0, nodes: 0, depth: 0, bytes: 0 };
}
