/**
 * Input bounds.
 *
 * Bounds are checked before schema validation so an absurd document fails fast
 * and cheaply. Every limit is application-level and deliberately far below any
 * platform limit, because the same code runs in a CLI, in a library caller, and
 * inside a worker with a bounded memory budget and a request-size ceiling.
 */

import { type DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import { isPlainObject } from '../json.js';

export const LIMITS = {
  /** Nesting depth of the raw document, root included. */
  maxDepth: 24,
  /** Entries in any `blocks` array, and total authored blocks. */
  maxBlocks: 200,
  /** Objects in the document, anywhere (props objects and list items included). */
  maxNodes: 20_000,
  /** Serialized size of the whole document. */
  maxSerializedBytes: 1_000_000,
  /** Items in any single list. */
  maxListItems: 200,
  /** Keys in an open-keyed map such as `state`. */
  maxMapKeys: 200,
  /** Length of a single-line string. */
  maxStringLength: 2_000,
  /** Length of multiline text. */
  maxTextLength: 50_000,
} as const;

export interface BoundsReport {
  blocks: number;
  nodes: number;
  depth: number;
  bytes: number;
  longestString: number;
  largestList: number;
}

interface WalkState extends BoundsReport {
  bag: DiagnosticBag;
  overflowed: { depth: boolean; blocks: boolean; nodes: boolean };
}

function walk(value: unknown, path: string, depth: number, state: WalkState): void {
  if (depth > state.depth) state.depth = depth;
  if (depth > LIMITS.maxDepth && !state.overflowed.depth) {
    state.overflowed.depth = true;
    state.bag.add({
      code: 'SPEC_BOUNDS_ERROR',
      path,
      message: `document nests ${depth} levels deep, limit is ${LIMITS.maxDepth}`,
    });
    return;
  }

  if (typeof value === 'string') {
    if (value.length > state.longestString) state.longestString = value.length;
    return;
  }
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    if (value.length > state.largestList) state.largestList = value.length;
    if (value.length > LIMITS.maxListItems) {
      state.bag.add({
        code: 'SPEC_BOUNDS_ERROR',
        path,
        message: `list has ${value.length} items, limit is ${LIMITS.maxListItems}`,
      });
    }
    for (let index = 0; index < value.length; index += 1) {
      walk(value[index], pathIndex(path, index), depth + 1, state);
    }
    return;
  }

  if (!isPlainObject(value)) return;
  state.nodes += 1;
  if (state.nodes > LIMITS.maxNodes && !state.overflowed.nodes) {
    state.overflowed.nodes = true;
    state.bag.add({
      code: 'SPEC_BOUNDS_ERROR',
      path,
      message: `document has more than ${LIMITS.maxNodes} objects`,
    });
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = pathKey(path, key);
    if (key === 'blocks' && Array.isArray(child)) {
      state.blocks += child.length;
      if (state.blocks > LIMITS.maxBlocks && !state.overflowed.blocks) {
        state.overflowed.blocks = true;
        state.bag.add({
          code: 'SPEC_BOUNDS_ERROR',
          path: childPath,
          message: `document declares more than ${LIMITS.maxBlocks} blocks`,
        });
      }
      if (child.length > LIMITS.maxBlocks) {
        state.bag.add({
          code: 'SPEC_BOUNDS_ERROR',
          path: childPath,
          message: `blocks array has ${child.length} entries, limit is ${LIMITS.maxBlocks}`,
        });
      }
    }
    walk(child, childPath, depth + 1, state);
  }
}

/**
 * Measure a raw document and report every exceeded bound.
 *
 * The walk is bounded even when the input is not: exceeding a limit stops
 * descending at that branch instead of continuing to allocate diagnostics.
 */
export function checkBounds(value: unknown, bag: DiagnosticBag): BoundsReport {
  const state: WalkState = {
    blocks: 0,
    nodes: 0,
    depth: 0,
    bytes: 0,
    longestString: 0,
    largestList: 0,
    bag,
    overflowed: { depth: false, blocks: false, nodes: false },
  };

  let serialized = '';
  try {
    serialized = JSON.stringify(value) ?? '';
  } catch {
    bag.add({
      code: 'SPEC_BOUNDS_ERROR',
      path: '$',
      message: 'document is not JSON-serializable',
    });
  }
  state.bytes = serialized.length;
  if (state.bytes > LIMITS.maxSerializedBytes) {
    bag.add({
      code: 'SPEC_BOUNDS_ERROR',
      path: '$',
      message: `document is ${state.bytes} bytes serialized, limit is ${LIMITS.maxSerializedBytes}`,
    });
  }

  walk(value, '$', 1, state);

  return {
    blocks: state.blocks,
    nodes: state.nodes,
    depth: state.depth,
    bytes: state.bytes,
    longestString: state.longestString,
    largestList: state.largestList,
  };
}
