/**
 * Declarative property schemas.
 *
 * One source of truth serves three consumers: runtime validation (with stable
 * JSON paths), the published JSON Schema, and the compact `catalog()` /
 * `describe()` contracts. Keeping them derived from one definition is what
 * stops the documentation from drifting away from the validator.
 */

import { DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import { isPlainObject, type JsonValue } from '../json.js';

export type PropSchema =
  | StringPropSchema
  | TextPropSchema
  | NumberPropSchema
  | BooleanPropSchema
  | UrlPropSchema
  | ListPropSchema
  | ObjectPropSchema
  | RecordPropSchema
  | OneOfPropSchema
  | JsonPropSchema;

interface PropSchemaBase {
  /** Reject the document when the property is absent. */
  required?: boolean;
  description?: string;
}

export interface StringPropSchema extends PropSchemaBase {
  kind: 'string';
  default?: string;
  enum?: readonly string[];
  maxLength?: number;
  /** Validate as a node-safe identifier (`^[a-z0-9][a-z0-9-]{0,63}$`). */
  id?: boolean;
}

/** Long-form single-line or multi-line text. Escaped at emission. */
export interface TextPropSchema extends PropSchemaBase {
  kind: 'text';
  default?: string;
  maxLength?: number;
}

export interface NumberPropSchema extends PropSchemaBase {
  kind: 'number';
  default?: number;
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface BooleanPropSchema extends PropSchemaBase {
  kind: 'boolean';
  default?: boolean;
}

/**
 * A link or asset reference. A relative path stays local; an absolute URL must
 * use an allowlisted scheme. `data:` and `javascript:` are never accepted.
 */
export interface UrlPropSchema extends PropSchemaBase {
  kind: 'url';
  default?: string;
  schemes?: readonly string[];
}

export interface ListPropSchema extends PropSchemaBase {
  kind: 'list';
  of: PropSchema;
  minItems?: number;
  maxItems?: number;
}

export interface ObjectPropSchema extends PropSchemaBase {
  kind: 'object';
  fields: Record<string, PropSchema>;
}

/** An open-keyed map, e.g. `state` or key/value lists. */
export interface RecordPropSchema extends PropSchemaBase {
  kind: 'record';
  of: PropSchema;
  maxKeys?: number;
}

export interface OneOfPropSchema extends PropSchemaBase {
  kind: 'oneOf';
  options: readonly PropSchema[];
}

/**
 * A bounded, structurally-opaque JSON value validated by a capability adapter
 * (for example an `ak:diagram` typed IR payload). It is still size-bounded and
 * still scanned for forbidden keys.
 */
export interface JsonPropSchema extends PropSchemaBase {
  kind: 'json';
  description: string;
  maxBytes?: number;
  /** JSON Schema `$ref` used when projecting this prop into the spec schema. */
  schemaRef?: string;
}

export const DEFAULT_URL_SCHEMES = ['https', 'http', 'mailto'] as const;
export const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type PropValues = Record<string, JsonValue>;

export interface PropValidationResult {
  /** Validated values with defaults applied, in schema key order. */
  values: PropValues;
  /** Node-safe author IDs discovered in this subtree, mapped to their paths. */
  authorIds: { id: string; path: string }[];
}

function isRelativeReference(value: string): boolean {
  if (value === '') return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
  return !value.startsWith('//');
}

function validateUrl(
  schema: UrlPropSchema,
  value: string,
  path: string,
  bag: DiagnosticBag,
): boolean {
  if (isRelativeReference(value)) return true;
  const schemes = schema.schemes ?? DEFAULT_URL_SCHEMES;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path,
      message: `"${value}" is neither a relative reference nor an absolute URL`,
    });
    return false;
  }
  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  if (!schemes.includes(scheme)) {
    bag.add({
      code: 'POLICY_VIOLATION',
      path,
      message: `URL scheme "${scheme}" is not allowed here (allowed: ${schemes.join(', ')})`,
      details: { scheme, allowed: [...schemes] },
    });
    return false;
  }
  return true;
}

function defaultFor(schema: PropSchema): JsonValue | undefined {
  switch (schema.kind) {
    case 'string':
    case 'text':
    case 'url':
      return schema.default;
    case 'number':
      return schema.default;
    case 'boolean':
      return schema.default;
    case 'list':
      return schema.required === true ? undefined : [];
    case 'record':
      return schema.required === true ? undefined : {};
    default:
      return undefined;
  }
}

