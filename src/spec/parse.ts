/**
 * Input boundary.
 *
 * Everything entering the compiler arrives as an untrusted string or an
 * untrusted object. Parsing happens here and only here, with YAML alias
 * expansion bounded so a small document cannot expand into a large one.
 */

import { parse as parseYaml } from 'yaml';
import { RenderError } from '../errors.js';
import { isNumberedError } from '../internal/yaml-error.js';

export interface ParseOptions {
  /** Source label used in diagnostics (`--out` name, filename, or `<input>`). */
  source?: string;
  /** Force a parser instead of detecting from content. */
  format?: 'json' | 'yaml';
}

const MAX_ALIAS_COUNT = 100;

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * Parse a spec from a string or pass through an already-parsed object.
 *
 * JSON is detected by its first non-whitespace character; anything else is
 * parsed as YAML, which is a superset of JSON. Parse failures are reported as
 * `SPEC_PARSE_ERROR` with the source label and, for YAML, the offending line.
 */
export function parseSpec(input: unknown, options: ParseOptions = {}): unknown {
  if (typeof input !== 'string') return input;

  const source = options.source ?? '<input>';
  const format = options.format ?? (looksLikeJson(input) ? 'json' : 'yaml');

  if (format === 'json') {
    try {
      return JSON.parse(input) as unknown;
    } catch (error) {
      throw new RenderError('SPEC_PARSE_ERROR', `invalid JSON in ${source}: ${describe(error)}`, {
        path: '$',
        cause: error,
      });
    }
  }

  try {
    return parseYaml(input, {
      maxAliasCount: MAX_ALIAS_COUNT,
      uniqueKeys: true,
      logLevel: 'silent',
      prettyErrors: true,
    }) as unknown;
  } catch (error) {
    const detail = isNumberedError(error)
      ? `${describe(error)} (line ${error.linePos[0]?.line ?? '?'}, column ${error.linePos[0]?.col ?? '?'})`
      : describe(error);
    throw new RenderError('SPEC_PARSE_ERROR', `invalid YAML in ${source}: ${detail}`, {
      path: '$',
      cause: error,
    });
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
