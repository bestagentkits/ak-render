/**
 * Rendering and cross-field checks for one social post card.
 *
 * Everything the card shows is supplied text. Counts use the deterministic
 * compact format, dates are shown as supplied (never "2h ago"), and every
 * remote avatar or media file passes the page's network gate, falling back to
 * initials or a described placeholder with a link when it is blocked.
 */

import { formatValue } from '../../data/format-value.js';
import { renderIcon } from '../../icons/icon-render.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import type { CheckContext } from '../../registry/block-module.js';
import { blockedReason, resolveMedia } from '../../render/block-helpers.js';
import { escapeAttribute, escapeInlineText, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { imageReferenceAllowed, isRemote } from '../../spec/network-policy.js';
import { EMBED_PROVIDERS, hostMatchesProvider } from '../../spec/providers.js';
import { isIsoDate } from '../editorial/editorial-helpers.js';
import { authoredLink, avatar } from '../product/product-helpers.js';
import { PLATFORM_LABELS, PLATFORMS, type Platform } from './social-fields.js';

type Post = Record<string, JsonValue>;

const text = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');
const record = (value: JsonValue | undefined): Post => (isPlainObject(value) ? value : {});
const records = (value: JsonValue | undefined): Post[] =>
  Array.isArray(value) ? (value.filter(isPlainObject) as Post[]) : [];

function platformOf(post: Post): Platform {
  const value = text(post.platform);
  return (PLATFORMS as readonly string[]).includes(value) ? (value as Platform) : 'other';
}

/** Marks in the pinned icon packs; other platforms show their name alone. */
const PLATFORM_ICONS: Partial<Record<Platform, string>> = {
  x: 'brand-x',
  linkedin: 'brand-linkedin',
  youtube: 'brand-youtube',
};

// ---------------------------------------------------------------------------
// Dates

const ISO_DATETIME =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/u;

interface ParsedDate {
  datetime: string;
  label: string;
}

/**
 * Read a supplied ISO date or datetime without a clock or a locale. The label
 * keeps the author's zone: `Z` reads as UTC, an offset is written out.
 */
export function parsePostDate(value: string): ParsedDate | undefined {
  if (isIsoDate(value)) return { datetime: value, label: value };
  const match = ISO_DATETIME.exec(value);
  if (match === null) return undefined;
  const [, date = '', hour = '', minute = '', second, zone] = match;
  if (!isIsoDate(date) || Number(hour) > 23 || Number(minute) > 59) return undefined;
  if (second !== undefined && Number(second) > 59) return undefined;
  const offset =
    zone === undefined
      ? ''
      : zone === 'Z'
        ? ' UTC'
        : ` UTC${zone.replace(/^([+-]\d{2})(\d{2})$/u, '$1:$2')}`;
  return { datetime: value.replace(' ', 'T'), label: `${date} ${hour}:${minute}${offset}` };
}

function timeMarkup(value: string, id: string): string {
  const parsed = parsePostDate(value);
  const attribute = parsed === undefined ? '' : ` datetime="${escapeAttribute(parsed.datetime)}"`;
  return `<time class="ak-social-time" id="${escapeAttribute(id)}"${attribute}>${escapeText(
    parsed?.label ?? value,
  )}</time>`;
}

// ---------------------------------------------------------------------------
// Handles

const HANDLE = /^(?:@|u\/)?[\p{L}\p{N}_][\p{L}\p{N}_.-]*(?:@[a-z0-9.-]+\.[a-z]{2,})?$/iu;

/** True for a handle a platform could issue (Mastodon `user@instance` included). */
export function isHandle(value: string): boolean {
  return HANDLE.test(value);
}

/** A meaning-preserving cleanup: trimmed, with one leading `@`. */
export function normalizeHandle(value: string): string {
  return value.trim().replace(/^@{2,}/u, '@');
}

function displayHandle(handle: string, platform: Platform): string {
  if (handle.startsWith('@') || handle.startsWith('u/')) return handle;
  if (platform === 'hackernews') return handle;
  if (platform === 'reddit') return `u/${handle}`;
  return `@${handle}`;
}

// ---------------------------------------------------------------------------
// Metrics

const METRICS = ['views', 'likes', 'reposts', 'replies'] as const;
type Metric = (typeof METRICS)[number];

const NOUNS: Record<Metric, [string, string]> = {
  views: ['view', 'views'],
  likes: ['like', 'likes'],
  reposts: ['repost', 'reposts'],
  replies: ['reply', 'replies'],
};

const PLATFORM_NOUNS: Partial<Record<Platform, Partial<Record<Metric, [string, string]>>>> = {
  reddit: { likes: ['point', 'points'], replies: ['comment', 'comments'] },
  hackernews: { likes: ['point', 'points'], replies: ['comment', 'comments'] },
  youtube: { replies: ['comment', 'comments'] },
  mastodon: { reposts: ['boost', 'boosts'] },
};

function metricsMarkup(post: Post, platform: Platform): string {
  const metrics = record(post.metrics);
  const items = METRICS.flatMap((metric) => {
    const value = metrics[metric];
    if (typeof value !== 'number') return [];
    const [one, many] = PLATFORM_NOUNS[platform]?.[metric] ?? NOUNS[metric];
    const shown = formatValue(value, { format: 'compact' });
    return [
      `<li><data value="${value}">${escapeText(shown)}</data> ${value === 1 ? one : many}</li>`,
    ];
  });
  if (items.length === 0) return '';
  const asOf = text(metrics.asOf);
  return `<ul class="ak-social-metrics">${items.join('')}${
    asOf === '' ? '' : `<li class="ak-social-asof">as of ${escapeText(asOf)}</li>`
  }</ul>`;
}

// ---------------------------------------------------------------------------
// Media

function mediaFallback(label: string, reason: string): string {
  return `<p class="ak-social-media-fallback"><strong>${escapeText(label)}</strong> <span>${escapeText(reason)}</span></p>`;
}

function mediaItem(
  item: Post,
  postUrl: string,
  platform: Platform,
  context: RenderContext,
): string {
  const policy = context.ir.policy.network;
  const alt = text(item.alt);
  const image = text(item.image);
  if (image !== '') {
    const resolved = resolveMedia(image, policy, 'images');
    const body = resolved.allowed
      ? `<img src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(alt)}" loading="lazy" decoding="async" />`
      : mediaFallback(
          alt === '' ? 'Image' : alt,
          `Remote image not loaded: ${blockedReason(policy, 'images', image)}.`,
        );
    return `<figure class="ak-social-media-item" data-kind="image"${resolved.allowed ? '' : ' data-fallback="true"'}>${body}</figure>`;
  }
  const video = text(item.video);
  if (video === '') return '';
  const resolved = resolveMedia(video, policy, 'media');
  const requestedPoster = text(item.poster);
  const poster =
    requestedPoster !== '' && imageReferenceAllowed(policy, requestedPoster)
      ? resolveMedia(requestedPoster, policy, 'images').src
      : '';
  const label = alt === '' ? 'Video' : alt;
  if (resolved.allowed) {
    return `<figure class="ak-social-media-item" data-kind="video"><video controls preload="metadata"${
      poster === '' ? '' : ` poster="${escapeAttribute(poster)}"`
    } aria-label="${escapeAttribute(label)}"><source src="${escapeAttribute(resolved.src)}" />${escapeText(
      label,
    )}</video></figure>`;
  }
  const still =
    poster === ''
      ? ''
      : `<img src="${escapeAttribute(poster)}" alt="" loading="lazy" decoding="async" />`;
  const link = authoredLink(
    postUrl,
    `Watch on ${escapeText(PLATFORM_LABELS[platform])}`,
    ' class="ak-social-watch"',
  );
  return `<figure class="ak-social-media-item" data-kind="video" data-fallback="true">${still}${mediaFallback(
    label,
    `Video not loaded: ${blockedReason(policy, 'media', video)}.`,
  )}${link}</figure>`;
}

function mediaMarkup(post: Post, platform: Platform, context: RenderContext): string {
  const items = records(post.media)
    .map((item) => mediaItem(item, text(post.url), platform, context))
    .filter((part) => part !== '');
  if (items.length === 0) return '';
  return `<div class="ak-social-media" data-count="${items.length}">${items.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// The card

function bodyText(value: string): string {
  return value
    .split(/\n{2,}/u)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => `<p>${part.split('\n').map(escapeInlineText).join('<br />')}</p>`)
    .join('');
}

function platformMark(platform: Platform, context: RenderContext, path: string): string {
  const icon = PLATFORM_ICONS[platform];
  const svg =
    icon === undefined
      ? ''
      : renderIcon(
          context,
          { name: icon, pack: 'tabler' },
          { size: 'sm', path, className: 'ak-social-mark' },
        );
  const name = platform === 'other' ? '' : PLATFORM_LABELS[platform];
  if (svg === '' && name === '') return '';
  return `<span class="ak-social-platform">${svg}${escapeText(name)}</span>`;
}

export interface PostRenderOptions {
  /** Unique id stem for the card's labelling ids. */
  id: string;
  /** JSON path of the post, for render-time warnings. */
  path: string;
  /** Rendered inside another post as its quote. */
  nested?: boolean;
}

/** One post as an `<article>` named by its author and date. */
export function renderPost(post: Post, context: RenderContext, options: PostRenderOptions): string {
  const platform = platformOf(post);
  const author = record(post.author);
  const name = text(author.name);
  const handle = text(author.handle);
  const url = text(post.url);
  const date = text(post.date);
  const title = text(post.title);
  const postText = text(post.text);
  const nameId = `${options.id}-name`;
  const timeId = `${options.id}-time`;
  const nameMarkup = escapeText(name);
  const who = [
    `<span class="ak-social-name" id="${escapeAttribute(nameId)}">${nameMarkup}</span>`,
    author.verified === true
      ? `<span class="ak-social-verified">${renderIcon(context, 'check', {
          size: 'xs',
          path: `${options.path}.author.verified`,
        })}<span class="ak-sr">Verified</span></span>`
      : '',
    handle === ''
      ? ''
      : `<span class="ak-social-handle">${escapeText(displayHandle(handle, platform))}</span>`,
  ].join('');
  const header = `<header class="ak-social-head">${avatar(
    text(author.avatar),
    name,
    context.ir.policy.network,
  )}<p class="ak-social-who">${who}${
    date === '' ? '' : timeMarkup(date, timeId)
  }</p>${options.nested === true ? '' : platformMark(platform, context, `${options.path}.platform`)}</header>`;
  const replyHandle = text(post.replyTo);
  const reply =
    replyHandle === ''
      ? ''
      : `<p class="ak-social-reply">Replying to ${escapeText(displayHandle(replyHandle, platform))}</p>`;
  const quote =
    title === '' && postText === ''
      ? ''
      : `<blockquote class="ak-social-text" cite="${escapeAttribute(url)}">${
          title === '' ? '' : `<p class="ak-social-title">${escapeInlineText(title)}</p>`
        }${bodyText(postText)}</blockquote>`;
  const quoted = isPlainObject(post.quoted)
    ? renderPost(post.quoted, context, {
        id: `${options.id}-q`,
        path: `${options.path}.quoted`,
        nested: true,
      })
    : '';
  const linkLabel =
    platform === 'other' ? 'Open the original post' : `Open on ${PLATFORM_LABELS[platform]}`;
  const footer = `<footer class="ak-social-foot">${metricsMarkup(post, platform)}${authoredLink(
    url,
    escapeText(linkLabel),
    ' class="ak-social-link"',
  )}</footer>`;
  const labelledBy = date === '' ? nameId : `${nameId} ${timeId}`;
  return `<article class="ak-social-post${options.nested === true ? ' ak-social-quoted' : ''}" data-platform="${platform}" aria-labelledby="${escapeAttribute(
    labelledBy,
  )}">${header}${reply}${quote}${mediaMarkup(post, platform, context)}${quoted}${footer}</article>`;
}

