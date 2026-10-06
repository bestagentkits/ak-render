/**
 * Annotated image: numbered pins over an image, and the same notes as an
 * ordered list below it. The list is the accessible and printable form; the
 * pins only point at where each note applies.
 */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import {
  anchorProps,
  list,
  num,
  obj,
  semantic,
  str as strProp,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import {
  element,
  figureCaption,
  nodeAttributes,
  objectListProp,
  resolveMedia,
  str,
  stringProp,
} from '../../render/block-helpers.js';
import { escapeAttribute, escapeInlineText, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';

export const ANNOTATION_LIMITS = { maxNotes: 12 } as const;
/** Pin coordinates snap to this many percent, so the stylesheet needs 21 positions per axis. */
export const PIN_STEP = 5;

/** A pin coordinate in percent, clamped to 0–100 and snapped to `PIN_STEP`. */
export function quantizePin(value: number): number {
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(clamped / PIN_STEP) * PIN_STEP;
}

function check(node: IrNode, { bag }: CheckContext): void {
  objectListProp(node, 'notes').forEach((note, index) => {
    for (const axis of ['x', 'y'] as const) {
      const value = note[axis];
      if (typeof value !== 'number') continue;
      const snapped = quantizePin(value);
      if (snapped === value) continue;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        severity: 'warning',
        path: pathKey(pathIndex(pathKey(node.path, 'notes'), index), axis),
        nodeId: node.id,
        message: `${axis} ${value} snaps to ${snapped}: pins sit on a ${PIN_STEP}% grid`,
        details: { value, snapped },
      });
    }
  });
}

function render(node: IrNode, context: RenderContext): string {
  const notes = objectListProp(node, 'notes');
  const alt = stringProp(node, 'alt');
  const resolved = resolveMedia(stringProp(node, 'src'), context.ir.policy.network, 'images');
  // Validation rejects a blocked remote source; the link keeps a hand-built IR safe.
  const picture = resolved.allowed
    ? `<img src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(alt)}" decoding="async" />`
    : `<a class="ak-annotated-blocked" href="${escapeAttribute(resolved.src)}" rel="noreferrer noopener">${escapeText(alt)}</a>`;
  const pins = notes
    .map((note, index) => {
      const x = quantizePin(typeof note.x === 'number' ? note.x : 0);
      const y = quantizePin(typeof note.y === 'number' ? note.y : 0);
      return `<li class="ak-pin" data-x="${x}" data-y="${y}">${index + 1}</li>`;
    })
    .join('');
  const list = notes
    .map((note, index) => {
      const text = str(note.text);
      return `<li><span class="ak-pin-number" aria-hidden="true">${index + 1}</span><p><strong>${escapeText(
        str(note.label),
      )}</strong>${text === '' ? '' : ` ${escapeInlineText(text)}`}</p></li>`;
    })
    .join('');
  return element(
    'figure',
    nodeAttributes(node, { class: 'ak-block ak-annotated' }),
    [
      `<div class="ak-annotated-stage">${picture}${
        resolved.allowed ? `<ol class="ak-annotated-pins" aria-hidden="true">${pins}</ol>` : ''
      }</div>`,
      figureCaption(stringProp(node, 'caption')),
      `<ol class="ak-annotated-notes">${list}</ol>`,
    ].join(''),
  );
}

const COORDINATE = (axis: string): ReturnType<typeof num> =>
  num({
    required: true,
    min: 0,
    max: 100,
    description: `${axis} position in percent of the image; snapped to ${PIN_STEP}.`,
  });

export const annotatedImageBlock: BlockModule = {
  definition: semantic({
    type: 'annotated-image',
    category: 'media',
    tags: ['screenshot', 'callouts', 'pins', 'evidence'],
    useCases: ['explain a screenshot', 'point out a defect'],
    purpose: 'An image with numbered pins and the matching list of notes.',
    summary:
      'Annotated image: numbered pins at x/y percent over an image, plus the notes as a list.',
    props: {
      src: urlProp({ required: true, asset: 'images', rejectBlocked: true }),
      alt: strProp({ required: true, maxLength: 300 }),
      caption: txt(),
      notes: list(
        obj({
          x: COORDINATE('Horizontal'),
          y: COORDINATE('Vertical'),
          label: strProp({ required: true, maxLength: 120 }),
          text: txt({ maxLength: 600 }),
        }),
        { required: true, minItems: 1, maxItems: ANNOTATION_LIMITS.maxNotes },
      ),
      ...anchorProps,
    },
    network: 'optional',
    assets: ['media'],
    runtimeFeatures: ['annotated-image'],
    a11y: 'Alt text is required; pins are hidden from assistive technology because the numbered list states every note.',
  }),
  render,
  check,
};
