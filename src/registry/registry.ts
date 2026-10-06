/**
 * Registry and discovery surfaces.
 *
 * `catalog()` is the compact, token-cheap listing an agent can afford to load
 * up front. `describe(type)` is the full contract, paid for only for the blocks
 * that were actually selected. The published JSON Schema is generated from the
 * same definitions, so a documented prop and a validated prop cannot disagree.
 */

import { BLOCK_GROUPS } from '../blocks/index.js';
import {
  BLOCK_DATA_JSON_SCHEMA_PROPERTIES,
  DATA_JSON_SCHEMA_DEFS,
} from '../data/data-json-schema.js';
import { RenderError } from '../errors.js';
import { LIMITS } from '../spec/bounds.js';
import { CONDITION_JSON_SCHEMA } from '../spec/conditions.js';
import { THEME_RECIPES_JSON_SCHEMA } from '../theme/recipes.js';
import { ACTION_DEFINITIONS, type ActionType, ALLOWED_EVENTS, actionsCatalog } from './actions.js';
import { BLOCK_CATEGORIES, type BlockCategory, type BlockRegistry } from './block-module.js';
import { propSchemaToJsonSchema } from './prop-schema.js';
import { buildRegistry } from './registry-builder.js';
import type { BlockDefinition } from './roster.js';

export { buildRegistry } from './registry-builder.js';

/** The registry every compile uses unless a caller passes its own. */
export const DEFAULT_REGISTRY: BlockRegistry = buildRegistry(BLOCK_GROUPS);

/** Every block definition: core roster entries, then each group's blocks. */
export const BLOCK_DEFINITIONS: readonly BlockDefinition[] = DEFAULT_REGISTRY.definitions;
const BLOCKS_BY_TYPE = DEFAULT_REGISTRY.byType;

/** Page Spec schema version implemented by this compiler. */
export const SPEC_SCHEMA_VERSION = 1;

export interface CatalogEntry {
  type: string;
  kind: 'semantic' | 'primitive';
  version: number;
  summary: string;
  category: BlockCategory;
  /** Search tags; `searchCatalog` also matches use cases, which stay out of the listing. */
  tags: string[];
}

export interface Catalog {
  schemaVersion: number;
  /** Number of blocks in this listing (the category's, when filtered). */
  blockCount: number;
  /** Present only when the listing is filtered to one category. */
  category?: BlockCategory;
  blocks: CatalogEntry[];
  actions: { type: ActionType; summary: string }[];
}

export interface CatalogOptions {
  /** List only this category; an unknown name is an error that lists the allowed ones. */
  category?: BlockCategory | (string & {});
}

export function getBlockDefinition(
  type: string,
  registry: BlockRegistry = DEFAULT_REGISTRY,
): BlockDefinition | undefined {
  return registry.byType.get(type);
}

export function blockTypes(registry: BlockRegistry = DEFAULT_REGISTRY): string[] {
  return registry.definitions.map((definition) => definition.type);
}

function isBlockCategory(value: string): value is BlockCategory {
  return (BLOCK_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Compact discovery surface: names, kinds, categories, tags and one-line
 * summaries, in registry order. `category` narrows it to one group.
 */
export function catalog(options: CatalogOptions = {}): Catalog {
  const { category } = options;
  if (category !== undefined && !isBlockCategory(category)) {
    throw new RenderError(
      'SPEC_VALIDATION_ERROR',
      `unknown category "${category}"; expected one of: ${BLOCK_CATEGORIES.join(', ')}`,
      { path: 'category', details: { category, allowed: [...BLOCK_CATEGORIES] } },
    );
  }
  const blocks = BLOCK_DEFINITIONS.filter(
    (definition) => category === undefined || definition.category === category,
  ).map((definition) => ({
    type: definition.type,
    kind: definition.kind,
    version: definition.version,
    summary: definition.summary,
    category: definition.category,
    tags: [...definition.tags],
  }));
  return {
    schemaVersion: SPEC_SCHEMA_VERSION,
    blockCount: blocks.length,
    ...(category === undefined ? {} : { category }),
    blocks,
    actions: actionsCatalog(),
  };
}

/**
 * The catalog as JSON text, one block and one action per line.
 *
 * Indenting every entry field would cost more bytes than the entries carry, and
 * the catalog is the one listing an agent loads up front. The value is the
 * same JSON a parser reads from any other formatting.
 */
export function formatCatalogJson(listing: Catalog): string {
  const members = Object.entries(listing).map(([key, value]) => {
    const name = JSON.stringify(key);
    if (!Array.isArray(value)) return `  ${name}: ${JSON.stringify(value)}`;
    if (value.length === 0) return `  ${name}: []`;
    const rows = value.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
    return `  ${name}: [\n${rows}\n  ]`;
  });
  return `{\n${members.join(',\n')}\n}`;
}

/**
 * Full contract for one block type.
 *
 * Returns a deep copy so a caller cannot mutate the registry through the
 * contract object.
 */
export function describe(type: string): BlockDefinition {
  const definition = BLOCKS_BY_TYPE.get(type);
  if (definition === undefined) {
    throw new RenderError('SPEC_UNKNOWN_BLOCK', `unknown block type "${type}"`, {
      path: 'blocks',
      details: { type, known: blockTypes().sort() },
    });
  }
  return JSON.parse(JSON.stringify(definition)) as BlockDefinition;
}

function blockListSchema(): Record<string, unknown> {
  return {
    type: 'array',
    minItems: 1,
    maxItems: LIMITS.maxBlocks,
    items: { $ref: '#/$defs/block' },
  };
}

function blockSchema(definition: BlockDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    type: { const: definition.type },
  };
  const required: string[] = ['type'];

  for (const [key, schema] of Object.entries(definition.props)) {
    properties[key] = propSchemaToJsonSchema(schema);
    if (schema.required === true) required.push(key);
  }

  if (definition.slots?.children !== undefined) {
    properties.blocks = { $ref: '#/$defs/blockList' };
  }
  if (definition.data !== undefined) {
    Object.assign(properties, BLOCK_DATA_JSON_SCHEMA_PROPERTIES);
  }
  properties.visibleWhen = { $ref: '#/$defs/condition' };

  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
    description: definition.summary,
  };
}

