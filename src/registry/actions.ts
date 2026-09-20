/**
 * The closed action vocabulary.
 *
 * A Page Spec can request behavior, never author it. There is no expression
 * language, no selector language, and no handler body: an action is a record
 * with a known `action` value and validated parameters. The runtime owns how
 * each action is performed, including focus, keyboard, and ARIA updates.
 */

import { type DiagnosticBag, pathKey } from '../diagnostics.js';
import { isPlainObject, type JsonValue } from '../json.js';
import { NODE_ID_PATTERN, type PropSchema, type PropValues, validateProps } from './prop-schema.js';

export type ActionType =
  | 'copy'
  | 'open-url'
  | 'toggle'
  | 'set-value'
  | 'next'
  | 'previous'
  | 'select-tab'
  | 'expand'
  | 'collapse'
  | 'filter'
  | 'theme'
  | 'download';

export interface ActionDefinition {
  type: ActionType;
  summary: string;
  params: Record<string, PropSchema>;
}

const idRef = (description: string): PropSchema => ({
  kind: 'string',
  id: true,
  required: true,
  description,
});

const statePath: PropSchema = {
  kind: 'string',
  required: true,
  maxLength: 128,
  description: 'State path of the form `state.<key>[.<key>...]`.',
};

/** Events a block may bind to. Anything else is a validation error. */
export const ALLOWED_EVENTS = [
  'click',
  'change',
  'input',
  'select',
  'filter',
  'open',
  'close',
] as const;
export type ActionEvent = (typeof ALLOWED_EVENTS)[number];

export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  {
    type: 'copy',
    summary: 'Copy the text content of the target node to the clipboard.',
    params: { target: idRef('Node whose text is copied.') },
  },
  {
    type: 'open-url',
    summary: 'Open an allowlisted URL in a new tab.',
    params: {
      url: { kind: 'url', required: true, description: 'Destination URL.' },
      label: { kind: 'string', maxLength: 120, description: 'Accessible label for the link.' },
    },
  },
  {
    type: 'toggle',
    summary: 'Toggle the expanded, open, or active state of the target node.',
    params: { target: idRef('Node to toggle.') },
  },
  {
    type: 'set-value',
    summary: 'Set a page state value without an expression.',
    params: {
      path: statePath,
      value: {
        kind: 'json',
        description: 'Literal value assigned to the state path.',
        maxBytes: 4_096,
      },
    },
  },
  {
    type: 'next',
    summary: 'Advance a carousel, slideshow, or step sequence to the next item.',
    params: { target: { kind: 'string', id: true, description: 'Block to advance.' } },
  },
  {
    type: 'previous',
    summary: 'Move a carousel, slideshow, or step sequence to the previous item.',
    params: { target: { kind: 'string', id: true, description: 'Block to rewind.' } },
  },
  {
    type: 'select-tab',
    summary: 'Select a tab by index or id inside a tabs block.',
    params: {
      target: idRef('Tabs block to update.'),
      index: {
        kind: 'number',
        integer: true,
        min: 0,
        max: 200,
        description: 'Zero-based tab index.',
      },
      tabId: { kind: 'string', id: true, description: 'Tab id, as an alternative to index.' },
    },
  },
  {
    type: 'expand',
    summary: 'Expand a disclosure or accordion section.',
    params: { target: idRef('Section to expand.') },
  },
  {
    type: 'collapse',
    summary: 'Collapse a disclosure or accordion section.',
    params: { target: idRef('Section to collapse.') },
  },
  {
    type: 'filter',
    summary: 'Filter a collection by the current search input value.',
    params: {
      target: idRef('Collection to filter.'),
      match: {
        kind: 'string',
        enum: ['text', 'label', 'value'],
        description: 'Which part of each item is matched.',
      },
      query: {
        kind: 'string',
        maxLength: 200,
        description: 'Static query when no input is bound.',
      },
    },
  },
  {
    type: 'theme',
    summary: 'Switch the page theme.',
    params: {
      value: {
        kind: 'string',
        enum: ['toggle', 'light', 'dark', 'system'],
        description: 'Target theme, or `toggle` to flip the current one.',
      },
    },
  },
  {
    type: 'download',
    summary: 'Download the target node content as a file.',
    params: {
      target: idRef('Node whose text is downloaded.'),
      filename: {
        kind: 'string',
        maxLength: 120,
        description: 'Suggested filename; sanitized before use.',
      },
    },
  },
];

