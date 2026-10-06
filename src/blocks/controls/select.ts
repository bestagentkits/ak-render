/** Select: a native drop-down that writes one string to state or filters by equality. */

import type { BlockModule } from '../../registry/block-module.js';
import { define, str } from '../../registry/define-helpers.js';
import { element } from '../../render/block-helpers.js';
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
  inputId,
  placementOf,
  visibleLabel,
} from './control-shared.js';

const MAX_OPTIONS = 50;
const KIND: ControlKind = { type: 'select', valueType: 'string', matches: ['equals'] };

export const selectBlock: BlockModule = {
  definition: define({
    type: 'select',
    category: 'interaction',
    tags: ['input', 'choice', 'state', 'filter'],
    useCases: ['switch a view', 'filter by category'],
    purpose: 'Native drop-down choice.',
    summary: 'Select: labeled native <select> that writes state or filters in a filter-bar.',
    props: controlProps(
      KIND,
      str({ maxLength: 120, description: 'Initial choice.' }),
      choiceProps(MAX_OPTIONS),
    ),
    runtimeFeatures: ['controls'],
    actions: ['set-value'],
    a11y: 'Native <select> with a visible <label>; keyboard behavior is the platform default.',
  }),
  render: (node, context) => {
    const placement = placementOf(node, context.byId);
    const options = resolveOptions(node, placement);
    if (placement.bar !== undefined) options.unshift(ANY_OPTION);
    const selected = selectedValue(options, initialValue(node, context.ir.state));
    const markup = options
      .map(
        (option) =>
          `<option${renderAttributes({
            value: option.value,
            selected: option.value === selected,
          })}>${escapeText(option.label)}</option>`,
      )
      .join('');
    return element(
      'div',
      controlAttributes(node, KIND, context),
      [
        visibleLabel(node),
        `<select${renderAttributes({
          id: inputId(node),
          disabled: true,
          'aria-describedby': describedBy(node),
        })}>${markup}</select>`,
        controlFooter(node, context),
      ].join(''),
    );
  },
  check: (node, context) => {
    checkControl(node, KIND, context);
    checkChoices(node, MAX_OPTIONS, context);
  },
};
