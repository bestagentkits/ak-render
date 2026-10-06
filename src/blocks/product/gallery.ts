/**
 * Gallery block: a responsive image grid with a lightbox.
 *
 * The grid crops thumbnails to 16:9, so the compiler always offers the full
 * image: there is no author flag. Each displayed thumbnail links to a full-size
 * figure (`#ak-lb-<id>-<n>`) in a set after the grid. Without scripts the set
 * is hidden and the targeted figure opens as a CSS `:target` overlay with
 * previous, next and close links. The `lightbox` runtime upgrades the same
 * markup to a modal `<dialog>`. Print shows the grid only, which already holds
 * every image.
 */

import type { JsonValue } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  itemsOf,
  num,
  OPTIONAL_TITLE,
  semantic,
  str as strProp,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  numberProp,
  objectListProp,
  resolveMedia,
  str,
  stringProp,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeAttribute, escapeInlineText, escapeText } from '../../render/escape.js';

interface Shown {
  src: string;
  alt: string;
  caption: string;
  /** `ak-lb-<node id>-<1-based position among shown images>`. */
  anchor: string;
}

function caption(text: string): string {
  return text === '' ? '' : `<figcaption>${escapeInlineText(text)}</figcaption>`;
}

function image(entry: Shown, loading = 'lazy'): string {
  return `<img src="${escapeAttribute(entry.src)}" alt="${escapeAttribute(
    entry.alt,
  )}" loading="${loading}" decoding="async" />`;
}

/** The full-size figures, one per shown image, with wrap-around navigation. */
function lightboxSet(shown: readonly Shown[], label: string): string {
  const figures = shown.map((entry, index) => {
    const previous = shown[(index - 1 + shown.length) % shown.length] ?? entry;
    const next = shown[(index + 1) % shown.length] ?? entry;
    const navigation =
      shown.length > 1
        ? `<a class="ak-lightbox-step" data-ak-lightbox-step="-1" href="#${previous.anchor}">Previous<span class="ak-sr"> image</span></a><a class="ak-lightbox-step" data-ak-lightbox-step="1" href="#${next.anchor}">Next<span class="ak-sr"> image</span></a>`
        : '';
    return `<figure class="ak-lightbox-figure" id="${entry.anchor}" data-ak-lightbox-index="${index}" aria-label="Image ${
      index + 1
    } of ${shown.length}">${image(entry)}${caption(
      entry.caption,
    )}<p class="ak-lightbox-bar"><span class="ak-lightbox-count">${index + 1} / ${
      shown.length
    }</span>${navigation}<a class="ak-lightbox-close" data-ak-lightbox-close="" href="#${
      entry.anchor
    }-thumb">Close<span class="ak-sr"> image viewer</span></a></p></figure>`;
  });
  return `<div class="ak-lightbox" data-ak-lightbox-label="${escapeAttribute(label)}">${figures.join(
    '',
  )}</div>`;
}

export const galleryBlock: BlockModule = {
  definition: semantic({
    type: 'gallery',
    category: 'media',
    tags: ['images', 'grid', 'lightbox'],
    useCases: ['screenshot set', 'photo grid'],
    purpose: 'Image grid.',
    summary: 'Gallery: responsive image grid with captions; thumbnails open full size.',
    props: {
      title: OPTIONAL_TITLE,
      columns: num({ integer: true, min: 1, max: 6, default: 3 }),
      items: itemsOf({
        src: urlProp({ required: true, asset: 'images' }),
        alt: strProp({ required: true, maxLength: 300 }),
        caption: txt(),
      }),
      ...anchorProps,
    },
    runtimeFeatures: ['lightbox'],
    network: 'optional',
    assets: ['media'],
    a11y: 'Every image keeps its alt text; captions are visible text, not tooltips. The full-size viewer is a modal dialog with keyboard navigation that returns focus to its thumbnail, and plain links without scripts.',
  }),
  render: (node, context) => {
    const columns = Math.min(Math.max(numberProp(node, 'columns', 3), 1), 6);
    const items = objectListProp(node, 'items');
    const shown: Shown[] = [];
    const cells = items.map((item: Record<string, JsonValue>) => {
      const resolved = resolveMedia(str(item.src), context.ir.policy.network, 'images');
      const captionText = str(item.caption);
      if (!resolved.allowed) {
        return `<li><figure><a href="${escapeAttribute(resolved.src)}" rel="noreferrer noopener">${escapeText(
          str(item.alt),
        )}</a>${caption(captionText)}</figure></li>`;
      }
      const entry: Shown = {
        src: resolved.src,
        alt: str(item.alt),
        caption: captionText,
        anchor: `ak-lb-${node.id}-${shown.length + 1}`,
      };
      shown.push(entry);
      return `<li><figure><a class="ak-lightbox-thumb" id="${entry.anchor}-thumb" href="#${
        entry.anchor
      }">${image(entry)}<span class="ak-sr"> (open full size)</span></a>${caption(
        captionText,
      )}</figure></li>`;
    });
    const title = stringProp(node, 'title');
    return element(
      'section',
      nodeAttributes(node, {
        class: 'ak-block',
        ...(shown.length > 0 ? { 'data-ak-lightbox-root': true } : {}),
      }),
      [
        titleHeader(node),
        `<ul class="ak-gallery" data-ak-columns="${columns}">${cells.join('')}</ul>`,
        shown.length > 0 ? lightboxSet(shown, title === '' ? 'Image viewer' : title) : '',
      ].join(''),
    );
  },
};
