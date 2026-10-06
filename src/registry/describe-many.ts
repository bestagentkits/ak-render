/**
 * Several block contracts in one call, optionally in compact form.
 *
 * `describe(type)` returns the full contract: every prop with its bounds,
 * defaults and description, plus sizing, accessibility and migration notes.
 * That is what an agent needs to get one tricky block right, but it is too much
 * to load for every block on a page. The compact form keeps what authoring
 * needs (prop names, kinds, requiredness, enums, slots, data and actions) as
 * one short line each, and drops the prose.
 */

import { RenderError } from '../errors.js';
import type { BlockCategory } from './block-module.js';
import { CATALOG_SEARCH_LIMITS, searchCatalog } from './catalog-search.js';
import type { PropSchema } from './prop-schema.js';
import { describe } from './registry.js';
import type { BlockDefinition, SlotSpec } from './roster.js';

/** The authoring essentials of one block, one line per prop. */
export interface CompactBlockDescription {
  type: string;
  kind: 'semantic' | 'primitive';
  version: number;
  category: BlockCategory;
  summary: string;
  /**
   * `name: kind[, required][, enum a|b|c]`. Fields of list items read
   * `items[].field`, fields of an object read `prop.field`. A long enum
   * printed earlier reads `enum as <prop>`, and an object whose fields match
   * one printed earlier reads `, like <prop>` with its fields left out.
   */
  props: string[];
  /** `name: accepts[, min..max]`, when the block takes child blocks. */
  slots?: string[];
  /** Allowed direct parents, when the block may only sit inside some types. */
  parents?: string[];
  /** Present when the block reads rows from `dataRef` or inline `data`. */
  data?: { required: boolean; description: string };
  /** Actions the block can trigger, when it has any. */
  actions?: string[];
}

export type BlockDescription = BlockDefinition | CompactBlockDescription;

export interface DescribeManyOptions {
  compact?: boolean;
}

/** At most this many distinct types per call. */
export const DESCRIBE_MANY_LIMIT = 12;

/** How many suggestions an unknown type error offers. */
const SUGGESTIONS = 3;

function kindLabel(schema: PropSchema): string {
  switch (schema.kind) {
    case 'list':
      return `list<${kindLabel(schema.of)}>`;
    case 'record':
      return `record<${kindLabel(schema.of)}>`;
    case 'oneOf':
      return `oneOf<${[...new Set(schema.options.map(kindLabel))].join('|')}>`;
    default:
      return schema.kind;
  }
}

function enumValues(schema: PropSchema): readonly string[] | undefined {
  if (schema.kind === 'string') return schema.enum;
  if (schema.kind === 'list' && schema.of.kind === 'string') return schema.of.enum;
  return undefined;
}

/**
 * What a contract has already printed, so a repeat costs one short reference
 * instead of the same lines again: `x`, `y` and `value` encodings share one
 * shape, and format or currency enums recur across props.
 */
interface CompactSeen {
  /** Rendered field lines of an object shape, to the prop that first printed it. */
  shapes: Map<string, string>;
  /** A long enum list, to the prop that first printed it. */
  enums: Map<string, string>;
}

/** Enum lists shorter than this are cheaper to repeat than to reference. */
const ENUM_REFERENCE_MIN = 24;

function propLine(name: string, schema: PropSchema, seen: CompactSeen | undefined): string {
  const parts = [`${name}: ${kindLabel(schema)}`];
  if (schema.required === true) parts.push('required');
  const values = enumValues(schema);
  if (values !== undefined && values.length > 0) {
    const list = values.join('|');
    const first = list.length >= ENUM_REFERENCE_MIN ? seen?.enums.get(list) : undefined;
    if (first === undefined) {
      parts.push(`enum ${list}`);
      if (list.length >= ENUM_REFERENCE_MIN) seen?.enums.set(list, name);
    } else {
      parts.push(`enum as ${first}`);
    }
  }
  if (schema.kind === 'blocks' && Array.isArray(schema.accepts)) {
    parts.push(`accepts ${schema.accepts.join('|')}`);
  }
  return parts.join(', ');
}

/** The nested fields a prop expands into, with the prefix their names take. */
function nestedFields(
  name: string,
  schema: PropSchema,
): { prefix: string; fields: Record<string, PropSchema> } | undefined {
  if (schema.kind === 'object') return { prefix: `${name}.`, fields: schema.fields };
  if (schema.kind === 'list' && schema.of.kind === 'object') {
    return { prefix: `${name}[].`, fields: schema.of.fields };
  }
  if (schema.kind === 'record' && schema.of.kind === 'object') {
    return { prefix: `${name}{}.`, fields: schema.of.fields };
  }
  return undefined;
}