/**
 * Validate one property value against its schema, appending diagnostics and
 * returning the normalized value (or `undefined` when absent/optional).
 */
export function validateProp(
  schema: PropSchema,
  value: unknown,
  path: string,
  bag: DiagnosticBag,
): JsonValue | undefined {
  if (value === undefined) {
    if (schema.required === true) {
      bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'required value is missing' });
    }
    return defaultFor(schema);
  }

  switch (schema.kind) {
    case 'string': {
      if (typeof value !== 'string') {
        bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected a string' });
        return undefined;
      }
      const maxLength = schema.maxLength ?? 2_000;
      if (value.length > maxLength) {
        bag.add({
          code: 'SPEC_BOUNDS_ERROR',
          path,
          message: `string is ${value.length} characters, limit is ${maxLength}`,
        });
        return undefined;
      }
      if (schema.id === true && !NODE_ID_PATTERN.test(value)) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path,
          message: `"${value}" is not a valid id (lowercase letters, digits and dashes, 64 max)`,
        });
        return undefined;
      }
      if (schema.enum !== undefined && !schema.enum.includes(value)) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path,
          message: `"${value}" is not one of: ${schema.enum.join(', ')}`,
          details: { allowed: [...schema.enum] },
        });
        return undefined;
      }
      if (value.includes('\u0000')) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path,
          message: 'string contains a NUL character',
        });
        return undefined;
      }
      return value;
    }
    case 'text': {
      if (typeof value !== 'string') {
        bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected multiline text' });
        return undefined;
      }
      const maxLength = schema.maxLength ?? 50_000;
      if (value.length > maxLength) {
        bag.add({
          code: 'SPEC_BOUNDS_ERROR',
          path,
          message: `text is ${value.length} characters, limit is ${maxLength}`,
        });
        return undefined;
      }
      return value;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected a finite number' });
        return undefined;
      }
      if (schema.integer === true && !Number.isInteger(value)) {
        bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected an integer' });
        return undefined;
      }
      if (schema.min !== undefined && value < schema.min) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path,
          message: `${value} is below the minimum ${schema.min}`,
        });
        return undefined;
      }
      if (schema.max !== undefined && value > schema.max) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path,
          message: `${value} is above the maximum ${schema.max}`,
        });
        return undefined;
      }
      return value;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected a boolean' });
        return undefined;
      }
      return value;
    }
    case 'url': {
      if (typeof value !== 'string') {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path,
          message: 'expected a URL or relative path',
        });
        return undefined;
      }
      return validateUrl(schema, value, path, bag) ? value : undefined;
    }
    case 'list': {
      if (!Array.isArray(value)) {
        bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected a list' });
        return undefined;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path,
          message: `list has ${value.length} items, minimum is ${schema.minItems}`,
        });
        return undefined;
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        bag.add({
          code: 'SPEC_BOUNDS_ERROR',
          path,
          message: `list has ${value.length} items, limit is ${schema.maxItems}`,
        });
        return undefined;
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const item = validateProp(schema.of, value[index], pathIndex(path, index), bag);
        if (item !== undefined) result.push(item);
      }
      return result;
    }
    case 'object': {
      if (!isPlainObject(value)) {
        bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected an object' });
        return undefined;
      }
      const result: PropValues = {};
      for (const [key, field] of Object.entries(schema.fields)) {
        const fieldValue = validateProp(field, value[key], pathKey(path, key), bag);
        if (fieldValue !== undefined) result[key] = fieldValue;
      }
      for (const key of Object.keys(value)) {
        if (!(key in schema.fields)) {
          bag.add({
            code: 'SPEC_VALIDATION_ERROR',
            path: pathKey(path, key),
            message: `unknown property "${key}"`,
            details: { allowed: Object.keys(schema.fields) },
          });
        }
      }
      return result as JsonValue;
    }
    case 'record': {
      if (!isPlainObject(value)) {
        bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected an object' });
        return undefined;
      }
      const keys = Object.keys(value);
      const maxKeys = schema.maxKeys ?? 200;
      if (keys.length > maxKeys) {
        bag.add({
          code: 'SPEC_BOUNDS_ERROR',
          path,
          message: `object has ${keys.length} keys, limit is ${maxKeys}`,
        });
        return undefined;
      }
      const result: PropValues = {};
      for (const key of keys) {
        if (key.length > 128) {
          bag.add({
            code: 'SPEC_BOUNDS_ERROR',
            path: pathKey(path, key),
            message: 'key is longer than 128 characters',
          });
          continue;
        }
        const item = validateProp(schema.of, value[key], pathKey(path, key), bag);
        if (item !== undefined) result[key] = item;
      }
      return result as JsonValue;
    }
    case 'oneOf': {
      // Each option is attempted with its own diagnostics: a failed attempt must
      // not poison the next candidate.
      for (const option of schema.options) {
        const attempt = new DiagnosticBag();
        const candidate = validateProp(option, value, path, attempt);
        if (!attempt.hasErrors) return candidate;
      }
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path,
        message: `value does not match any allowed shape (${schema.options.length} options)`,
      });
      return undefined;
    }
    case 'json': {
      let serialized: string;
      try {
        serialized = JSON.stringify(value) ?? '';
      } catch {
        bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'value is not JSON-serializable' });
        return undefined;
      }
      const maxBytes = schema.maxBytes ?? 200_000;
      if (serialized.length > maxBytes) {
        bag.add({
          code: 'SPEC_BOUNDS_ERROR',
          path,
          message: `payload is ${serialized.length} bytes, limit is ${maxBytes}`,
        });
        return undefined;
      }
      return value as JsonValue;
    }
  }
}

