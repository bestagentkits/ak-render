/** Checkbox: a native on/off input that writes a boolean or filters to truthy rows. */

import type { IrNode } from '../../ir.js';
import type { BlockModule } from '../../registry/block-module.js';
import { bool, define } from '../../registry/define-helpers.js';
import { element, stringProp } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText, renderAttributes } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import {
  type ControlKind,
  checkControl,
  controlAttributes,
  controlFooter,
  controlProps,
  describedBy,
  initialValue,
  inputId,
} from './control-shared.js';

const KIND: ControlKind = { type: 'checkbox', valueType: 'boolean', matches: ['truthy'] };

/**
 * The checkbox markup, shared with `switch`: the input comes first so the
 * label sits beside it, and the whole row is the touch target.
 */
export function renderToggle(
  node: IrNode,
  kind: ControlKind,
  context: RenderContext,
  asSwitch: boolean,
): string {
  const checked = initialValue(node, context.ir.state) === true;
  const id = inputId(node);
  const input = `<input${renderAttributes({
    type: 'checkbox',
    id,
    role: asSwitch ? 'switch' : undefined,
    checked,
    disabled: true,
    'aria-describedby': describedBy(node),
  })} />`;
  return element(
    'div',
    controlAttributes(node, kind, context, `ak-block ak-control${asSwitch ? ' ak-switch' : ''}`),
    [
      `<div class="ak-choice">${input}<label for="${escapeAttribute(id)}">${escapeText(
        stringProp(node, 'label'),
      )}</label></div>`,
      controlFooter(node, context),
    ].join(''),
  );
}

export const checkboxBlock: BlockModule = {
  definition: define({
    type: 'checkbox',
    category: 'interaction',
    tags: ['input', 'boolean', 'state', 'filter'],
    useCases: ['opt in to detail', 'filter to flagged rows'],
    purpose: 'Native on/off choice.',
    summary: 'Checkbox: labeled native checkbox; writes a boolean or filters to truthy rows.',
    props: controlProps(KIND, bool({ description: 'Initially checked.' })),
    runtimeFeatures: ['controls'],
    actions: ['set-value'],
    a11y: 'Native checkbox with a visible <label>; Space toggles it.',
  }),
  render: (node, context) => renderToggle(node, KIND, context, false),
  check: (node, context) => checkControl(node, KIND, context),
};
