/**
 * Typed slots for `compose` intents.
 *
 * One small descriptor per slot drives both the JSON Schema an MCP client sees
 * in `tools/list` and the validator that checks a compose input, so the two
 * cannot drift. The vocabulary is deliberately narrow: strings, multiline
 * text, bounded numbers, bounded lists and closed objects. Anything else is an
 * error with the JSON path of the offending value, never a silent drop.
 */

import { type DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import { LIMITS } from '../spec/bounds.js';

export type SlotField =
  | {
      kind: 'string';
      required?: boolean;
      enum?: readonly string[];
      /** Length cap of the block prop the slot fills; default the spec-wide cap. */
      max?: number;
      description?: string;
    }
  | { kind: 'text'; required?: boolean; max?: number; description?: string }
  | {
      kind: 'number';
      required?: boolean;
      min?: number;
      max?: number;
      integer?: boolean;
      description?: string;
    }
  | {
      kind: 'list';
      of: SlotField;
      required?: boolean;
      min?: number;
      max: number;
      description?: string;
    }
  | {
      kind: 'object';
      fields: Readonly<Record<string, SlotField>>;
      required?: boolean;
      description?: string;
    };

/** The JSON Schema for one slot. */
export function slotJsonSchema(field: SlotField): Record<string, unknown> {
  const described = field.description === undefined ? {} : { description: field.description };
  switch (field.kind) {
    case 'string':
      return {
        type: 'string',
        minLength: 1,
        maxLength: field.max ?? LIMITS.maxStringLength,
        ...(field.enum === undefined ? {} : { enum: [...field.enum] }),
        ...described,
      };
    case 'text':
      return {
        type: 'string',
        minLength: 1,
        maxLength: field.max ?? LIMITS.maxTextLength,
        ...described,
      };
    case 'number':
      return {
        type: field.integer === true ? 'integer' : 'number',
        ...(field.min === undefined ? {} : { minimum: field.min }),
        ...(field.max === undefined ? {} : { maximum: field.max }),
        ...described,
      };
    case 'list':
      return {
        type: 'array',
        items: slotJsonSchema(field.of),
        ...(field.min === undefined ? {} : { minItems: field.min }),
        maxItems: field.max,
        ...described,
      };
    case 'object': {
      const required = Object.entries(field.fields)
        .filter(([, child]) => child.required === true)
        .map(([key]) => key);
      return {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(field.fields).map(([key, child]) => [key, slotJsonSchema(child)]),
        ),
        ...(required.length === 0 ? {} : { required }),
        additionalProperties: false,
        ...described,
      };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(bag: DiagnosticBag, path: string, message: string): void {
  bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message });
}

/**
 * Check `value` against `field`, adding one diagnostic per problem. Returns
 * whether the value is usable; a caller expands only a fully valid input.
 */
export function checkSlot(
  value: unknown,
  field: SlotField,
  path: string,
  bag: DiagnosticBag,
): boolean {
  switch (field.kind) {
    case 'string':
      if (typeof value !== 'string' || value.trim() === '') {
        invalid(bag, path, 'must be a non-empty string');
        return false;
      }
      if (value.length > (field.max ?? LIMITS.maxStringLength)) {
        invalid(bag, path, `must be at most ${field.max ?? LIMITS.maxStringLength} characters`);
        return false;
      }
      if (field.enum !== undefined && !field.enum.includes(value)) {
        invalid(bag, path, `must be one of: ${field.enum.join(', ')}`);
        return false;
      }
      return true;
    case 'text':
      if (typeof value !== 'string' || value.trim() === '') {
        invalid(bag, path, 'must be non-empty text');
        return false;
      }
      if (value.length > (field.max ?? LIMITS.maxTextLength)) {
        invalid(bag, path, `must be at most ${field.max ?? LIMITS.maxTextLength} characters`);
        return false;
      }
      return true;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        invalid(bag, path, 'must be a finite number');
        return false;
      }
      if (field.integer === true && !Number.isInteger(value)) {
        invalid(bag, path, 'must be a whole number');
        return false;
      }
      if (
        (field.min !== undefined && value < field.min) ||
        (field.max !== undefined && value > field.max)
      ) {
        invalid(bag, path, `must be from ${field.min ?? '-∞'} to ${field.max ?? '∞'}`);
        return false;
      }
      return true;
    case 'list': {
      if (!Array.isArray(value)) {
        invalid(bag, path, 'must be a list');
        return false;
      }
      const min = field.min ?? 0;
      if (value.length < min || value.length > field.max) {
        invalid(bag, path, `must have ${min} to ${field.max} items`);
        return false;
      }
      let ok = true;
      value.forEach((item, index) => {
        if (!checkSlot(item, field.of, pathIndex(path, index), bag)) ok = false;
      });
      return ok;
    }
    case 'object': {
      if (!isRecord(value)) {
        invalid(bag, path, 'must be an object');
        return false;
      }
      let ok = true;
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(field.fields, key)) {
          invalid(
            bag,
            pathKey(path, key),
            `unknown field "${key}"; expected one of: ${Object.keys(field.fields).join(', ')}`,
          );
          ok = false;
        }
      }
      for (const [key, child] of Object.entries(field.fields)) {
        const childValue = value[key];
        if (childValue === undefined) {
          if (child.required === true) {
            invalid(bag, pathKey(path, key), `"${key}" is required`);
            ok = false;
          }
          continue;
        }
        if (!checkSlot(childValue, child, pathKey(path, key), bag)) ok = false;
      }
      return ok;
    }
  }
}
