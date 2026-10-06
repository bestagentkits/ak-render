/**
 * `visibleWhen`: show a block only while a page state value matches.
 *
 * A condition is data, never an expression: one state path, one operator from
 * a closed list, and scalar operands. The compiler evaluates it against the
 * initial `state` so the emitted markup already shows the initial view (with
 * scripts off, in print and in a screenshot), and the runtime re-evaluates the
 * same condition after every state change. `evaluateCondition` here and
 * `evalCondition` in the runtime's state part must agree exactly.
 */

import { type DataScalar, isDataScalar } from '../data/dataset-types.js';
import { type DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import { isPlainObject, type JsonValue } from '../json.js';
import { isSafeStatePath, STATE_PATH_PATTERN } from '../registry/actions.js';

export type Condition =
  | { path: string; op: 'equals' | 'notEquals'; value: DataScalar }
  | { path: string; op: 'in' | 'notIn'; value: DataScalar[] }
  | { path: string; op: 'truthy' | 'falsy' };

export const CONDITION_OPERATORS = [
  'equals',
  'notEquals',
  'in',
  'notIn',
  'truthy',
  'falsy',
] as const;
type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Values an `in` or `notIn` list may hold. */
export const MAX_CONDITION_VALUES = 20;

const CONDITION_KEYS: readonly string[] = ['path', ...CONDITION_OPERATORS];

/** JSON Schema for `visibleWhen`: the path plus exactly one operator. */
export const CONDITION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  description: 'Show the block only while a state value matches. Exactly one operator.',
  additionalProperties: false,
  required: ['path'],
  minProperties: 2,
  maxProperties: 2,
  properties: {
    path: { type: 'string', pattern: STATE_PATH_PATTERN.source },
    equals: { $ref: '#/$defs/dataScalar' },
    notEquals: { $ref: '#/$defs/dataScalar' },
    in: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_CONDITION_VALUES,
      items: { $ref: '#/$defs/dataScalar' },
    },
    notIn: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_CONDITION_VALUES,
      items: { $ref: '#/$defs/dataScalar' },
    },
    truthy: { const: true },
    falsy: { const: true },
  },
};

function isOperator(key: string): key is ConditionOperator {
  return (CONDITION_OPERATORS as readonly string[]).includes(key);
}

function operand(
  op: ConditionOperator,
  value: unknown,
  path: string,
  bag: DiagnosticBag,
): { ok: boolean; value?: DataScalar | DataScalar[] } {
  const fail = (message: string, at = path): { ok: false } => {
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path: at, message });
    return { ok: false };
  };
  if (op === 'truthy' || op === 'falsy') {
    return value === true ? { ok: true } : fail(`"${op}" takes the value true`);
  }
  if (op === 'equals' || op === 'notEquals') {
    return isDataScalar(value)
      ? { ok: true, value }
      : fail(`"${op}" takes a string, number, boolean, or null`);
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CONDITION_VALUES) {
    return fail(`"${op}" takes a list of 1-${MAX_CONDITION_VALUES} values`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!isDataScalar(value[index])) {
      return fail('expected a string, number, boolean, or null', pathIndex(path, index));
    }
  }
  return { ok: true, value: value as DataScalar[] };
}

/**
 * Validate an author condition, `{ path: state.metric, equals: cost }`. Exactly
 * one operator key. A path whose first key is not declared in `state` is a
 * warning: the condition reads as unset until an action sets it.
 */
export function validateCondition(
  value: unknown,
  path: string,
  bag: DiagnosticBag,
  state: Record<string, JsonValue>,
): Condition | undefined {
  if (!isPlainObject(value)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path,
      message: 'expected a condition such as { path: state.view, equals: table }',
    });
    return undefined;
  }
  let valid = true;
  for (const key of Object.keys(value)) {
    if (CONDITION_KEYS.includes(key)) continue;
    valid = false;
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(path, key),
      message: `unknown condition field "${key}"`,
      details: { allowed: [...CONDITION_KEYS] },
    });
  }

  const statePath = value.path;
  const pathAt = pathKey(path, 'path');
  if (typeof statePath !== 'string' || !isSafeStatePath(statePath)) {
    valid = false;
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathAt,
      message: `"${String(statePath)}" is not a state path of the form state.<key>[.<key>...]`,
    });
  }

  const operators = Object.keys(value).filter(isOperator);
  const op = operators[0];
  if (operators.length !== 1 || op === undefined) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path,
      message: `a condition needs exactly one operator, found ${operators.length}`,
      details: { allowed: [...CONDITION_OPERATORS] },
    });
    return undefined;
  }
  const checked = operand(op, value[op], pathKey(path, op), bag);
  if (!valid || !checked.ok || typeof statePath !== 'string') return undefined;

  const firstKey = statePath.split('.')[1] ?? '';
  if (!Object.hasOwn(state, firstKey)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: pathAt,
      message: `"state.${firstKey}" is not declared in state, so the condition starts unset`,
      details: { known: Object.keys(state) },
    });
  }

  if (op === 'truthy' || op === 'falsy') return { path: statePath, op };
  if (op === 'in' || op === 'notIn') {
    return { path: statePath, op, value: checked.value as DataScalar[] };
  }
  return { path: statePath, op, value: checked.value as DataScalar };
}

/** Read a `state.` path; a missing key reads as undefined, like the runtime's `readPath`. */
function readStatePath(path: string, state: Record<string, JsonValue>): JsonValue | undefined {
  let cursor: JsonValue | undefined = state;
  for (const part of path.split('.').slice(1)) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = Object.hasOwn(cursor, part) ? (cursor as Record<string, JsonValue>)[part] : undefined;
  }
  return cursor;
}

/**
 * Evaluate a condition against a state snapshot. Strict equality, list
 * membership by strict equality, and JavaScript truthiness: the same rules
 * the runtime applies after every state change.
 */
export function evaluateCondition(condition: Condition, state: Record<string, JsonValue>): boolean {
  const value = readStatePath(condition.path, state);
  switch (condition.op) {
    case 'equals':
      return value === condition.value;
    case 'notEquals':
      return value !== condition.value;
    case 'in':
      return condition.value.some((candidate) => candidate === value);
    case 'notIn':
      return !condition.value.some((candidate) => candidate === value);
    case 'truthy':
      return Boolean(value);
    case 'falsy':
      return !value;
  }
}
