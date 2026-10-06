/**
 * The markup the single-field inputs share (text, number and date): a visible
 * label, the native input, the hint and the no-script note.
 */

import type { IrNode } from '../../ir.js';
import { element } from '../../render/block-helpers.js';
import { type AttributeValue, renderAttributes } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import {
  type ControlKind,
  controlAttributes,
  controlFooter,
  describedBy,
  inputId,
  visibleLabel,
} from './control-shared.js';

export function renderFieldInput(
  node: IrNode,
  kind: ControlKind,
  context: RenderContext,
  input: AttributeValue,
): string {
  return element(
    'div',
    controlAttributes(node, kind, context),
    [
      visibleLabel(node),
      `<input${renderAttributes({
        ...input,
        id: inputId(node),
        disabled: true,
        'aria-describedby': describedBy(node),
      })} />`,
      controlFooter(node, context),
    ].join(''),
  );
}
