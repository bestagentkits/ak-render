/**
 * Strict validation of declarative action bindings.
 *
 * `on` may appear at block level and inside nested prop objects (a toolbar
 * button, a dialog action). Both are validated here by the same closed
 * vocabulary, so there is no position where an action escapes validation.
 */

import { type DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import { isPlainObject, type JsonValue } from '../json.js';
import { validateActionMap } from '../registry/actions.js';
import type { PropValues } from '../registry/prop-schema.js';

export type BindingMap = Record<string, PropValues[]>;

/**
 * Walk a validated props subtree and replace every `on` value with its
 * normalized binding map. Returns the rewritten props.
 */
export function validateBindingsDeep(
  value: unknown,
  path: string,
  bag: DiagnosticBag,
): JsonValue | undefined {
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = validateBindingsDeep(value[index], pathIndex(path, index), bag);
      if (item !== undefined) result.push(item);
    }
    return result;
  }
  if (!isPlainObject(value)) {
    return value === undefined ? undefined : (value as JsonValue);
  }

  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = pathKey(path, key);
    if (key === 'on') {
      const { bindings } = validateActionMap(child, childPath, bag);
      if (Object.keys(bindings).length > 0) {
        result[key] = bindings as unknown as JsonValue;
      }
      continue;
    }
    const normalized = validateBindingsDeep(child, childPath, bag);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

/** Read the normalized bindings of a validated props object. */
export function bindingsOf(props: Record<string, JsonValue>): BindingMap {
  const candidate = props.on;
  if (candidate === undefined || !isPlainObject(candidate)) return {};
  return candidate as unknown as BindingMap;
}
