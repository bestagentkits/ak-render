/**
 * What every input control shares: the prop fragment, the cross-field checks
 * (state binding, initial value, filter field and match), and the markup
 * pieces (wrapper attributes, hint, the no-script note).
 *
 * A control writes one scalar to `state.<key>`, and inside a `filter-bar` it
 * filters its target's rows by one field with one enumerated operator. There
 * is no other behavior to express: no handler, expression or selector.
 */

import type { DataRow, DataScalar } from '../../data/dataset-types.js';
import { reportUnknownField } from '../../data/resolve-block-data.js';
import { pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { JsonValue } from '../../json.js';
import { isSafeStatePath } from '../../registry/actions.js';
import type { CheckContext } from '../../registry/block-module.js';
import { anchorProps, enumStr, LABEL, onProp, str } from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';
import { nodeAttributes, stringProp } from '../../render/block-helpers.js';
import type { AttributeValue } from '../../render/escape.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';

export const FILTER_BAR_TYPE = 'filter-bar';

/** The JSON type a control writes to state. */
export type ControlValueType = 'string' | 'number' | 'boolean';

/** One control type's binding and filtering contract. */
export interface ControlKind {
  type: string;
  valueType: ControlValueType;
  /** Filter operators the control may use inside a filter-bar; the first is the default. */
  matches: readonly string[];
}

/** Shown in place of a working control when scripts are off. */
export const REQUIRES_JS_NOTE = 'Interactive when JavaScript is on.';

/** Props shared by every control. `matches` decides whether `match` is a prop at all. */
export function controlProps(
  kind: ControlKind,
  value: PropSchema,
  extra: Record<string, PropSchema> = {},
): Record<string, PropSchema> {
  return {
    label: LABEL,
    bind: str({
      maxLength: 128,
      description: '`state.<key>` to write; the key must be declared in `state`.',
    }),
    value,
    ...extra,
    field: str({ maxLength: 64, description: 'Row field to filter (inside a filter-bar).' }),
    ...(kind.matches.length > 1
      ? { match: enumStr(kind.matches, { description: 'Filter operator (inside a filter-bar).' }) }
      : {}),
    hint: str({ maxLength: 200 }),
    on: onProp('Bindings fired with `{ value }` when the value changes.'),
    ...anchorProps,
  };
}

/** Where a control sits: inside a filter-bar (with its resolved target) or standalone. */
export interface ControlPlacement {
  bar?: IrNode;
  target?: IrNode;
}

export function placementOf(
  node: IrNode,
  byId: (id: string) => IrNode | undefined,
): ControlPlacement {
  const parent = node.parentId === null ? undefined : byId(node.parentId);
  if (parent === undefined || parent.type !== FILTER_BAR_TYPE) return {};
  const targetId = parent.props.target;
  const target = typeof targetId === 'string' ? byId(targetId) : undefined;
  return target === undefined ? { bar: parent } : { bar: parent, target };
}

/** The declared state key a valid `bind` names, or undefined. */
export function boundKey(node: IrNode, state: Record<string, JsonValue>): string | undefined {
  const bind = node.props.bind;
  if (typeof bind !== 'string' || !isSafeStatePath(bind)) return undefined;
  const parts = bind.split('.');
  const key = parts[1];
  if (parts.length !== 2 || key === undefined || !Object.hasOwn(state, key)) return undefined;
  return key;
}

/**
 * The value the control starts with: a bound, non-null state value wins over
 * the authored `value`, so the compiled page matches the state it boots with.
 */
export function initialValue(
  node: IrNode,
  state: Record<string, JsonValue>,
): JsonValue | undefined {
  const key = boundKey(node, state);
  if (key !== undefined) {
    const stateValue = state[key];
    if (stateValue !== null && stateValue !== undefined) return stateValue;
  }
  return node.props.value;
}

function scalarType(value: JsonValue): ControlValueType | 'null' | 'other' {
  if (value === null) return 'null';
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean' ? type : 'other';
}

/** `bind`: a two-segment safe state path whose key is declared, holding the right type. */
function checkBinding(node: IrNode, kind: ControlKind, context: CheckContext): void {
  const { bag, state } = context;
  const bind = node.props.bind;
  if (typeof bind !== 'string') return;
  const at = pathKey(node.path, 'bind');
  const parts = bind.split('.');
  if (!isSafeStatePath(bind) || parts.length !== 2) {
    bag.add({
      code: 'POLICY_VIOLATION',
      path: at,
      nodeId: node.id,
      message: `"${bind}" is not a state path of the form state.<key>`,
    });
    return;
  }
  const key = parts[1] ?? '';
  if (!Object.hasOwn(state, key)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: at,
      nodeId: node.id,
      message: `"state.${key}" is not declared in state`,
      details: { known: Object.keys(state) },
    });
    return;
  }
  const stateValue = state[key] as JsonValue;
  const type = scalarType(stateValue);
  if (type !== 'null' && type !== kind.valueType) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: at,
      nodeId: node.id,
      message: `a ${kind.type} writes a ${kind.valueType}, but "state.${key}" holds a ${type}`,
    });
  }
  const value = node.props.value;
  if (value !== undefined && stateValue !== null && value !== stateValue) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: pathKey(node.path, 'value'),
      nodeId: node.id,
      message: `"value" differs from "state.${key}"; the state value is used`,
    });
  }
}

