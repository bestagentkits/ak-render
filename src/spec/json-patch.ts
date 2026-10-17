/**
 * The small RFC 6902 subset suggested fixes use (`test`, `replace`, `move`),
 * plus the bridge from diagnostic paths (`$.blocks[2].items[0]`) to JSON
 * Pointers (`/blocks/2/items/0`).
 *
 * A patch is applied to a copy and either succeeds as a whole or is refused,
 * so a failed precondition never leaves a half-edited spec.
 */

import type { PatchOperation } from '../diagnostics.js';
import { pathIndex, pathKey } from '../diagnostics.js';
import { isPlainObject, type JsonValue } from '../json.js';

type Segment = string | number;

const PATH_TOKEN = /\.([^.[\]]+)|\[(\d+)\]/gy;

/**
 * Split a diagnostic path into segments. Undefined when the path does not
 * round-trip, for instance a key that itself contains a dot or a bracket:
 * such a path cannot name one location, so no patch may target it.
 */
export function pathSegments(path: string): Segment[] | undefined {
  if (!path.startsWith('$')) return undefined;
  const segments: Segment[] = [];
  PATH_TOKEN.lastIndex = 1;
  let rebuilt = '$';
  while (PATH_TOKEN.lastIndex < path.length) {
    const start = PATH_TOKEN.lastIndex;
    const match = PATH_TOKEN.exec(path);
    if (match === null || match.index !== start) return undefined;
    if (match[1] !== undefined) {
      segments.push(match[1]);
      rebuilt = pathKey(rebuilt, match[1]);
    } else {
      const index = Number(match[2]);
      segments.push(index);
      rebuilt = pathIndex(rebuilt, index);
    }
  }
  return rebuilt === path ? segments : undefined;
}

/**
 * Map a diagnostic path onto the document as written. A pre-versioning spec
 * that is a bare block array is reported under `$.blocks`, so that prefix maps
 * back onto the array itself.
 */
export function documentSegments(path: string, document: unknown): Segment[] | undefined {
  const segments = pathSegments(path);
  if (segments === undefined) return undefined;
  if (Array.isArray(document)) {
    if (segments[0] !== 'blocks') return undefined;
    return segments.slice(1);
  }
  return segments;
}

function escapeToken(token: Segment): string {
  return String(token).replace(/~/gu, '~0').replace(/\//gu, '~1');
}

export function toPointer(segments: readonly Segment[]): string {
  return segments.map((segment) => `/${escapeToken(segment)}`).join('');
}

function parsePointer(pointer: string): string[] | undefined {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) return undefined;
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

/** The value a segment list names, or undefined when it does not exist. */
export function valueAt(document: unknown, segments: readonly Segment[]): unknown {
  let current: unknown = document;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = typeof segment === 'number' ? segment : arrayIndex(segment);
      if (index === undefined || index >= current.length) return undefined;
      current = current[index];
    } else if (isPlainObject(current) && Object.hasOwn(current, String(segment))) {
      current = current[String(segment)];
    } else {
      return undefined;
    }
  }
  return current;
}

function arrayIndex(token: string): number | undefined {
  return /^(?:0|[1-9]\d*)$/u.test(token) ? Number(token) : undefined;
}

/** Structural JSON equality, as the RFC 6902 `test` operation defines it. */
export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonEqual(item, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]))
    );
  }
  return false;
}

interface Location {
  parent: unknown[] | Record<string, unknown>;
  key: string | number;
}

function locate(document: unknown, pointer: string): Location | undefined {
  const tokens = parsePointer(pointer);
  if (tokens === undefined || tokens.length === 0) return undefined;
  const parent = valueAt(document, tokens.slice(0, -1));
  const last = tokens[tokens.length - 1] as string;
  if (Array.isArray(parent)) {
    const index = arrayIndex(last);
    return index === undefined ? undefined : { parent, key: index };
  }
  return isPlainObject(parent) ? { parent, key: last } : undefined;
}

function exists(location: Location): boolean {
  return Array.isArray(location.parent)
    ? (location.key as number) < location.parent.length
    : Object.hasOwn(location.parent, location.key);
}

/**
 * Apply a patch to a deep copy of `document`. Returns the patched copy, or
 * undefined when any operation fails, including a `test` precondition. A
 * `move` never overwrites an existing member, so applying a patch cannot drop
 * a value the author wrote.
 */
export function applyPatch(
  document: JsonValue,
  patch: readonly PatchOperation[],
): JsonValue | undefined {
  const copy = structuredClone(document);
  return patchInPlace(copy, patch) ? copy : undefined;
}

/**
 * Apply a patch to `document` itself. On false the document may be partly
 * edited, so only call this on a copy the caller discards on failure.
 */
export function patchInPlace(document: JsonValue, patch: readonly PatchOperation[]): boolean {
  const copy = document;
  for (const operation of patch) {
    if (operation.op === 'test') {
      const tokens = parsePointer(operation.path);
      if (tokens === undefined) return false;
      const actual = valueAt(copy, tokens);
      if (actual === undefined || !jsonEqual(actual, operation.value)) return false;
      continue;
    }
    const target = locate(copy, operation.path);
    if (target === undefined) return false;
    if (operation.op === 'replace') {
      if (!exists(target)) return false;
      setAt(target, structuredClone(operation.value));
      continue;
    }
    // move: renames an object member; array reordering is not a fix any rule makes.
    const source = locate(copy, operation.from);
    if (source === undefined || !exists(source) || exists(target)) return false;
    if (Array.isArray(source.parent) || Array.isArray(target.parent)) return false;
    if (source.parent !== target.parent) return false;
    const value = source.parent[source.key as string];
    renameMember(source.parent, source.key as string, target.key as string, value);
  }
  return true;
}

/** Define an own member, so a key such as `__proto__` stays data and never sets the prototype. */
function defineMember(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function setAt(location: Location, value: unknown): void {
  if (Array.isArray(location.parent)) location.parent[location.key as number] = value;
  else defineMember(location.parent, location.key as string, value);
}

/** Rename a key in place, keeping its position so the spec reads in the same order. */
function renameMember(
  object: Record<string, unknown>,
  from: string,
  to: string,
  value: unknown,
): void {
  const entries = Object.entries(object);
  for (const key of Object.keys(object)) delete object[key];
  for (const [key, entry] of entries) {
    defineMember(object, key === from ? to : key, key === from ? value : entry);
  }
}
