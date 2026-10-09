/**
 * Feedback: the panel that collects the reader's comments and decision
 * answers into one text to paste back to the agent. Its presence turns on
 * commenting for the whole page: the reader selects text, or uses the Comment
 * button on a top-level section.
 *
 * Comments are kept in `localStorage` under a key derived from the page's
 * content, so a reload keeps them and a recompiled page starts empty.
 */

import { stableHash } from '../../hash.js';
import type { IrNode } from '../../ir.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import { anchorProps, OPTIONAL_TITLE, semantic, txt } from '../../registry/define-helpers.js';
import { element, heading, nodeAttributes, str } from '../../render/block-helpers.js';
import { escapeInlineText, renderAttributes } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { FEEDBACK_TYPE, REVIEW_REQUIRES_JS_NOTE } from './review-shared.js';

const DEFAULT_TITLE = 'Your feedback';
const DEFAULT_TEXT =
  'Select any text on the page, or use a section’s **Comment** button, to leave a comment. Then copy your feedback and paste it back to the agent.';

function check(node: IrNode, { bag, byId }: CheckContext): void {
  const first = [...byId.values()].find((other) => other.type === FEEDBACK_TYPE);
  if (first !== undefined && first !== node) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: node.path,
      nodeId: node.id,
      message: `a page has one feedback block; block "${first.id}" is already one`,
    });
  }
}

function render(node: IrNode, context: RenderContext): string {
  const generalId = `${node.id}-general`;
  return element(
    'section',
    nodeAttributes(node, {
      class: 'ak-block ak-feedback',
      'data-ak-feedback': '',
      'data-ak-review-key': stableHash(JSON.stringify(context.ir.nodes)),
    }),
    [
      heading(2, str(node.props.title, DEFAULT_TITLE)),
      `<p class="ak-feedback-intro">${escapeInlineText(str(node.props.text, DEFAULT_TEXT))}</p>`,
      '<ol class="ak-feedback-list" data-ak-feedback-list></ol>',
      `<div class="ak-feedback-general"><label for="${generalId}">General notes</label><textarea${renderAttributes(
        { id: generalId, rows: 3, disabled: true, 'data-ak-feedback-general': '' },
      )}></textarea></div>`,
      '<div class="ak-feedback-actions">',
      '<button type="button" class="ak-btn" data-variant="primary" data-ak-feedback-copy disabled>Copy feedback</button>',
      '<button type="button" class="ak-btn" data-variant="ghost" data-ak-feedback-clear disabled>Clear</button>',
      '</div>',
      `<p class="ak-review-nojs">${REVIEW_REQUIRES_JS_NOTE}</p>`,
    ].join(''),
  );
}

export const feedbackBlock: BlockModule = {
  definition: semantic({
    type: FEEDBACK_TYPE,
    category: 'interaction',
    tags: ['comments', 'review', 'plan', 'prompt', 'copy'],
    useCases: ['let the reader comment on a plan', 'collect decision answers for the agent'],
    purpose:
      'Turns on page comments and copies them, with decision answers, as one prompt for the agent.',
    summary:
      'Feedback: one per page, last; turns on comments and copies them with decision answers.',
    props: {
      title: OPTIONAL_TITLE,
      text: txt({ maxLength: 400 }),
      ...anchorProps,
    },
    runtimeFeatures: ['review', 'copy'],
    a11y: 'Comment editors are labelled dialogs that return focus; every change is announced through the live region.',
  }),
  render,
  check,
};