/**
 * Validate a props object against a block's property schema. Unknown keys are
 * errors: a silently ignored prop is a silent authoring mistake.
 */
export function validateProps(
  fields: Record<string, PropSchema>,
  value: unknown,
  path: string,
  bag: DiagnosticBag,
): PropValues {
  if (!isPlainObject(value)) {
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected a block object' });
    return {};
  }
  const result: PropValues = {};
  for (const [key, field] of Object.entries(fields)) {
    const validated = validateProp(field, value[key], pathKey(path, key), bag);
    if (validated !== undefined) result[key] = validated;
  }
  for (const key of Object.keys(value)) {
    if (!(key in fields)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(path, key),
        message: `unknown property "${key}" for this block`,
        details: { allowed: Object.keys(fields) },
      });
    }
  }
  return result;
}

/** Project a prop schema into JSON Schema for the published spec contract. */
export function propSchemaToJsonSchema(schema: PropSchema): Record<string, unknown> {
  switch (schema.kind) {
    case 'string': {
      const out: Record<string, unknown> = { type: 'string' };
      if (schema.maxLength !== undefined) out.maxLength = schema.maxLength;
      else out.maxLength = 2_000;
      if (schema.enum !== undefined) out.enum = [...schema.enum];
      if (schema.id === true) out.pattern = NODE_ID_PATTERN.source;
      return out;
    }
    case 'text':
      return { type: 'string', maxLength: schema.maxLength ?? 50_000 };
    case 'number': {
      const out: Record<string, unknown> = { type: schema.integer === true ? 'integer' : 'number' };
      if (schema.min !== undefined) out.minimum = schema.min;
      if (schema.max !== undefined) out.maximum = schema.max;
      return out;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'url':
      return {
        type: 'string',
        description: 'Relative path (local asset) or an absolute URL with an allowlisted scheme.',
      };
    case 'list': {
      const out: Record<string, unknown> = {
        type: 'array',
        items: propSchemaToJsonSchema(schema.of),
      };
      if (schema.minItems !== undefined) out.minItems = schema.minItems;
      if (schema.maxItems !== undefined) out.maxItems = schema.maxItems;
      return out;
    }
    case 'object': {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(schema.fields)) {
        properties[key] = propSchemaToJsonSchema(field);
        if (field.required === true) required.push(key);
      }
      const out: Record<string, unknown> = {
        type: 'object',
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) out.required = required;
      return out;
    }
    case 'record':
      return { type: 'object', additionalProperties: propSchemaToJsonSchema(schema.of) };
    case 'oneOf':
      return { oneOf: schema.options.map((option) => propSchemaToJsonSchema(option)) };
    case 'json': {
      const out: Record<string, unknown> = { description: schema.description };
      if (schema.schemaRef !== undefined) out.$ref = schema.schemaRef;
      return out;
    }
  }
}
