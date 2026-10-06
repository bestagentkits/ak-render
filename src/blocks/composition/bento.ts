/** Bento block: a feature mosaic of mixed-size tiles. */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  enumStr,
  itemsOf,
  OPTIONAL_TITLE,
  semantic,
  str as strProp,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  titleHeader,
} from '../../render/block-helpers.js';
import { renderAttributes } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { framedImage, paragraph, prose } from '../../render/showcase-blocks.js';
import { checkItemContent, nestedBlocks, renderItemBlocks } from './nestable-blocks.js';

const TILE_SIZES = new Set(['small', 'wide', 'tall', 'large']);

function renderBento(node: IrNode, context: RenderContext): string {
  const tiles = objectListProp(node, 'items').map((item, index) => {
    const size = TILE_SIZES.has(str(item.size)) ? str(item.size) : 'small';
    const source = str(item.src);
    const media =
      source === ''
        ? ''
        : `<div class="ak-tile-media">${framedImage(source, str(item.alt), context.ir.policy.network)}</div>`;
    const body = [
      paragraph('ak-eyebrow', str(item.eyebrow)),
      paragraph('ak-tile-value', str(item.value)),
      paragraph('ak-tile-title', str(item.title)),
      prose('ak-tile-text', str(item.text)),
      renderItemBlocks(node, index, context),
    ].join('');
    return `<li${renderAttributes({
      class: 'ak-tile',
      'data-size': size,
      'data-media': source === '' ? undefined : 'true',
    })}>${media}<div class="ak-tile-body">${body}</div></li>`;
  });
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-bento-block' }),
    `${titleHeader(node)}<ul class="ak-bento">${tiles.join('')}</ul>`,
  );
}

export const bentoBlock: BlockModule = {
  definition: semantic({
    type: 'bento',
    category: 'showcase',
    tags: ['mosaic', 'tiles', 'features'],
    useCases: ['feature highlights', 'product overview'],
    purpose: 'Feature mosaic: tiles of mixed size that each carry one idea, figure, or image.',
    summary:
      'Bento: asymmetric tile grid; a tile can hold an eyebrow, title, text, a large figure, and a local image.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf(
        {
          title: OPTIONAL_TITLE,
          text: txt(),
          eyebrow: strProp({ maxLength: 60 }),
          value: strProp({ maxLength: 40, description: 'A large figure shown above the title.' }),
          size: enumStr(['small', 'wide', 'tall', 'large'], { default: 'small' }),
          src: urlProp({
            asset: 'images',
            description: 'Optional image; remote sources follow the network policy.',
          }),
          alt: strProp({
            maxLength: 300,
            description: 'Required when src is set; use "" for a decorative image.',
          }),
          blocks: nestedBlocks('title', 6),
        },
        { minItems: 1, maxItems: 12 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['bento'],
    network: 'optional',
    sizing: {
      sizes: ['large'],
      default: 'large',
      responsive:
        'Four columns on wide screens, two on tablets, one on phones; spans collapse with the grid.',
    },
    a11y: 'A list of tiles; each tile title is a heading-styled paragraph, images keep their alt text.',
  }),
  render: renderBento,
  // A tile image follows the image block's rule: alt must be present, and an
  // explicitly empty alt marks the image as decorative.
  check(node, context) {
    checkItemContent(node, context, 'title', 'a bento tile needs a title or blocks');
    const { bag } = context;
    if (!Array.isArray(node.props.items)) return;
    node.props.items.forEach((item, index) => {
      if (!isPlainObject(item) || typeof item.src !== 'string') return;
      if (typeof item.alt === 'string') return;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        message: 'a bento tile with src needs alt text (use "" for a decorative image)',
        path: pathKey(pathIndex(pathKey(node.path, 'items'), index), 'alt'),
        nodeId: node.id,
      });
    });
  },
};
