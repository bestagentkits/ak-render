/** Radio group: a short list of exclusive choices in a fieldset. */

import type { BlockModule } from '../../registry/block-module.js';
import { define, str } from '../../registry/define-helpers.js';
import { element, stringProp } from '../../render/block-helpers.js';
import { escapeText, renderAttributes } from '../../render/escape.js';
import {
  ANY_OPTION,
  checkChoices,
  choiceProps,
  resolveOptions,
  selectedValue,
} from './choice-options.js';
import {
  type ControlKind,
  checkControl,
  controlAttributes,
  controlFooter,
  controlProps,
  describedBy,
  initialValue,
  placementOf,
} from './control-shared.js';

const MAX_OPTIONS = 8;
const KIND: ControlKind = { type: 'radio-group', valueType: 'string', matches: ['equals'] };

export const radioGroupBlock: BlockModule = {
  definition: define({
    type: 'radio-group',
    category: 'interaction',
    tags: ['input', 'choice', 'state', 'filter'],
    useCases: ['pick one of a few', 'segment a view'],
    purpose: 'Exclusive choice among up to 8 options.',
    summary: 'Radio group: native radios in a fieldset; writes state or filters in a filter-bar.',
    props: controlProps(
      KIND,
      str({ maxLength: 120, description: 'Initial choice.' }),
      choiceProps(MAX_OPTIONS),
    ),
    runtimeFeatures: ['controls'],
    actions: ['set-value'],
    a11y: '<fieldset> with a visible <legend>; native radios move with the arrow keys.',
  }),
  render: (node, context) => {
    const placement = placementOf(node, context.byId);
    const options = resolveOptions(node, placement);
    if (placement.bar !== undefined) options.unshift(ANY_OPTION);
    const selected = selectedValue(options, initialValue(node, context.ir.state));
    const radios = options
      .map((option, index) => {
        const id = `${node.id}-option-${index}`;
        const input = `<input${renderAttributes({
          type: 'radio',
          id,
          name: node.id,
          value: option.value,
          checked: option.value === selected,
          disabled: true,
        })} />`;
        return `<div class="ak-choice">${input}<label for="${id}">${escapeText(option.label)}</label></div>`;
      })
      .join('');
    return element(
      'fieldset',
      {
        ...controlAttributes(node, KIND, context),
        'aria-describedby': describedBy(node),
      },
      [
        `<legend>${escapeText(stringProp(node, 'label'))}</legend>`,
        `<div class="ak-choice-list">${radios}</div>`,
        controlFooter(node, context),
      ].join(''),
    );
  },
  check: (node, context) => {
    checkControl(node, KIND, context);
    checkChoices(node, MAX_OPTIONS, context);
  },
};
