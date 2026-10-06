/** Text input: a bounded single-line string; inside a filter-bar it matches by substring. */

import type { BlockModule } from '../../registry/block-module.js';
import { define, num, str } from '../../registry/define-helpers.js';
import { numberProp, stringProp } from '../../render/block-helpers.js';
import { type ControlKind, checkControl, controlProps, initialValue } from './control-shared.js';
import { renderFieldInput } from './field-input.js';

const MAX_LENGTH = 200;
const KIND: ControlKind = {
  type: 'text-input',
  valueType: 'string',
  matches: ['contains', 'equals'],
};

export const textInputBlock: BlockModule = {
  definition: define({
    type: 'text-input',
    category: 'interaction',
    tags: ['input', 'text', 'state', 'filter'],
    useCases: ['enter a name', 'filter rows by text'],
    purpose: 'Single-line text entry.',
    summary: 'Text input: labeled native text field; writes state or filters rows by substring.',
    props: controlProps(KIND, str({ maxLength: MAX_LENGTH, description: 'Initial text.' }), {
      placeholder: str({ maxLength: 120 }),
      maxLength: num({ min: 1, max: MAX_LENGTH, integer: true, default: MAX_LENGTH }),
    }),
    runtimeFeatures: ['controls'],
    actions: ['set-value'],
    a11y: 'Native text <input> with a visible <label>; the placeholder never replaces it.',
  }),
  render: (node, context) => {
    const start = initialValue(node, context.ir.state);
    const placeholder = stringProp(node, 'placeholder');
    return renderFieldInput(node, KIND, context, {
      type: 'text',
      value: typeof start === 'string' ? start : '',
      maxlength: String(numberProp(node, 'maxLength', MAX_LENGTH)),
      placeholder: placeholder === '' ? undefined : placeholder,
      autocomplete: 'off',
      spellcheck: 'false',
    });
  },
  check: (node, context) => checkControl(node, KIND, context),
};