/**
 * One line for the prop, then one per nested field, depth first. A nested
 * shape identical to one already printed reads `like <prop>` instead.
 */
function propLines(name: string, schema: PropSchema, out: string[], seen?: CompactSeen): void {
  const nested = nestedFields(name, schema);
  if (nested !== undefined && seen !== undefined) {
    // The shape key renders the fields with no prefix and no references, so
    // two props match only when every field line would read the same.
    const shape: string[] = [];
    for (const [field, fieldSchema] of Object.entries(nested.fields)) {
      propLines(field, fieldSchema, shape);
    }
    const key = shape.join('\n');
    const first = seen.shapes.get(key);
    if (first !== undefined) {
      out.push(`${propLine(name, schema, seen)}, like ${first}`);
      return;
    }
    seen.shapes.set(key, name);
  }
  out.push(propLine(name, schema, seen));
  if (nested === undefined) return;
  for (const [field, fieldSchema] of Object.entries(nested.fields)) {
    propLines(`${nested.prefix}${field}`, fieldSchema, out, seen);
  }
}

function slotLine(name: string, slot: SlotSpec): string {
  const accepts = slot.accepts === '*' ? 'any' : slot.accepts.join('|');
  const bounds =
    slot.min === undefined && slot.max === undefined
      ? ''
      : `, ${slot.min ?? 0}..${slot.max ?? 'any'}`;
  return `${name}: ${accepts}${bounds}`;
}

/** The compact form of one full contract. */
export function compactDescription(definition: BlockDefinition): CompactBlockDescription {
  const props: string[] = [];
  const seen: CompactSeen = { shapes: new Map(), enums: new Map() };
  for (const [name, schema] of Object.entries(definition.props)) {
    propLines(name, schema, props, seen);
  }
  const slots = Object.entries(definition.slots ?? {}).map(([name, slot]) => slotLine(name, slot));
  return {
    type: definition.type,
    kind: definition.kind,
    version: definition.version,
    category: definition.category,
    summary: definition.summary,
    props,
    ...(slots.length === 0 ? {} : { slots }),
    ...(definition.parents === undefined ? {} : { parents: [...definition.parents] }),
    ...(definition.data === undefined ? {} : { data: { ...definition.data } }),
    ...(definition.actions.length === 0 ? {} : { actions: [...definition.actions] }),
  };
}

/** `describe`, with up to three suggested types when the type is unknown. */
function describeOrSuggest(type: string): BlockDefinition {
  try {
    return describe(type);
  } catch (error) {
    if (!(error instanceof RenderError) || error.code !== 'SPEC_UNKNOWN_BLOCK') throw error;
    // A type longer than a search query cannot be a near miss worth suggesting.
    const closest =
      type.length > CATALOG_SEARCH_LIMITS.maxQueryLength
        ? []
        : searchCatalog(type, SUGGESTIONS).map((hit) => hit.type);
    const hint = closest.length === 0 ? '' : `; closest: ${closest.join(', ')}`;
    throw new RenderError('SPEC_UNKNOWN_BLOCK', `unknown block type "${type}"${hint}`, {
      path: 'types',
      details: { type, closest },
    });
  }
}

/**
 * Contracts for several block types, in the order given, with duplicates
 * dropped. `compact: true` returns the one-line-per-prop form.
 */
export function describeMany(
  types: readonly string[],
  options: DescribeManyOptions & { compact: true },
): CompactBlockDescription[];
export function describeMany(
  types: readonly string[],
  options?: DescribeManyOptions & { compact?: false },
): BlockDefinition[];
export function describeMany(
  types: readonly string[],
  options?: DescribeManyOptions,
): BlockDescription[];
export function describeMany(
  types: readonly string[],
  options: DescribeManyOptions = {},
): BlockDescription[] {
  const distinct = [...new Set(types)];
  if (distinct.length === 0 || distinct.length > DESCRIBE_MANY_LIMIT) {
    throw new RenderError(
      'SPEC_VALIDATION_ERROR',
      `describe takes 1 to ${DESCRIBE_MANY_LIMIT} distinct block types, got ${distinct.length}`,
      { path: 'types', details: { count: distinct.length, limit: DESCRIBE_MANY_LIMIT } },
    );
  }
  const contracts = distinct.map(describeOrSuggest);
  return options.compact === true ? contracts.map(compactDescription) : contracts;
}