// ---------------------------------------------------------------------------
// Checks

const SIGNED_CDN = /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/u;

function expiringUrl(reference: string): boolean {
  try {
    const parsed = new URL(reference);
    return SIGNED_CDN.test(parsed.hostname.toLowerCase()) && parsed.searchParams.has('oe');
  } catch {
    return false;
  }
}

/** The platform whose page hosts own a URL, if any. */
function platformForUrl(url: string): Platform | undefined {
  return PLATFORMS.find(
    (platform) => EMBED_PROVIDERS[platform] !== undefined && hostMatchesProvider(platform, url),
  );
}

function warn(
  context: CheckContext,
  node: IrNode,
  path: string,
  message: string,
  fixes?: JsonValue[],
): void {
  context.bag.add({
    code: 'SPEC_VALIDATION_ERROR',
    severity: 'warning',
    path,
    nodeId: node.id,
    message,
    ...(fixes === undefined || fixes.length === 0
      ? {}
      : {
          fixes: fixes.map((replaceWith) => ({
            rule: 'social/platform-from-url',
            classification: 'ambiguous' as const,
            replaceWith,
          })),
        }),
  });
}

/** Cross-field checks for one post at `path` (and its quoted post). */
export function checkPost(post: Post, path: string, node: IrNode, context: CheckContext): void {
  const platform = text(post.platform);
  const url = text(post.url);
  if (
    EMBED_PROVIDERS[platform] !== undefined &&
    isRemote(url) &&
    !hostMatchesProvider(platform, url)
  ) {
    const owner = platformForUrl(url);
    warn(
      context,
      node,
      `${path}.platform`,
      `url is not on ${PLATFORM_LABELS[platform as Platform]}${owner === undefined ? '' : `; it looks like ${PLATFORM_LABELS[owner]}`}`,
      owner === undefined ? undefined : [owner],
    );
  }
  for (const [key, value] of [
    ['author.handle', record(post.author).handle],
    ['replyTo', post.replyTo],
  ] as const) {
    if (typeof value !== 'string' || value === '' || isHandle(value)) continue;
    const normalized = normalizeHandle(value);
    context.bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: `${path}.${key}`,
      nodeId: node.id,
      message: `"${value}" is not a handle (letters, digits, _ . - and one leading @)`,
      ...(isHandle(normalized)
        ? {
            fixes: [
              { rule: 'social/handle', classification: 'safe' as const, replaceWith: normalized },
            ],
          }
        : {}),
    });
  }
  const date = text(post.date);
  if (date !== '' && parsePostDate(date) === undefined) {
    warn(
      context,
      node,
      `${path}.date`,
      'date is not an ISO date or datetime; it is shown as written, without a machine-readable date',
    );
  }
  const avatarUrl = text(record(post.author).avatar);
  if (expiringUrl(avatarUrl)) {
    warn(
      context,
      node,
      `${path}.author.avatar`,
      'signed Meta CDN URL expires; copy it to a local asset',
    );
  }
  records(post.media).forEach((item, at) => {
    const itemPath = `${path}.media[${at}]`;
    const image = text(item.image);
    const video = text(item.video);
    if ((image === '') === (video === '')) {
      context.bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: itemPath,
        nodeId: node.id,
        message: 'a media item needs exactly one of image or video',
      });
    }
    if (image !== '' && typeof item.alt !== 'string') {
      context.bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: `${itemPath}.alt`,
        nodeId: node.id,
        message: 'an image needs alt text (an empty string marks it decorative)',
      });
    }
    for (const key of ['image', 'video', 'poster'] as const) {
      if (expiringUrl(text(item[key]))) {
        warn(
          context,
          node,
          `${itemPath}.${key}`,
          'signed Meta CDN URL expires; copy it to a local asset',
        );
      }
    }
  });
  if (isPlainObject(post.quoted)) checkPost(post.quoted, `${path}.quoted`, node, context);
}
