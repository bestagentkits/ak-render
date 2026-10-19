/**
 * `patch()` — small, revisioned edits to a Page Spec.
 *
 * An edit is an RFC 6902 JSON Patch. A pointer may start with `/blocks/@<id>`
 * to address a block by its author-supplied `id` wherever it is nested, so an
 * agent edits `/blocks/@revenue-chart/title` without counting array indexes or
 * resending the whole spec. Optimistic concurrency is a spec hash: pass the
 * `baseHash` a previous patch returned and the patch is refused, unchanged, if
 * the spec moved on since.
 *
 * Operations apply in order to a copy and are all-or-nothing: one failing
 * operation (a missing target, a failed `test`, an unknown id) leaves the spec
 * untouched. The patched spec is then validated like any other spec; the patch
 * never repairs, deletes or guesses on the author's behalf.
 */

import { type Diagnostic, pathIndex } from '../diagnostics.js';
import { isRenderError } from '../errors.js';
import { stableHash } from '../hash.js';
import { canonicalStringify, isJsonValue, isPlainObject, type JsonValue } from '../json.js';
import { getBlockDefinition } from '../registry/registry.js';
import { collectSlotLists } from './normalize.js';
import { type ParseOptions, parseSpec } from './parse.js';
import { validate } from './validate.js';

/**
 * Any RFC 6902 operation. A suggested fix's `PatchOperation` (`test`,
 * `replace`, `move`) is one of these, so `patch()` applies fixes too.
 */
export type JsonPatchOperation =
  | { op: 'add' | 'replace' | 'test'; path: string; value: JsonValue }
  | { op: 'remove'; path: string }
  | { op: 'move' | 'copy'; from: string; path: string };

export interface PatchOptions extends ParseOptions {
  /** Hash the caller last saw; a different current hash refuses the patch. */
  baseHash?: string;
}

/** One applied operation, with block-id pointers resolved to plain ones. */
export interface PatchChange {
  op: JsonPatchOperation['op'];
  path: string;
  from?: string;
}

export interface PatchResult {
  /** Every operation applied and the patched spec has no errors. */
  ok: boolean;
  /** Every operation applied. When false, `spec` is the unchanged input. */
  applied: boolean;
  /** The patched spec, or the parsed input when nothing applied. */
  spec: JsonValue;
  /** Hash of `spec`; pass it as the next `baseHash`. */
  hash: string;
  /** Hash of the input spec. */
  baseHash: string;
  changes: PatchChange[];
  /** Patch failures, then the patched spec's own validation diagnostics. */
  diagnostics: Diagnostic[];
  /** Error count of the input spec, so a caller can tell a fix from a regression. */
  baseErrors: number;
  /** Error count of `spec`. */
  errors: number;
}

/** At most this many operations in one patch. */
export const MAX_PATCH_OPERATIONS = 256;

/**
 * A patch may not grow the spec past this many bytes of JSON, so a handful of
 * self-copies cannot double it until the process runs out of memory.
 */
export const MAX_PATCHED_SPEC_BYTES = 4 * 1024 * 1024;

const OPERATIONS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/u;
const BLOCK_REF = /^@(.+)$/u;

/**
 * Hash of a spec's content, independent of key order and of YAML or JSON
 * formatting and comments. Prefixed so it never reads as a render hash.
 */
export function specHash(spec: JsonValue): string {
  return `s-${stableHash(canonicalStringify(spec))}`;
}

