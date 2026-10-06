/**
 * Asset references, found through the prop schema.
 *
 * A URL prop flagged with `asset` is something the page loads. Walking the
 * schema alongside the validated props finds every such reference, at any
 * depth, with the path the author wrote. The compiler uses the same walk to
 * build the page's network policy and to reject blocked references at
 * validation, so the two can never disagree about which values are assets.
 * Child blocks in slots are their own IR nodes and are walked as such.
 */

import { pathIndex, pathKey } from '../diagnostics.js';
import type { NetworkPolicy } from '../ir.js';
import { isPlainObject, type JsonValue } from '../json.js';
import type { PropSchema } from '../registry/prop-schema.js';
import {
  capabilityAllowed,
  isRemote,
  type MediaCapability,
  networkAllows,
} from './network-policy.js';

export interface AssetReference {
  /** JSON path of the value, e.g. `$.blocks[2].items[0].src`. */
  path: string;
  /** The prop or field name holding the reference, e.g. `poster`. */
  field: string;
  reference: string;
  capability: MediaCapability;
  /** The schema asks for a blocked remote reference to fail validation. */
  rejectBlocked: boolean;
}

function walk(
  schema: PropSchema,
  value: JsonValue | undefined,
  path: string,
  field: string,
  found: Map<string, AssetReference>,
): void {
  if (value === undefined) return;
  switch (schema.kind) {
    case 'url':
      if (schema.asset !== undefined && typeof value === 'string') {
        found.set(path, {
          path,
          field,
          reference: value,
          capability: schema.asset,
          rejectBlocked: schema.rejectBlocked === true,
        });
      }
      return;
    case 'list':
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          walk(schema.of, item, pathIndex(path, index), field, found);
        });
      }
      return;
    case 'object':
      if (isPlainObject(value)) {
        for (const [key, fieldSchema] of Object.entries(schema.fields)) {
          walk(fieldSchema, value[key], pathKey(path, key), key, found);
        }
      }
      return;
    case 'record':
      if (isPlainObject(value)) {
        for (const [key, item] of Object.entries(value)) {
          walk(schema.of, item, pathKey(path, key), key, found);
        }
      }
      return;
    case 'oneOf':
      // Every option is walked; an option the value does not fit finds nothing,
      // and the path-keyed map keeps one entry when two options agree.
      for (const option of schema.options) walk(option, value, path, field, found);
      return;
    default:
      return;
  }
}

/** Every asset reference in a block's validated props, in schema order. */
export function assetReferences(
  props: Readonly<Record<string, PropSchema>>,
  values: Readonly<Record<string, JsonValue>>,
  path: string,
): AssetReference[] {
  const found = new Map<string, AssetReference>();
  for (const [key, schema] of Object.entries(props)) {
    walk(schema, values[key], pathKey(path, key), key, found);
  }
  return [...found.values()];
}

/**
 * Origins the page's policy must name so its allowed remote assets load.
 * Provider allowlists are applied by the renderers, which never emit a
 * reference the policy does not allow.
 */
export function assetOrigins(
  policy: NetworkPolicy,
  references: readonly AssetReference[],
): string[] {
  if (policy === 'deny') return [];
  const origins: string[] = [];
  for (const { reference, capability } of references) {
    if (!capabilityAllowed(policy, capability) || !/^https?:/iu.test(reference)) continue;
    try {
      origins.push(new URL(reference).origin);
    } catch {
      // A reference that is not a URL is handled by the block renderer, not here.
    }
  }
  return origins;
}

/** True when the reference may load: a local path always may, a remote one through its gate. */
export function assetAllowed(policy: NetworkPolicy, asset: AssetReference): boolean {
  return !isRemote(asset.reference) || networkAllows(policy, asset.capability, asset.reference, '');
}
