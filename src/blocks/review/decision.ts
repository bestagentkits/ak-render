/**
 * Decision: a question the reader answers by picking one option, with an
 * optional note. The recommended option starts checked. The `feedback` block
 * copies every answer, so a page with a decision must have one.
 */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import { anchorProps, bool, itemsOf, LABEL, semantic, txt } from '../../registry/define-helpers.js';
import { element, nodeAttributes, objectListProp, str } from '../../render/block-helpers.js';
import { escapeInlineText, escapeText, renderAttributes } from '../../render/escape.js';
import { FEEDBACK_TYPE, REVIEW_REQUIRES_JS_NOTE } from './review-shared.js';

const MAX_OPTIONS = 6;

function check(node: IrNode, { bag, byId }: CheckContext): void {
  const options = objectListProp(node, 'options');
  const recommended = options.filter((option) => option.recommended === true);
  if (recommended.length > 1) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(node.path, 'options'),
      nodeId: node.id,
      message: 'a decision recommends at most one option',
    });
  }
  options.forEach((option, index) => {
    const label = str(option.label);
    if (options.findIndex((other) => str(other.label) === label) !== index) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(pathIndex(pathKey(node.path, 'options'), index), 'label'),
        nodeId: node.id,
        message: `option "${label}" is listed twice`,
      });
    }
  });
  if (![...byId.values()].some((other) => other.type === FEEDBACK_TYPE)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: node.path,
      nodeId: node.id,
      message: 'a decision needs a "feedback" block on the page, which copies the answers',
    });
  }
}

function render(node: IrNode): string {
  const options = objectListProp(node, 'options')
    .map((option, index) => {
      const id = `${node.id}-option-${index}`;
      const recommended = option.recommended === true;
      const text = str(option.text);
      return [
        '<div class="ak-decision-option">',
        `<input${renderAttributes({
          type: 'radio',
          id,
          name: node.id,
          value: str(option.label),
          checked: recommended,
          disabled: true,
          'data-ak-recommended': recommended,
        })} />`,
        `<label for="${id}"><span class="ak-decision-label">${escapeText(str(option.label))}${
          recommended ? ' <span class="ak-badge" data-tone="info">Recommended</span>' : ''
        }</span>${text === '' ? '' : `<span class="ak-decision-text">${escapeInlineText(text)}</span>`}</label>`,
        '</div>',
      ].join('');
    })
    .join('');
  const context = str(node.props.text);
  const noteId = `${node.id}-note`;
  return element(
    'fieldset',
    nodeAttributes(node, { class: 'ak-block ak-decision', 'data-ak-decision': '' }),
    [
      `<legend>${escapeText(str(node.props.question))}</legend>`,
      context === '' ? '' : `<p class="ak-decision-context">${escapeInlineText(context)}</p>`,
      `<div class="ak-decision-options">${options}</div>`,
      `<div class="ak-decision-note"><label for="${noteId}">Note</label><textarea${renderAttributes(
        { id: noteId, rows: 2, disabled: true, 'data-ak-decision-note': '' },
      )}></textarea></div>`,
      `<p class="ak-review-nojs">${REVIEW_REQUIRES_JS_NOTE}</p>`,
    ].join(''),
  );
}

export const decisionBlock: BlockModule = {
  definition: semantic({
    type: 'decision',
    category: 'interaction',
    tags: ['question', 'choice', 'plan', 'review', 'feedback'],
    useCases: ['plan fork the reader must pick', 'trade-off that needs a human call'],
    purpose: 'A question the reader answers by picking one option; the feedback block copies it.',
    summary:
      'Decision: question, context, up to 6 options (one may be recommended) and a note; needs a feedback block.',
    props: {
      question: LABEL,
      text: txt({ maxLength: 600 }),
      options: itemsOf(
        {
          label: LABEL,
          text: txt({ maxLength: 400 }),
          recommended: bool({ description: 'Starts checked and carries a Recommended badge.' }),
        },
        { minItems: 2, maxItems: MAX_OPTIONS },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['review'],
    a11y: 'A <fieldset> whose <legend> is the question; native radios move with the arrow keys, and the note has a visible label.',
  }),
  render,
  check,
};
