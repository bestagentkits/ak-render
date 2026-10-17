/**
 * Length caps read from block contracts, so a compose slot never advertises
 * more than the block it fills accepts.
 */

import type { PropSchema } from '../registry/prop-schema.js';
import { getBlockDefinition } from '../registry/registry.js';
import { LIMITS } from '../spec/bounds.js';

/**
 * The length cap of a string or text prop, by block type and prop path. List
 * levels are stepped through, so `('kpi', 'items', 'value')` is the cap of
 * one item's value. A missing prop is a programming error and throws.
 */
export function propMaxLength(type: string, ...path: [string, ...string[]]): number {
  const [first, ...rest] = path;
  let schema: PropSchema | undefined = getBlockDefinition(type)?.props[first];
  for (const key of rest) {
    while (schema?.kind === 'list') schema = schema.of;
    schema = schema?.kind === 'object' ? schema.fields[key] : undefined;
  }
  while (schema?.kind === 'list') schema = schema.of;
  if (schema?.kind === 'string') return schema.maxLength ?? LIMITS.maxStringLength;
  if (schema?.kind === 'text') return schema.maxLength ?? LIMITS.maxTextLength;
  throw new Error(`${type} has no string prop ${path.join('.')}`);
}
