/** Number input: a bounded number; inside a filter-bar it sets a minimum or maximum. */

import { pathKey } from '../../diagnostics.js';
import type { BlockModule } from '../../registry/block-module.js';
import { define, num } from '../../registry/define-helpers.js';
import { type ControlKind, checkControl, controlProps, initialValue } from './control-shared.js';
import { renderFieldInput } from './field-input.js';

const BOUND = 1_000_000_000;
const KIND: ControlKind = {
  type: 'number-input',
  valueType: 'number',
  matches: ['min', 'max', 'equals'],
};

const optionalNumber = (value: unknown): string | undefined =>
  typeof value === 'number' ? String(value) : undefined;

export const numberInputBlock: BlockModule = {
  definition: define({
    type: 'number-input',
    category: 'interaction',
    tags: ['input', 'number', 'state', 'filter', 'threshold'],
    useCases: ['enter a quantity', 'filter rows by threshold'],
    purpose: 'Bounded numeric entry.',
    summary: 'Number input: labeled native number field; writes state or filters by min/max.',
    props: controlProps(KIND, num({ min: -BOUND, max: BOUND, description: 'Initial number.' }), {
      min: num({ min: -BOUND, max: BOUND }),
      max: num({ min: -BOUND, max: BOUND }),
      step: num({ min: 0.0001, max: BOUND }),
    }),
    runtimeFeatures: ['controls'],
    actions: ['set-value'],
    a11y: 'Native number <input> with a visible <label>; arrow keys step the value.',
  }),
  render: (node, context) => {
    const start = initialValue(node, context.ir.state);
    return renderFieldInput(node, KIND, context, {
      type: 'number',
      inputmode: 'decimal',
      value: optionalNumber(start),
      min: optionalNumber(node.props.min),
      max: optionalNumber(node.props.max),
      step: optionalNumber(node.props.step) ?? 'any',
    });
  },
  check: (node, context) => {
    checkControl(node, KIND, context);
    const { min, max, value } = node.props;
    const report = (key: string, message: string): void =>
      context.bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(node.path, key),
        nodeId: node.id,
        message,
      });
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      report('min', `"min" (${min}) is greater than "max" (${max})`);
      return;
    }
    if (typeof value !== 'number') return;
    if (typeof min === 'number' && value < min) report('value', `"value" is below "min" (${min})`);
    if (typeof max === 'number' && value > max) report('value', `"value" is above "max" (${max})`);
  },
};