class PatchFailure extends Error {
  constructor(
    readonly path: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * Apply `ops` to `input` (YAML or JSON text, or a parsed object). Never throws
 * for spec or patch problems; they are diagnostics.
 */
export function patch(input: unknown, ops: unknown, options: PatchOptions = {}): PatchResult {
  let parsed: unknown;
  try {
    parsed = parseSpec(input, options);
  } catch (error) {
    if (!isRenderError(error)) throw error;
    return refused(null, '', [
      { code: error.code, severity: 'error', message: error.message, path: error.path ?? '$' },
    ]);
  }
  if (!isJsonValue(parsed)) {
    return refused(null, '', [
      { code: 'SPEC_PATCH_ERROR', severity: 'error', message: 'spec is not JSON data', path: '$' },
    ]);
  }

  // A JSON round-trip, not structuredClone: YAML aliases parse to shared
  // objects, and an edit through one alias path must not change the others.
  const base = JSON.parse(JSON.stringify(parsed)) as JsonValue;
  const baseHash = specHash(base);
  const baseErrors = errorCount(validate(base).diagnostics);
  if (options.baseHash !== undefined && options.baseHash !== baseHash) {
    return refused(
      base,
      baseHash,
      [
        {
          code: 'SPEC_PATCH_CONFLICT',
          severity: 'error',
          message: `spec changed since ${options.baseHash}: current hash is ${baseHash}; re-read it and patch again`,
          path: '$',
          details: { baseHash: options.baseHash, currentHash: baseHash },
        },
      ],
      baseErrors,
    );
  }

  let applied: { spec: JsonValue; changes: PatchChange[] };
  try {
    applied = applyOperations(structuredClone(base), checkOperations(ops));
  } catch (error) {
    if (!(error instanceof PatchFailure)) throw error;
    const diagnostic: Diagnostic = {
      code: 'SPEC_PATCH_ERROR',
      severity: 'error',
      message: error.message,
      path: error.path,
    };
    if (error.details !== undefined) diagnostic.details = error.details;
    return refused(base, baseHash, [diagnostic], baseErrors);
  }

  const diagnostics = validate(applied.spec).diagnostics;
  const errors = errorCount(diagnostics);
  return {
    ok: errors === 0,
    applied: true,
    spec: applied.spec,
    hash: specHash(applied.spec),
    baseHash,
    changes: applied.changes,
    diagnostics,
    baseErrors,
    errors,
  };
}

function refused(
  spec: JsonValue,
  hash: string,
  diagnostics: Diagnostic[],
  baseErrors = 0,
): PatchResult {
  return {
    ok: false,
    applied: false,
    spec,
    hash,
    baseHash: hash,
    changes: [],
    diagnostics,
    baseErrors,
    errors: baseErrors,
  };
}

function errorCount(diagnostics: readonly Diagnostic[]): number {
  return diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
}

function checkOperations(ops: unknown): JsonPatchOperation[] {
  if (!Array.isArray(ops)) throw new PatchFailure('ops', 'ops must be an array of operations');
  if (ops.length > MAX_PATCH_OPERATIONS) {
    throw new PatchFailure(
      'ops',
      `a patch holds at most ${MAX_PATCH_OPERATIONS} operations, received ${ops.length}`,
    );
  }
  return ops.map((op, index) => {
    const at = pathIndex('ops', index);
    if (!isPlainObject(op) || typeof op.op !== 'string' || !OPERATIONS.has(op.op)) {
      throw new PatchFailure(
        `${at}.op`,
        'op must be one of add, remove, replace, move, copy, test',
      );
    }
    if (typeof op.path !== 'string') throw new PatchFailure(`${at}.path`, 'path must be a string');
    if ((op.op === 'move' || op.op === 'copy') && typeof op.from !== 'string') {
      throw new PatchFailure(`${at}.from`, `${op.op} needs a "from" pointer`);
    }
    if (op.op === 'add' || op.op === 'replace' || op.op === 'test') {
      if (!('value' in op) || !isJsonValue(op.value)) {
        throw new PatchFailure(`${at}.value`, `${op.op} needs a JSON "value"`);
      }
    }
    return op as unknown as JsonPatchOperation;
  });
}

function applyOperations(
  initial: JsonValue,
  ops: readonly JsonPatchOperation[],
): { spec: JsonValue; changes: PatchChange[] } {
  let doc = initial;
  let size = JSON.stringify(initial).length;
  const grow = (value: JsonValue, at: string): void => {
    size += JSON.stringify(value).length;
    if (size > MAX_PATCHED_SPEC_BYTES) {
      throw new PatchFailure(at, `a patched spec holds at most ${MAX_PATCHED_SPEC_BYTES} bytes`);
    }
  };
  const changes: PatchChange[] = [];
  ops.forEach((op, index) => {
    const at = pathIndex('ops', index);
    const from =
      op.op === 'move' || op.op === 'copy' ? resolvePointer(doc, op.from, `${at}.from`) : [];
    const value = op.op === 'move' || op.op === 'copy' ? read(doc, from, `${at}.from`) : null;
    if (op.op === 'move') {
      // The own-child check compares the locations as written, before the
      // removal shifts the indexes a block id resolves to.
      const written = resolvePointer(doc, op.path, `${at}.path`);
      if (isPrefix(from, written) && from.length < written.length) {
        throw new PatchFailure(`${at}.path`, 'cannot move a value into one of its own children');
      }
      // The target then resolves against the spec without the moved value,
      // as RFC 6902 specifies.
      doc = remove(doc, from, `${at}.from`).doc;
    }
    if (op.op === 'copy') grow(value as JsonValue, `${at}.path`);
    else if (op.op === 'add' || op.op === 'replace') grow(op.value, `${at}.path`);
    const path = resolvePointer(doc, op.path, `${at}.path`);
    const change: PatchChange = { op: op.op, path: format(path) };
    switch (op.op) {
      case 'test': {
        const current = read(doc, path, `${at}.path`);
        if (canonicalStringify(current) !== canonicalStringify(op.value)) {
          throw new PatchFailure(`${at}.value`, `test failed: ${op.path} holds a different value`);
        }
        break;
      }
      case 'add': {
        const target = add(doc, path, structuredClone(op.value), `${at}.path`);
        doc = target.doc;
        change.path = format(target.path);
        break;
      }
      case 'remove':
        doc = remove(doc, path, `${at}.path`).doc;
        break;
      case 'replace':
        read(doc, path, `${at}.path`);
        doc = path.length === 0 ? structuredClone(op.value) : set(doc, path, op.value);
        break;
      case 'move':
      case 'copy': {
        change.from = format(from);
        const target = add(doc, path, structuredClone(value as JsonValue), `${at}.path`);
        doc = target.doc;
        change.path = format(target.path);
        break;
      }
    }
    changes.push(change);
  });
  return { spec: doc, changes };
}

/** RFC 6901 pointer to segments, with a leading `/blocks/@id` resolved. */
function resolvePointer(doc: JsonValue, pointer: string, at: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new PatchFailure(at, `"${pointer}" is not a JSON Pointer; it must start with "/"`);
  }
  const segments = pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'));
  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      throw new PatchFailure(at, `"${segment}" is not an allowed pointer segment`);
    }
  }
  const ref = segments[0] === 'blocks' ? BLOCK_REF.exec(segments[1] ?? '') : null;
  if (ref === null) return segments;
  return [...findBlock(doc, ref[1] as string, at), ...segments.slice(2)];
}

