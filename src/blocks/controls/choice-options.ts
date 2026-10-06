/**
 * Options for the choice controls (select and radio-group): authored
 * `options`, or `optionsFrom`, the distinct values of one field of the
 * filter-bar's target. Inside a filter-bar the compiler adds an "All" choice
 * with the empty value, which means "no filter on this field".
 */

import { reportUnknownField } from '../../data/resolve-block-data.js';
import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject } from '../../json.js';
import type { CheckContext } from '../../registry/block-module.js';
import { list, obj, str } from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';
import { objectListProp } from '../../render/block-helpers.js';
import {
  type ControlPlacement,
  distinctFieldValues,
  initialValue,
  placementOf,
} from './control-shared.js';

export interface ChoiceOption {
  value: string;
  label: string;
}

/** The "no filter" choice a filter-bar adds in front of the authored options. */
export const ANY_OPTION: ChoiceOption = { value: '', label: 'All' };

export function choiceProps(maxOptions: number): Record<string, PropSchema> {
  return {
    options: list(
      obj({ value: str({ required: true, maxLength: 120 }), label: str({ maxLength: 120 }) }),
      { minItems: 1, maxItems: maxOptions, description: 'Choices; `label` defaults to `value`.' },
    ),
    optionsFrom: str({
      maxLength: 64,
      description: "Inside a filter-bar: use the target's distinct values of this field.",
    }),
  };
}

/** Authored options, or the target's distinct field values; no "All" choice. */
export function resolveOptions(node: IrNode, placement: ControlPlacement): ChoiceOption[] {
  const from = node.props.optionsFrom;
  if (typeof from === 'string') {
    const rows = placement.target?.data?.rows ?? [];
    return distinctFieldValues(rows, from).map((value) => ({ value, label: value }));
  }
  return objectListProp(node, 'options').map((option) => {
    const value = typeof option.value === 'string' ? option.value : '';
    return { value, label: typeof option.label === 'string' ? option.label : value };
  });
}

/** The value the control starts on: the initial value when it is a choice, else the first. */
export function selectedValue(
  options: readonly ChoiceOption[],
  initial: unknown,
): string | undefined {
  if (typeof initial === 'string' && options.some((option) => option.value === initial)) {
    return initial;
  }
  return options[0]?.value;
}

/** Choice-specific checks: one source of options, unique non-empty values, a valid start. */
export function checkChoices(node: IrNode, maxOptions: number, context: CheckContext): void {
  const { bag } = context;
  const placement = placementOf(node, (id) => context.byId.get(id));
  const from = node.props.optionsFrom;
  const authored = node.props.options;
  const add = (path: string, message: string, details?: Record<string, unknown>): void => {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path,
      nodeId: node.id,
      message,
      ...(details === undefined ? {} : { details }),
    });
  };

  // An absent list prop validates to [], so "authored" means a non-empty list.
  const hasOptions = Array.isArray(authored) && authored.length > 0;
  if ((typeof from === 'string') === hasOptions) {
    add(node.path, `a ${node.type} needs exactly one of "options" or "optionsFrom"`);
    return;
  }

  if (typeof from === 'string') {
    const at = pathKey(node.path, 'optionsFrom');
    if (placement.bar === undefined) {
      add(at, '"optionsFrom" only applies inside a filter-bar, which provides the rows');
      return;
    }
    const data = placement.target?.data;
    if (data === undefined) {
      add(at, '"optionsFrom" needs a filter-bar target that is bound to data');
      return;
    }
    if (!data.fields.includes(from)) {
      reportUnknownField(from, data, at, bag, node.id);
      return;
    }
    const count = distinctFieldValues(data.rows, from).length;
    if (count === 0 || count > maxOptions) {
      add(at, `"${from}" has ${count} distinct values; a ${node.type} takes 1-${maxOptions}`);
      return;
    }
  } else if (Array.isArray(authored)) {
    const seen = new Set<string>();
    authored.forEach((option, index) => {
      if (!isPlainObject(option) || typeof option.value !== 'string') return;
      const at = pathKey(pathIndex(pathKey(node.path, 'options'), index), 'value');
      if (option.value === '') add(at, 'an option value cannot be empty');
      else if (seen.has(option.value)) add(at, `duplicate option value "${option.value}"`);
      seen.add(option.value);
    });
  }

  const value = node.props.value;
  const allowed = resolveOptions(node, placement).map((option) => option.value);
  if (placement.bar !== undefined) allowed.unshift(ANY_OPTION.value);
  if (typeof value === 'string' && !allowed.includes(value)) {
    add(pathKey(node.path, 'value'), `"${value}" is not one of the options`, { allowed });
  }
  const start = initialValue(node, context.state);
  if (typeof start === 'string' && start !== value && !allowed.includes(start)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: pathKey(node.path, 'bind'),
      nodeId: node.id,
      message: `the bound state value "${start}" is not one of the options`,
      details: { allowed },
    });
  }
}
