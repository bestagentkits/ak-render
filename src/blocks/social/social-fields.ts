/**
 * The shared shape of one social post, for `social-post` and `social-feed`.
 *
 * A post is supplied data, never a live widget: the compiler draws the card
 * from these fields and emits no frame, script or platform beacon. Media is
 * split into an `image` field (the images capability) and a `video` field (the
 * media capability), because the asset gate is fixed per field, not per value.
 */

import {
  bool,
  enumStr,
  LABEL,
  list,
  num,
  obj,
  str,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';

export const PLATFORMS = [
  'x',
  'threads',
  'bluesky',
  'mastodon',
  'linkedin',
  'youtube',
  'reddit',
  'hackernews',
  'other',
] as const;

export type Platform = (typeof PLATFORMS)[number];

/** Names agents commonly write for a platform; each is a safe, meaning-preserving fix. */
export const PLATFORM_ALIASES: Readonly<Record<string, string>> = {
  twitter: 'x',
  tweet: 'x',
  'x.com': 'x',
  bsky: 'bluesky',
  hn: 'hackernews',
  'hacker-news': 'hackernews',
  ycombinator: 'hackernews',
  yt: 'youtube',
};

/** Display names; the card always writes the name next to any mark. */
export const PLATFORM_LABELS: Readonly<Record<Platform, string>> = {
  x: 'X',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  reddit: 'Reddit',
  hackernews: 'Hacker News',
  other: 'the original site',
};

const COUNT = (description: string): PropSchema => num({ min: 0, integer: true, description });

const MEDIA_ITEM = obj({
  image: urlProp({ asset: 'images', description: 'Image URL; set this or `video`.' }),
  video: urlProp({ asset: 'media', description: 'Video file URL (media capability).' }),
  poster: urlProp({ asset: 'images', description: 'Still for a video; dropped when blocked.' }),
  alt: str({ maxLength: 300, description: 'Required for an image; empty marks it decorative.' }),
});

const QUOTED_CORE: Record<string, PropSchema> = {
  platform: enumStr(PLATFORMS, {
    required: true,
    aliases: PLATFORM_ALIASES,
    description: 'Picks the mark, the link label and the metric nouns.',
  }),
  url: urlProp({ required: true, description: 'Canonical post URL; the card links here.' }),
  author: obj(
    {
      name: LABEL,
      handle: str({ maxLength: 80, description: 'With or without a leading @.' }),
      avatar: urlProp({
        asset: 'images',
        description: 'Falls back to initials when absent or blocked.',
      }),
      verified: bool({ default: false }),
    },
    { required: true },
  ),
  text: txt({ maxLength: 4000 }),
  date: str({
    maxLength: 40,
    description: 'Supplied ISO date or datetime; becomes a <time>. Never relative.',
  }),
  media: list(MEDIA_ITEM, { maxItems: 4 }),
};

const POST_CORE: Record<string, PropSchema> = {
  ...QUOTED_CORE,
  title: str({ maxLength: 300, description: 'Headline, for Reddit, HN or YouTube posts.' }),
  metrics: obj({
    views: COUNT('View or play count.'),
    likes: COUNT('Likes, or points on Reddit and HN.'),
    reposts: COUNT('Reposts, retweets or boosts.'),
    replies: COUNT('Replies, or comments.'),
    asOf: str({ maxLength: 40, description: 'When the counts were captured.' }),
  }),
};

/** Fields of one post as `social-feed` lists it and `social-post` takes it. */
export const POST_FIELDS: Record<string, PropSchema> = {
  ...POST_CORE,
  replyTo: str({ maxLength: 80, description: 'Handle this post replies to.' }),
  quoted: obj(QUOTED_CORE, { description: 'One quoted post: no title, metrics or quote.' }),
};
