/**
 * JSON Schema fragments for datasets and block data bindings. The registry
 * merges `DATA_JSON_SCHEMA_DEFS` into `$defs` and spreads
 * `BLOCK_DATA_JSON_SCHEMA_PROPERTIES` into blocks whose definition takes data.
 */

import { NODE_ID_PATTERN, propSchemaToJsonSchema } from '../registry/prop-schema.js';
import { DATA_LIMITS, FIELD_KEY_PATTERN } from './dataset-types.js';
import { TRANSFORM_PROP_SCHEMA } from './transform-pipeline.js';

export const DATA_JSON_SCHEMA_DEFS: Record<string, unknown> = {
  dataScalar: {
    description: 'A dataset value: a string, a finite number, a boolean, or null.',
    oneOf: [
      { type: 'string', maxLength: DATA_LIMITS.maxStringLength },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'null' },
    ],
  },
  dataRows: {
    type: 'array',
    description: 'Flat rows of scalar values; the field list is the union of row keys.',
    minItems: 1,
    maxItems: DATA_LIMITS.maxRows,
    items: {
      type: 'object',
      propertyNames: { pattern: FIELD_KEY_PATTERN.source },
      additionalProperties: { $ref: '#/$defs/dataScalar' },
    },
  },
  datasets: {
    type: 'object',
    description: 'Named datasets that blocks reference with `dataRef`.',
    maxProperties: DATA_LIMITS.maxDatasets,
    propertyNames: { pattern: NODE_ID_PATTERN.source },
    additionalProperties: { $ref: '#/$defs/dataRows' },
  },
};

/** Properties added to a block that accepts data. */
export const BLOCK_DATA_JSON_SCHEMA_PROPERTIES: Record<string, unknown> = {
  dataRef: {
    type: 'string',
    pattern: NODE_ID_PATTERN.source,
    description: 'Name of a dataset declared in `datasets`. Do not combine with `data`.',
  },
  data: { $ref: '#/$defs/dataRows' },
  transform: propSchemaToJsonSchema(TRANSFORM_PROP_SCHEMA),
};
