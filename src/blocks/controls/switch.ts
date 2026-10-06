/** Switch: an on/off setting, a native checkbox with `role="switch"`. */

import type { BlockModule } from '../../registry/block-module.js';
import { bool, define } from '../../registry/define-helpers.js';
import { renderToggle } from './checkbox.js';
import { type ControlKind, checkControl, controlProps } from './control-shared.js';

const KIND: ControlKind = { type: 'switch', valueType: 'boolean', matches: ['truthy'] };

export const switchBlock: BlockModule = {
  definition: define({
    type: 'switch',
    category: 'interaction',
    tags: ['input', 'boolean', 'toggle', 'state'],
    useCases: ['show or hide detail', 'turn a setting on'],
    purpose: 'On/off setting.',
    summary:
      'Switch: native checkbox with role="switch"; writes a boolean or filters to truthy rows.',
    props: controlProps(KIND, bool({ description: 'Initially on.' })),
    runtimeFeatures: ['controls'],
    actions: ['set-value'],
    a11y: 'Native checkbox with role="switch" and a visible <label>; Space toggles it.',
  }),
  render: (node, context) => renderToggle(node, KIND, context, true),
  check: (node, context) => checkControl(node, KIND, context),
};