const BY_TYPE = new Map(ACTION_DEFINITIONS.map((definition) => [definition.type, definition]));

export function getAction(type: string): ActionDefinition | undefined {
  return BY_TYPE.get(type as ActionType);
}

export function listActionTypes(): ActionType[] {
  return ACTION_DEFINITIONS.map((definition) => definition.type);
}

export interface ValidatedActions {
  /** event name -> validated action records */
  bindings: Record<string, PropValues[]>;
}

/**
 * Validate an `on` binding map.
 *
 * Accepts either a single action object or a list of action objects per event.
 * `path` points at the `on` key so diagnostics land on the author's input.
 */
export function validateActionMap(
  value: unknown,
  path: string,
  bag: DiagnosticBag,
): ValidatedActions {
  const bindings: Record<string, PropValues[]> = {};
  if (value === undefined) return { bindings };
  if (!isPlainObject(value)) {
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected an event map object' });
    return { bindings };
  }

  for (const [event, binding] of Object.entries(value)) {
    const eventPath = pathKey(path, event);
    if (!ALLOWED_EVENTS.includes(event as ActionEvent)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: eventPath,
        message: `unknown event "${event}"`,
        details: { allowed: [...ALLOWED_EVENTS] },
      });
      continue;
    }
    const candidates = Array.isArray(binding) ? binding : [binding];
    if (candidates.length > 8) {
      bag.add({
        code: 'SPEC_BOUNDS_ERROR',
        path: eventPath,
        message: `event binds ${candidates.length} actions, limit is 8`,
      });
      continue;
    }
    const validated: PropValues[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidatePath = Array.isArray(binding) ? `${eventPath}[${index}]` : eventPath;
      const action = validateAction(candidates[index], candidatePath, bag);
      if (action !== undefined) validated.push(action);
    }
    if (validated.length > 0) bindings[event] = validated;
  }
  return { bindings };
}

/** Validate a single action record against the closed vocabulary. */
export function validateAction(
  value: unknown,
  path: string,
  bag: DiagnosticBag,
): PropValues | undefined {
  if (!isPlainObject(value)) {
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected an action object' });
    return undefined;
  }

  for (const key of Object.keys(value)) {
    if (key !== 'action' && /^on[A-Z]/.test(key)) {
      bag.add({
        code: 'POLICY_VIOLATION',
        path: pathKey(path, key),
        message: 'inline event-handler source is not accepted',
      });
    }
  }

  const actionType = value.action;
  if (typeof actionType !== 'string') {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(path, 'action'),
      message: 'action requires an "action" key',
    });
    return undefined;
  }

  const definition = BY_TYPE.get(actionType as ActionType);
  if (definition === undefined) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(path, 'action'),
      message: `unknown action "${actionType}"`,
      details: { allowed: listActionTypes() },
    });
    return undefined;
  }

  const { action: _ignored, ...rest } = value;
  const params = validateProps(definition.params, rest, path, bag);

  // A state path is the only dynamic indirection allowed, and it is a plain
  // dotted key path — never an expression.
  const statePathValue = params.path;
  if (typeof statePathValue === 'string' && !isSafeStatePath(statePathValue)) {
    bag.add({
      code: 'POLICY_VIOLATION',
      path: pathKey(path, 'path'),
      message: `"${statePathValue}" is not a state path of the form state.<key>[.<key>...]`,
    });
    return undefined;
  }

  const target = params.target;
  if (typeof target === 'string' && !NODE_ID_PATTERN.test(target)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(path, 'target'),
      message: `"${target}" is not a valid node id`,
    });
    return undefined;
  }

  return { action: actionType, ...params } as PropValues;
}

/** True when a string is a plain `state.` dotted key path. */
export function isSafeStatePath(value: string): boolean {
  return /^state\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/.test(value);
}

/** Collect every action record from a validated binding map. */
export function bindingActions(bindings: Record<string, PropValues[]>): PropValues[] {
  return Object.values(bindings).flat();
}

/** JSON-safe view of the vocabulary for `catalog()`. */
export function actionsCatalog(): { type: ActionType; summary: string }[] {
  return ACTION_DEFINITIONS.map((definition) => ({
    type: definition.type,
    summary: definition.summary,
  }));
}

/** Exported for tests and docs: the raw `action` value of a binding. */
export function actionTypeOf(action: JsonValue): string | undefined {
  if (!isPlainObject(action)) return undefined;
  const value = action.action;
  return typeof value === 'string' ? value : undefined;
}