/** The pointer of the one block whose author `id` is `id`, at any depth. */
function findBlock(doc: JsonValue, id: string, at: string): string[] {
  const found: string[][] = [];
  const ids: string[] = [];
  const visit = (entries: unknown[], pointer: string[], path: string): void => {
    entries.forEach((entry, index) => {
      if (!isPlainObject(entry)) return;
      const here = [...pointer, String(index)];
      const herePath = pathIndex(path, index);
      if (typeof entry.id === 'string') {
        ids.push(entry.id);
        if (entry.id === id) found.push(here);
      }
      if (Array.isArray(entry.blocks)) {
        visit(entry.blocks, [...here, 'blocks'], `${herePath}.blocks`);
      }
      const definition =
        typeof entry.type === 'string' ? getBlockDefinition(entry.type) : undefined;
      if (definition === undefined) return;
      for (const list of collectSlotLists(definition, entry, herePath)) {
        visit(list.entries, pathSegments(list.path), list.path);
      }
    });
  };
  if (isPlainObject(doc) && Array.isArray(doc.blocks)) visit(doc.blocks, ['blocks'], 'blocks');

  if (found.length === 1) return found[0] as string[];
  if (found.length > 1) {
    throw new PatchFailure(at, `block id "${id}" is not unique (${found.length} blocks)`, {
      matches: found.map(format),
    });
  }
  throw new PatchFailure(
    at,
    `no block has id "${id}"; give the block an "id" field to address it by id`,
    { known: ids.slice(0, 50) },
  );
}

