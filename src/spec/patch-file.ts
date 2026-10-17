/**
 * Patch a spec file in place, for the CLI and the local MCP server.
 *
 * The file stays canonical: the edit keeps its comments and layout
 * (`patchSpecText`), lands through a temporary file and a rename so an
 * interrupted write never leaves half a spec, and is refused when the file
 * changed between the read and the write. A patch that adds errors is not
 * written, so a broken edit never replaces a working page; a patch that fixes
 * some of a broken spec's errors is.
 */

import { readFileSync } from 'node:fs';
import { replaceFile } from '../internal/replace-file.js';
import type { PatchOptions } from './patch.js';
import { type PatchTextResult, patchSpecText } from './patch-text.js';

export interface PatchFileOptions extends PatchOptions {
  /** Report what the patch would do without writing. */
  dryRun?: boolean;
}

export interface PatchFileResult extends Omit<PatchTextResult, 'spec' | 'text'> {
  written: boolean;
}

const SPEC_FILE = /\.(?:ya?ml|json)$/iu;

export function patchSpecFile(
  file: string,
  ops: unknown,
  options: PatchFileOptions = {},
): PatchFileResult {
  if (!SPEC_FILE.test(file)) throw new TypeError('the spec file must end in .yaml, .yml or .json');
  const before = readFileSync(file, 'utf8');
  const { dryRun = false, ...patchOptions } = options;
  const {
    spec: _spec,
    text,
    ...result
  } = patchSpecText(before, ops, {
    source: file,
    ...patchOptions,
  });
  const write =
    !dryRun && result.applied && result.changes.length > 0 && result.errors <= result.baseErrors;
  if (!write) return { ...result, written: false };

  const changed = new Error('changed');
  try {
    replaceFile(file, text, String(process.pid), () => {
      if (readFileSync(file, 'utf8') !== before) throw changed;
    });
  } catch (error) {
    if (error !== changed) throw error;
    return {
      ...result,
      ok: false,
      written: false,
      diagnostics: [
        {
          code: 'SPEC_PATCH_CONFLICT',
          severity: 'error',
          message: `${file} changed while it was being patched; patch again`,
          path: '$',
        },
        ...result.diagnostics,
      ],
    };
  }
  return { ...result, written: true };
}