/** `field` and `match`: required and checked inside a filter-bar, inert outside one. */
function checkFiltering(node: IrNode, placement: ControlPlacement, context: CheckContext): void {
  const { bag } = context;
  const field = node.props.field;
  if (placement.bar === undefined) {
    for (const key of ['field', 'match']) {
      if (node.props[key] === undefined) continue;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        severity: 'warning',
        path: pathKey(node.path, key),
        nodeId: node.id,
        message: `"${key}" only applies inside a filter-bar`,
      });
    }
    return;
  }
  if (typeof field !== 'string') {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: node.path,
      nodeId: node.id,
      message: `a ${node.type} inside a filter-bar needs "field", the row field it filters`,
    });
    return;
  }
  const data = placement.target?.data;
  if (data !== undefined && !data.fields.includes(field)) {
    reportUnknownField(field, data, pathKey(node.path, 'field'), context.bag, node.id);
  }
}

/** The checks every control runs; type-specific checks follow in each module. */
export function checkControl(node: IrNode, kind: ControlKind, context: CheckContext): void {
  checkBinding(node, kind, context);
  checkFiltering(
    node,
    placementOf(node, (id) => context.byId.get(id)),
    context,
  );
}

/**
 * Distinct, non-null values of one field, as option values: numbers in
 * numeric order first, then everything else by code unit. Deterministic and
 * locale-free.
 */
export function distinctFieldValues(rows: readonly DataRow[], field: string): string[] {
  const numbers = new Map<string, number>();
  const others = new Set<string>();
  for (const row of rows) {
    const value: DataScalar | undefined = Object.hasOwn(row, field) ? row[field] : undefined;
    if (value === null || value === undefined) continue;
    if (typeof value === 'number') numbers.set(String(value), value);
    else others.add(String(value));
  }
  const numeric = [...numbers.entries()].sort((a, b) => a[1] - b[1]).map(([text]) => text);
  const rest = [...others].filter((text) => !numbers.has(text)).sort(codeUnitCompare);
  return [...numeric, ...rest];
}

function codeUnitCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Wrapper attributes: identity, state binding and filter wiring. */
export function controlAttributes(
  node: IrNode,
  kind: ControlKind,
  context: RenderContext,
  className = 'ak-block ak-control',
): AttributeValue {
  const placement = placementOf(node, context.byId);
  const bound = boundKey(node, context.ir.state) !== undefined;
  const inBar = placement.bar !== undefined;
  const field = stringProp(node, 'field');
  return nodeAttributes(node, {
    class: className,
    'data-ak-control': kind.type,
    'data-ak-bind': bound ? stringProp(node, 'bind') : undefined,
    'data-ak-bind-target': bound ? 'state' : undefined,
    'data-ak-field': inBar && field !== '' ? field : undefined,
    'data-ak-match': inBar && field !== '' ? filterMatch(node, kind) : undefined,
  });
}

/** The operator the runtime applies; checkbox and switch filter on truthiness. */
export function filterMatch(node: IrNode, kind: ControlKind): string {
  if (kind.valueType === 'boolean') return 'truthy';
  return stringProp(node, 'match', kind.matches[0] ?? 'equals');
}

export function inputId(node: IrNode): string {
  return `${node.id}-input`;
}

export function hintId(node: IrNode): string {
  return `${node.id}-hint`;
}

/** `aria-describedby` for the native input, when a hint exists. */
export function describedBy(node: IrNode): string | undefined {
  return stringProp(node, 'hint') === '' ? undefined : hintId(node);
}

/** The hint, then the no-script note for a standalone control (a bar carries one note). */
export function controlFooter(node: IrNode, context: RenderContext): string {
  const hint = stringProp(node, 'hint');
  const inBar = placementOf(node, context.byId).bar !== undefined;
  return [
    hint === ''
      ? ''
      : `<p class="ak-control-hint" id="${escapeAttribute(hintId(node))}">${escapeText(hint)}</p>`,
    inBar ? '' : requiresJsNote(),
  ].join('');
}

export function requiresJsNote(): string {
  return `<p class="ak-control-note" data-ak-requires-js>${escapeText(REQUIRES_JS_NOTE)}</p>`;
}

export function visibleLabel(node: IrNode): string {
  return `<label for="${escapeAttribute(inputId(node))}">${escapeText(stringProp(node, 'label'))}</label>`;
}

/** True when the control sits in a filter-bar, so an empty choice means "no filter". */
export function inFilterBar(node: IrNode, context: RenderContext): boolean {
  return placementOf(node, context.byId).bar !== undefined;
}
