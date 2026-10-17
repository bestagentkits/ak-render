/**
 * Fix hints a validation site attaches to its diagnostic.
 *
 * A hint names the edit that would clear the diagnostic. Only an edit that
 * provably keeps the author's meaning is `safe`; a guess between near names is
 * always `ambiguous`, even when there is a single candidate, because a typo's
 * intended target is the author's call.
 */

import type { FixHint } from '../diagnostics.js';
import { suggestNames } from '../icons/icon-catalog.js';
import { isPlainObject, type JsonValue } from '../json.js';

/** Alternatives offered for one near-miss name. */
const NEAR_NAME_LIMIT = 3;

/** Near names for a misspelled value, best first. */
function nearNames(value: string, candidates: readonly string[]): string[] {
  if (value === '') return [];
  return suggestNames(value, candidates, NEAR_NAME_LIMIT);
}

/**
 * Hints for a string that is not one of `allowed`. A value that differs from
 * exactly one allowed value only by letter case is a safe fix; anything else
 * is a ranked list of guesses.
 */
export function enumFixHints(value: unknown, allowed: readonly string[], rule: string): FixHint[] {
  if (typeof value !== 'string') return [];
  const folded = value.toLowerCase();
  const sameLetters = allowed.filter((candidate) => candidate.toLowerCase() === folded);
  const only = sameLetters[0];
  if (sameLetters.length === 1 && only !== undefined) {
    return [{ rule: `${rule}/case`, classification: 'safe', replaceWith: only }];
  }
  return nameFixHints(value, allowed, `${rule}/closest`);
}

/** Ranked guesses for a misspelled name, such as a block or action type. */
export function nameFixHints(
  value: unknown,
  candidates: readonly string[],
  rule: string,
): FixHint[] {
  if (typeof value !== 'string') return [];
  return nearNames(value.toLowerCase(), candidates).map((candidate) => ({
    rule,
    classification: 'ambiguous',
    replaceWith: candidate,
  }));
}

/**
 * Hints for an unknown key: rename it to a near allowed key the object does
 * not already have. Never safe, and never a deletion.
 */
export function renameFixHints(
  key: string,
  allowed: readonly string[],
  present: readonly string[],
): FixHint[] {
  const free = allowed.filter((candidate) => !present.includes(candidate));
  return nearNames(key, free).map((candidate) => ({
    rule: 'property/rename',
    classification: 'ambiguous',
    renameTo: candidate,
  }));
}

/**
 * One block written where a list of blocks is required keeps its meaning as a
 * one-item list, when the list may hold exactly one block. The block itself is
 * validated as usual once it is wrapped.
 */
export function wrapBlockFixHints(value: unknown, minItems: number, maxItems: number): FixHint[] {
  if (!isPlainObject(value) || typeof value.type !== 'string') return [];
  if (minItems > 1 || maxItems < 1) return [];
  return [{ rule: 'blocks/wrap-block', classification: 'safe', replaceWith: [value as JsonValue] }];
}