/** `blocks[2].items[0].blocks` to pointer segments. */
function pathSegments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/gu, '.$1')
    .split('.')
    .filter((segment) => segment !== '');
}

function format(segments: readonly string[]): string {
  return segments
    .map((segment) => `/${segment.replace(/~/gu, '~0').replace(/\//gu, '~1')}`)
    .join('');
}

function isPrefix(prefix: readonly string[], segments: readonly string[]): boolean {
  return prefix.every((segment, index) => segments[index] === segment);
}

function child(container: JsonValue, segment: string, at: string, pointer: string[]): JsonValue {
  if (Array.isArray(container)) {
    const index = arrayIndex(segment, container.length - 1, at, pointer);
    return container[index] as JsonValue;
  }
  if (isPlainObject(container) && Object.hasOwn(container, segment)) {
    return container[segment] as JsonValue;
  }
  throw new PatchFailure(at, `${format(pointer)} does not exist`);
}

function arrayIndex(segment: string, max: number, at: string, pointer: string[]): number {
  if (!ARRAY_INDEX.test(segment) || Number(segment) > max) {
    throw new PatchFailure(at, `${format(pointer)} is not an index of an array of ${max + 1}`);
  }
  return Number(segment);
}

function read(doc: JsonValue, segments: readonly string[], at: string): JsonValue {
  let current = doc;
  segments.forEach((segment, index) => {
    current = child(current, segment, at, segments.slice(0, index + 1));
  });
  return current;
}

function parentOf(doc: JsonValue, segments: readonly string[], at: string): JsonValue {
  return read(doc, segments.slice(0, -1), at);
}

function set(doc: JsonValue, segments: readonly string[], value: JsonValue): JsonValue {
  const parent = parentOf(doc, segments, '') as JsonValue[] | Record<string, JsonValue>;
  const key = segments[segments.length - 1] as string;
  if (Array.isArray(parent)) parent[Number(key)] = structuredClone(value);
  else parent[key] = structuredClone(value);
  return doc;
}

function add(
  doc: JsonValue,
  segments: readonly string[],
  value: JsonValue,
  at: string,
): { doc: JsonValue; path: string[] } {
  if (segments.length === 0) return { doc: value, path: [] };
  const parent = parentOf(doc, segments, at);
  const key = segments[segments.length - 1] as string;
  if (Array.isArray(parent)) {
    const index = key === '-' ? parent.length : arrayIndex(key, parent.length, at, [...segments]);
    parent.splice(index, 0, value);
    return { doc, path: [...segments.slice(0, -1), String(index)] };
  }
  if (!isPlainObject(parent)) {
    throw new PatchFailure(at, `${format(segments.slice(0, -1))} is not an object or array`);
  }
  parent[key] = value;
  return { doc, path: [...segments] };
}

function remove(doc: JsonValue, segments: readonly string[], at: string): { doc: JsonValue } {
  if (segments.length === 0) throw new PatchFailure(at, 'cannot remove the whole spec');
  read(doc, segments, at);
  const parent = parentOf(doc, segments, at);
  const key = segments[segments.length - 1] as string;
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else delete (parent as Record<string, JsonValue>)[key];
  return { doc };
}
