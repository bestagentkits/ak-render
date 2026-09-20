/**
 * Registry and discovery surfaces.
 *
 * `catalog()` is the compact, token-cheap listing an agent can afford to load
 * up front. `describe(type)` is the full contract, paid for only for the blocks
 * that were actually selected. The published JSON Schema is generated from the
 * same definitions, so a documented prop and a validated prop cannot disagree.
 */

import { RenderError } from '../errors.js';
import { LIMITS } from '../spec/bounds.js';
import { ACTION_DEFINITIONS, type ActionType, ALLOWED_EVENTS, actionsCatalog } from './actions.js';
import { propSchemaToJsonSchema } from './prop-schema.js';
import { BLOCK_DEFINITIONS, BLOCKS_BY_TYPE, type BlockDefinition } from './roster.js';

/** Page Spec schema version implemented by this compiler. */
export const SPEC_SCHEMA_VERSION = 1;

export interface CatalogEntry {
  type: string;
  kind: 'semantic' | 'primitive';
  version: number;
  summary: string;
}

export interface Catalog {
  schemaVersion: number;
  blockCount: number;
  blocks: CatalogEntry[];
  actions: { type: ActionType; summary: string }[];
}

export function getBlockDefinition(type: string): BlockDefinition | undefined {
  return BLOCKS_BY_TYPE.get(type);
}

export function blockTypes(): string[] {
  return BLOCK_DEFINITIONS.map((definition) => definition.type);
}

/** Compact discovery surface: names, kinds, and one-line summaries. */
export function catalog(): Catalog {
  return {
    schemaVersion: SPEC_SCHEMA_VERSION,
    blockCount: BLOCK_DEFINITIONS.length,
    blocks: BLOCK_DEFINITIONS.map((definition) => ({
      type: definition.type,
      kind: definition.kind,
      version: definition.version,
      summary: definition.summary,
    })),
    actions: actionsCatalog(),
  };
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
  };
  for (const definition of BLOCK_DEFINITIONS) {
    defs[`block-${definition.type}`] = blockSchema(definition);
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://agentkit.best/schema/page-spec.v1.json',
    title: 'AgentKit Page Spec',
    description:
      'Declarative page description compiled by @agentkit/render into deterministic, offline, interactive HTML.',
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
      blocks: blockListSchema(),
    },
    $defs: defs,
  };
}
