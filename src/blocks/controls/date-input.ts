/** Date input: an ISO calendar date; inside a filter-bar it sets an earliest or latest date. */

import { pathKey } from '../../diagnostics.js';
import type { BlockModule } from '../../registry/block-module.js';
import { define, str } from '../../registry/define-helpers.js';
import { type ControlKind, checkControl, controlProps, initialValue } from './control-shared.js';
import { renderFieldInput } from './field-input.js';

const KIND: ControlKind = {
  type: 'date-input',
  valueType: 'string',
  matches: ['min', 'max', 'equals'],
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Integer calendar math: Date.UTC maps years 0-99 to the 1900s.
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= days;
}

export const dateInputBlock: BlockModule = {
  definition: define({
    type: 'date-input',
    category: 'interaction',
    tags: ['input', 'date', 'state', 'filter'],
    useCases: ['pick a date', 'filter rows by date range'],
    purpose: 'Calendar date entry.',
    summary:
      'Date input: labeled native date field (YYYY-MM-DD); writes state or filters by range.',
    props: controlProps(KIND, str({ maxLength: 10, description: 'Initial date, YYYY-MM-DD.' })),
    runtimeFeatures: ['controls'],
    actions: ['set-value'],
    a11y: 'Native date <input> with a visible <label>; the platform picker is keyboard operable.',
  }),
  render: (node, context) => {
    const start = initialValue(node, context.ir.state);
    return renderFieldInput(node, KIND, context, {
      type: 'date',
      value: typeof start === 'string' && isIsoDate(start) ? start : undefined,
    });
  },
  check: (node, context) => {
    checkControl(node, KIND, context);
    const value = node.props.value;
    if (typeof value === 'string' && !isIsoDate(value)) {
      context.bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(node.path, 'value'),
        nodeId: node.id,
        message: `"${value}" is not a calendar date of the form YYYY-MM-DD`,
      });
    }
  },
};