function actionMapSchema(): Record<string, unknown> {
  return {
    type: 'object',
    minProperties: 1,
    maxProperties: ALLOWED_EVENTS.length,
    propertyNames: { enum: [...ALLOWED_EVENTS] },
    additionalProperties: {
      oneOf: [
        { $ref: '#/$defs/action' },
        { type: 'array', minItems: 1, maxItems: 8, items: { $ref: '#/$defs/action' } },
      ],
    },
    description: 'Declarative action bindings, keyed by event name.',
  };
}

function actionSchema(): Record<string, unknown> {
  return {
    oneOf: ACTION_DEFINITIONS.map((definition) => {
      const properties: Record<string, unknown> = { action: { const: definition.type } };
      const required: string[] = ['action'];
      for (const [key, schema] of Object.entries(definition.params)) {
        properties[key] = propSchemaToJsonSchema(schema);
        if (schema.required === true) required.push(key);
      }
      return {
        type: 'object',
        additionalProperties: false,
        required,
        properties,
        description: definition.summary,
      };
    }),
  };
}

/**
 * The canonical Page Spec JSON Schema (JSON Schema draft 2020-12).
 *
 * Generated, never hand-maintained: `tests/unit/json-schema.test.ts` regenerates
 * it, compares against `schema/page-spec.v1.json`, and validates the fixture
 * corpus with an independent validator.
 */
export function buildPageSpecJsonSchema(): Record<string, unknown> {
  const defs: Record<string, unknown> = {
    block: {
      oneOf: BLOCK_DEFINITIONS.map((definition) => ({ $ref: `#/$defs/block-${definition.type}` })),
    },
    blockList: blockListSchema(),
    actionMap: actionMapSchema(),
    action: actionSchema(),
    condition: CONDITION_JSON_SCHEMA,
    ...DATA_JSON_SCHEMA_DEFS,
  };
  for (const definition of BLOCK_DEFINITIONS) {
    defs[`block-${definition.type}`] = blockSchema(definition);
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://agentkit.best/schema/page-spec.v1.json',
    title: 'AgentKit Page Spec',
    description:
      'Declarative page description compiled by @bestagentkits/render into deterministic, offline, interactive HTML.',
    type: 'object',
    additionalProperties: false,
    required: ['version', 'meta', 'blocks'],
    properties: {
      version: { const: SPEC_SCHEMA_VERSION, description: 'Page Spec schema version.' },
      meta: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 400 },
          locale: { type: 'string', maxLength: 35 },
          slug: { type: 'string', maxLength: 120 },
        },
      },
      theme: {
        type: 'object',
        additionalProperties: false,
        properties: {
          preset: { type: 'string', maxLength: 120 },
          extends: { type: 'string', maxLength: 120 },
          tokens: { type: 'object' },
          dark: { type: 'object', description: 'Token overrides for the dark scheme.' },
          recipes: THEME_RECIPES_JSON_SCHEMA,
        },
      },
      policy: {
        type: 'object',
        additionalProperties: false,
        properties: {
          network: {
            oneOf: [
              { const: 'deny' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['allow'],
                properties: {
                  allow: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 8,
                    items: { enum: ['media', 'fonts', 'images'] },
                  },
                },
              },
            ],
          },
        },
      },
      state: {
        type: 'object',
        maxProperties: LIMITS.maxMapKeys,
        additionalProperties: {
          type: ['string', 'number', 'boolean', 'null'],
        },
      },
      datasets: { $ref: '#/$defs/datasets' },
      blocks: blockListSchema(),
    },
    $defs: defs,
  };
}
