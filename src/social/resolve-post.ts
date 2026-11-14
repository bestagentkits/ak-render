/**
 * Authoring-time resolver: social post URL -> `social-post` block fragment.
 *
 * This is a helper an agent calls while writing a spec. The compiler never
 * calls it: `render`, `validate` and every other compile path stay offline and
 * deterministic. The fragment it returns is plain spec data, and its counts
 * carry `metrics.asOf` so the page states when they were captured.
 *
 * Network safety: the post URL is only parsed, never fetched. Each platform maps
 * it to one request against a fixed public endpoint. Every hop (redirects
 * included) must be https, on the endpoint allowlist and not a private host;
 * each response is capped in bytes and time. Returned HTML (X oEmbed, HN text)
 * is reduced to plain text; markup and scripts never pass through.
 */

import { isHandle, parsePostDate } from '../blocks/social/social-render.js';
import { isPrivateHost } from '../spec/network-policy.js';

export const RESOLVE_PLATFORMS = ['x', 'youtube', 'bluesky', 'reddit', 'hackernews'] as const;
export type ResolvePlatform = (typeof RESOLVE_PLATFORMS)[number];

/** Hosts the resolver may request. Nothing else is ever fetched. */
export const RESOLVE_ENDPOINT_HOSTS: readonly string[] = [
  'publish.twitter.com',
  'publish.x.com',
  'www.youtube.com',
  'public.api.bsky.app',
  'www.reddit.com',
  'hacker-news.firebaseio.com',
];

export const DEFAULT_RESOLVE_TIMEOUT_MS = 10_000;
export const DEFAULT_RESOLVE_MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

/** Field limits of the `social-post` contract; resolved data is clipped to them. */
const LIMITS = { text: 4000, title: 300, alt: 300, name: 200, handle: 80 } as const;
const MAX_MEDIA = 4;

export type ResolvePostErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PLATFORM'
  | 'BLOCKED_REQUEST'
  | 'FETCH_FAILED'
  | 'NOT_FOUND'
  | 'BAD_RESPONSE';

export class ResolvePostError extends Error {
  readonly code: ResolvePostErrorCode;
  /** The HTTP status that caused the error, when one did. */
  readonly status: number | undefined;
  constructor(code: ResolvePostErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ResolvePostError';
    this.code = code;
    this.status = status;
  }
}

export interface SocialPostMedia {
  image: string;
  alt: string;
}

export interface SocialPostAuthor {
  name: string;
  handle?: string | undefined;
  avatar?: string | undefined;
}

export interface SocialPostMetrics {
  views?: number | undefined;
  likes?: number | undefined;
  reposts?: number | undefined;
  replies?: number | undefined;
  asOf: string;
}

/** The fields a quoted post may carry: no title or metrics. */
export interface QuotedPostFields {
  platform: ResolvePlatform;
  url: string;
  author: SocialPostAuthor;
  text?: string | undefined;
  date?: string | undefined;
  media?: SocialPostMedia[] | undefined;
}

export interface SocialPostFields extends QuotedPostFields {
  title?: string | undefined;
  metrics?: SocialPostMetrics | undefined;
  quoted?: QuotedPostFields | undefined;
}

export interface SocialPostFragment extends SocialPostFields {
  type: 'social-post';
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ResolvePostOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Capture time for `metrics.asOf`; defaults to the current time. */
  now?: () => Date;
  timeoutMs?: number;
  maxBytes?: number;
}

interface Context {
  fetch: FetchLike;
  asOf: string;
  timeoutMs: number;
  maxBytes: number;
  /** One deadline for the whole resolve, however many requests it takes. */
  signal: AbortSignal;
  /** The endpoint hosts this platform may reach, a subset of the allowlist. */
  hosts: readonly string[];
}

const PLATFORM_HOSTS: Record<ResolvePlatform, readonly string[]> = {
  x: ['publish.twitter.com', 'publish.x.com'],
  youtube: ['www.youtube.com'],
  bluesky: ['public.api.bsky.app'],
  reddit: ['www.reddit.com'],
  hackernews: ['hacker-news.firebaseio.com'],
};

type Target =
  | { platform: 'x'; user: string | undefined; id: string }
  | { platform: 'youtube'; id: string }
  | { platform: 'bluesky'; actor: string; rkey: string }
  | { platform: 'reddit'; id: string }
  | { platform: 'hackernews'; id: string };

const MANUAL_PLATFORMS: Record<string, string> = {
  'threads.net': 'Threads',
  'threads.com': 'Threads',
  'linkedin.com': 'LinkedIn',
  'instagram.com': 'Instagram',
  'facebook.com': 'Facebook',
};

function bareHost(url: URL): string {
  return url.hostname
    .toLowerCase()
    .replace(/\.$/u, '')
    .replace(/^(www|m|mobile|old|new)\./u, '');
}

/** Map a post URL to a supported platform and its post identifier. */
export function parsePostUrl(input: string): Target {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ResolvePostError('INVALID_URL', `not a URL: ${input}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ResolvePostError('INVALID_URL', `expected an http(s) post URL, got ${url.protocol}`);
  }
  const host = bareHost(url);
  const parts = url.pathname.split('/').filter((part) => part !== '');

  if (host === 'x.com' || host === 'twitter.com') {
    const index = parts.indexOf('status');
    const user = parts[index - 1];
    const id = parts[index + 1];
    if (index >= 1 && user !== undefined && id !== undefined && /^\d{1,25}$/u.test(id)) {
      // `/i/status/<id>` and `/i/web/status/<id>` name no author.
      const anonymous = parts[0] === 'i';
      return { platform: 'x', user: anonymous ? undefined : user, id };
    }
    throw new ResolvePostError(
      'INVALID_URL',
      'expected an X post URL like https://x.com/<user>/status/<id>',
    );
  }
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    const id =
      host === 'youtu.be'
        ? parts[0]
        : parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed'
          ? parts[1]
          : (url.searchParams.get('v') ?? undefined);
    if (id !== undefined && /^[\w-]{6,20}$/u.test(id)) return { platform: 'youtube', id };
    throw new ResolvePostError(
      'INVALID_URL',
      'expected a YouTube video URL (watch?v=, youtu.be, shorts)',
    );
  }
  if (host === 'bsky.app') {
    const [profile, actor, post, rkey] = parts;
    if (profile === 'profile' && post === 'post' && actor !== undefined && rkey !== undefined) {
      if (/^[\w.:-]{1,253}$/u.test(actor) && /^[\w~.-]{1,64}$/u.test(rkey)) {
        return { platform: 'bluesky', actor, rkey };
      }
    }
    throw new ResolvePostError(
      'INVALID_URL',
      'expected a Bluesky post URL like https://bsky.app/profile/<handle>/post/<id>',
    );
  }
  if (host === 'reddit.com' || host === 'redd.it') {
    const index = parts.indexOf('comments');
    const id = host === 'redd.it' ? parts[0] : index >= 0 ? parts[index + 1] : undefined;
    if (id !== undefined && /^[a-z0-9]{1,12}$/iu.test(id))
      return { platform: 'reddit', id: id.toLowerCase() };
    throw new ResolvePostError(
      'INVALID_URL',
      'expected a Reddit post URL like https://www.reddit.com/r/<sub>/comments/<id>/...',
    );
  }
  if (host === 'news.ycombinator.com') {
    const id = url.searchParams.get('id');
    if (parts[0] === 'item' && id !== null && /^\d{1,12}$/u.test(id))
      return { platform: 'hackernews', id };
    throw new ResolvePostError(
      'INVALID_URL',
      'expected a Hacker News URL like https://news.ycombinator.com/item?id=<n>',
    );
  }
  const manual = Object.entries(MANUAL_PLATFORMS).find(
    ([domain]) => host === domain || host.endsWith(`.${domain}`),
  );
  if (manual !== undefined) {
    throw new ResolvePostError(
      'UNSUPPORTED_PLATFORM',
      `${manual[1]} posts cannot be resolved without an account; write the social-post fields by hand`,
    );
  }
  throw new ResolvePostError(
    'UNSUPPORTED_PLATFORM',
    `unsupported platform ${host}; supported: X, YouTube, Bluesky, Reddit, Hacker News`,
  );
}

/** Throw unless `url` is an https request to an allowlisted, public endpoint. */
export function assertAllowedRequest(
  url: string,
  hosts: readonly string[] = RESOLVE_ENDPOINT_HOSTS,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ResolvePostError('BLOCKED_REQUEST', `refused request to an invalid URL`);
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (parsed.protocol !== 'https:') {
    throw new ResolvePostError('BLOCKED_REQUEST', `refused non-https request to ${host}`);
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.port !== '') {
    throw new ResolvePostError(
      'BLOCKED_REQUEST',
      `refused request with credentials or a port to ${host}`,
    );
  }
  if (isPrivateHost(parsed.href)) {
    throw new ResolvePostError('BLOCKED_REQUEST', `refused request to private host ${host}`);
  }
  if (!hosts.includes(host)) {
    throw new ResolvePostError(
      'BLOCKED_REQUEST',
      `refused request to ${host}: not on the endpoint allowlist`,
    );
  }
  return parsed;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ResolvePostError('BAD_RESPONSE', `response larger than ${maxBytes} bytes`);
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResolvePostError('BAD_RESPONSE', `response larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function failureReason(context: Context, error: unknown): string {
  if (context.signal.aborted) return `timed out after ${context.timeoutMs} ms`;
  return error instanceof Error ? error.message : String(error);
}

/** GET JSON from an allowlisted endpoint, following at most a few checked redirects. */
async function getJson(context: Context, url: string): Promise<unknown> {
  let current = assertAllowedRequest(url, context.hosts);
  for (let hop = 0; ; hop += 1) {
    let response: Response;
    try {
      response = await context.fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: context.signal,
        headers: { accept: 'application/json', 'user-agent': 'ak-render-resolve-post' },
      });
    } catch (error) {
      throw new ResolvePostError(
        'FETCH_FAILED',
        `request to ${current.hostname} failed: ${failureReason(context, error)}`,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get('location');
      if (location === null || hop >= MAX_REDIRECTS) {
        throw new ResolvePostError(
          'FETCH_FAILED',
          `too many or empty redirects from ${current.hostname}`,
        );
      }
      let next: string;
      try {
        next = new URL(location, current).href;
      } catch {
        throw new ResolvePostError(
          'BLOCKED_REQUEST',
          `refused a malformed redirect from ${current.hostname}`,
        );
      }
      current = assertAllowedRequest(next, context.hosts);
      continue;
    }
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel().catch(() => undefined);
      throw new ResolvePostError(
        'NOT_FOUND',
        `post not found (${current.hostname} returned ${response.status})`,
        response.status,
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ResolvePostError(
        'FETCH_FAILED',
        `${current.hostname} returned HTTP ${response.status}; the post may be private or rate-limited`,
        response.status,
      );
    }
    let text: string;
    try {
      text = await readCapped(response, context.maxBytes);
    } catch (error) {
      if (error instanceof ResolvePostError) throw error;
      throw new ResolvePostError(
        'FETCH_FAILED',
        `reading the reply from ${current.hostname} failed: ${failureReason(context, error)}`,
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ResolvePostError('BAD_RESPONSE', `${current.hostname} did not return JSON`);
    }
  }
}

// ---------------------------------------------------------------- text helpers

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Reduce an HTML fragment to plain text: tags dropped, breaks kept, entities decoded. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/giu, '')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/p\s*>\s*<p\b[^>]*>/giu, '\n\n')
    .replace(/<p\b[^>]*>/giu, '\n\n')
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/gu, '');
  return decodeEntities(text)
    .replace(/[ \t ]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function clip(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const chars = Array.from(trimmed);
  return chars.length <= max
    ? trimmed
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/** Keep only https, public URLs in the fragment; anything else would fail validation. */
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || isPrivateHost(url.href)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isoFromEpochSeconds(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('.000Z', 'Z') : undefined;
}

/** Keep a date only when the block accepts it as ISO; anything else is dropped, not guessed. */
function postDate(value: string | undefined): string | undefined {
  return value !== undefined && value.length <= 40 && parsePostDate(value) !== undefined
    ? value
    : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function metrics(
  asOf: string,
  counts: Omit<SocialPostMetrics, 'asOf'>,
): SocialPostMetrics | undefined {
  const present = Object.fromEntries(
    Object.entries(counts).filter((entry) => entry[1] !== undefined),
  ) as Omit<SocialPostMetrics, 'asOf'>;
  return Object.keys(present).length === 0 ? undefined : { ...present, asOf };
}

/** Drop undefined and empty values so the YAML stays minimal. */
function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (Array.isArray(item) && item.length === 0) continue;
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const inner = compact(item as Record<string, unknown>);
      if (Object.keys(inner).length === 0) continue;
      out[key] = inner;
      continue;
    }
    out[key] = item;
  }
  return out as T;
}

// ------------------------------------------------------------------ platforms

const TWITTER_EPOCH_MS = 1288834974657n;

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** The oEmbed byline ends in a link whose text is the post date, e.g. "March 21, 2006". */
export function oembedDate(html: string): string | undefined {
  const anchors = [...html.matchAll(/<a\b[^>]*>([^<]*)<\/a>/giu)];
  const last = anchors.at(-1)?.[1]?.trim() ?? '';
  const match = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/u.exec(last);
  if (match === null) return undefined;
  const month = MONTHS.indexOf((match[1] ?? '').toLowerCase());
  const day = Number(match[2]);
  if (month < 0 || day < 1 || day > 31) return undefined;
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** X post ids are snowflakes: the top bits carry the creation time in ms. */
export function snowflakeTime(id: string): string | undefined {
  try {
    const offset = BigInt(id) >> 22n;
    // Ids issued before snowflakes (2006-2010) are sequential and carry no time:
    // they decode to the first seconds after the epoch, so require a margin.
    if (offset < 60_000n) return undefined;
    const ms = Number(offset + TWITTER_EPOCH_MS);
    if (ms > Date.UTC(2100, 0, 1)) return undefined;
    return new Date(ms).toISOString().replace('.000Z', 'Z');
  } catch {
    return undefined;
  }
}

/** A handle the block accepts, or nothing; an odd value is dropped, not guessed. */
function handleOf(value: string | undefined, prefix: '@' | 'u/'): string | undefined {
  if (value === undefined) return undefined;
  const handle = clip(`${prefix}${value.replace(/^@+/u, '')}`, LIMITS.handle);
  return handle !== undefined && isHandle(handle) ? handle : undefined;
}

function author(
  name: string | undefined,
  fallback: string,
  extra: Omit<SocialPostAuthor, 'name'> = {},
) {
  return { name: clip(name, LIMITS.name) ?? fallback, ...extra };
}

async function resolveX(context: Context, target: Extract<Target, { platform: 'x' }>) {
  const canonical =
    target.user === undefined
      ? `https://x.com/i/status/${target.id}`
      : `https://x.com/${encodeURIComponent(target.user)}/status/${target.id}`;
  const endpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(canonical)}&omit_script=true&dnt=true`;
  const data = record(await getJson(context, endpoint));
  const html = str(data.html);
  if (html === undefined) throw new ResolvePostError('BAD_RESPONSE', 'X oEmbed returned no post');
  const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/iu.exec(html)?.[1] ?? '';
  const authorUrl = safeUrl(data.author_url);
  const user =
    (authorUrl === undefined ? undefined : new URL(authorUrl).pathname.split('/')[1]) ||
    target.user;
  const handle = handleOf(user, '@');
  const fields: SocialPostFields = {
    platform: 'x',
    url: handle === undefined ? canonical : `https://x.com/${handle.slice(1)}/status/${target.id}`,
    author: author(str(data.author_name), handle ?? 'X user', { handle }),
    text: clip(htmlToText(paragraph), LIMITS.text),
    date: snowflakeTime(target.id) ?? oembedDate(html),
  };
  return fields;
}

async function resolveYouTube(context: Context, target: Extract<Target, { platform: 'youtube' }>) {
  const canonical = `https://www.youtube.com/watch?v=${target.id}`;
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`;
  const data = record(await getJson(context, endpoint));
  const title = clip(str(data.title), LIMITS.title);
  const thumbnail = safeUrl(data.thumbnail_url);
  const channel = str(data.author_url)?.match(/\/(@[^/?#]+)/u)?.[1];
  const fields: SocialPostFields = {
    platform: 'youtube',
    url: canonical,
    author: author(str(data.author_name), 'YouTube channel', { handle: handleOf(channel, '@') }),
    title,
    media:
      thumbnail === undefined
        ? undefined
        : [
            {
              image: thumbnail,
              alt: clip(`Video thumbnail: ${title ?? 'YouTube video'}`, LIMITS.alt) ?? '',
            },
          ],
  };
  return fields;
}

/** The AppView reports an unverified handle as `handle.invalid`; treat it as absent. */
function bskyHandle(value: unknown): string | undefined {
  const handle = str(value);
  return handle === undefined || handle === 'handle.invalid' ? undefined : handle;
}

function bskyPostUrl(handle: string, uri: string): string | undefined {
  const rkey = /\/app\.bsky\.feed\.post\/([\w~.-]+)$/u.exec(uri)?.[1];
  return rkey === undefined || handle === ''
    ? undefined
    : `https://bsky.app/profile/${handle}/post/${rkey}`;
}

function bskyMedia(embed: Record<string, unknown>): SocialPostMedia[] {
  const type = str(embed.$type) ?? '';
  if (type.startsWith('app.bsky.embed.recordWithMedia')) return bskyMedia(record(embed.media));
  if (type.startsWith('app.bsky.embed.images')) {
    const images = Array.isArray(embed.images) ? embed.images : [];
    return images.flatMap((item) => {
      const image = record(item);
      const src = safeUrl(image.fullsize) ?? safeUrl(image.thumb);
      return src === undefined
        ? []
        : [{ image: src, alt: clip(str(image.alt), LIMITS.alt) ?? 'Image attached to the post' }];
    });
  }
  if (type.startsWith('app.bsky.embed.video')) {
    // The video is an HLS playlist a static page cannot play; keep its still.
    const src = safeUrl(embed.thumbnail);
    const alt = clip(`Video: ${str(embed.alt) ?? 'video attached to the post'}`, LIMITS.alt) ?? '';
    return src === undefined ? [] : [{ image: src, alt }];
  }
  if (type.startsWith('app.bsky.embed.external')) {
    const external = record(embed.external);
    const src = safeUrl(external.thumb);
    const alt =
      clip(
        `Link preview: ${str(external.title) ?? str(external.uri) ?? 'linked page'}`,
        LIMITS.alt,
      ) ?? '';
    return src === undefined ? [] : [{ image: src, alt }];
  }
  return [];
}

function bskyAuthor(value: Record<string, unknown>): SocialPostAuthor {
  const handle = bskyHandle(value.handle);
  return author(str(value.displayName) ?? handle, 'Bluesky user', {
    handle: handleOf(handle, '@'),
    avatar: safeUrl(value.avatar),
  });
}

function bskyQuoted(embed: Record<string, unknown>): QuotedPostFields | undefined {
  const type = str(embed.$type) ?? '';
  const view = type.startsWith('app.bsky.embed.recordWithMedia')
    ? record(record(embed.record).record)
    : type.startsWith('app.bsky.embed.record')
      ? record(embed.record)
      : undefined;
  if (
    view === undefined ||
    !(str(view.$type) ?? '').startsWith('app.bsky.embed.record#viewRecord')
  ) {
    return undefined;
  }
  const quotedAuthor = record(view.author);
  const value = record(view.value);
  const url = bskyPostUrl(
    bskyHandle(quotedAuthor.handle) ?? str(quotedAuthor.did) ?? '',
    str(view.uri) ?? '',
  );
  if (url === undefined) return undefined;
  const embeds = Array.isArray(view.embeds) ? view.embeds : [];
  return {
    platform: 'bluesky',
    url,
    author: bskyAuthor(quotedAuthor),
    text: clip(str(value.text), LIMITS.text),
    date: postDate(str(value.createdAt)),
    media: embeds.flatMap((item) => bskyMedia(record(item))).slice(0, MAX_MEDIA),
  };
}

async function resolveBluesky(context: Context, target: Extract<Target, { platform: 'bluesky' }>) {
  let did = target.actor;
  if (!did.startsWith('did:')) {
    let reply: unknown;
    try {
      reply = await getJson(
        context,
        `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(did)}`,
      );
    } catch (error) {
      // The AppView answers 400 for a handle it cannot resolve.
      if (error instanceof ResolvePostError && error.status === 400) {
        throw new ResolvePostError('NOT_FOUND', `unknown Bluesky handle ${target.actor}`, 400);
      }
      throw error;
    }
    const resolved = record(reply);
    const value = str(resolved.did);
    if (value === undefined)
      throw new ResolvePostError('NOT_FOUND', `unknown Bluesky handle ${target.actor}`);
    did = value;
  }
  const uri = `at://${did}/app.bsky.feed.post/${target.rkey}`;
  const data = record(
    await getJson(
      context,
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`,
    ),
  );
  const post = record(record(data.thread).post);
  if (str(post.uri) === undefined)
    throw new ResolvePostError('NOT_FOUND', 'Bluesky post not found or not public');
  const postAuthor = record(post.author);
  const value = record(post.record);
  const embed = record(post.embed);
  const handle = bskyHandle(postAuthor.handle) ?? did;
  const fields: SocialPostFields = {
    platform: 'bluesky',
    url: `https://bsky.app/profile/${handle}/post/${target.rkey}`,
    author: bskyAuthor(postAuthor),
    text: clip(str(value.text), LIMITS.text),
    date: postDate(str(value.createdAt)),
    media: bskyMedia(embed).slice(0, MAX_MEDIA),
    metrics: metrics(context.asOf, {
      likes: count(post.likeCount),
      reposts: count(post.repostCount),
      replies: count(post.replyCount),
    }),
    quoted: bskyQuoted(embed),
  };
  return fields;
}

function redditMedia(post: Record<string, unknown>, title: string | undefined): SocialPostMedia[] {
  const alt = clip(`Image from the post: ${title ?? 'Reddit post'}`, LIMITS.alt) ?? '';
  const gallery = record(post.media_metadata);
  const items = record(post.gallery_data).items;
  const fromGallery = (Array.isArray(items) ? items : []).flatMap((item) => {
    const meta = record(gallery[str(record(item).media_id) ?? '']);
    const src = safeUrl(record(meta.s).u);
    const caption = clip(str(record(item).caption), LIMITS.alt);
    return src === undefined ? [] : [{ image: src, alt: caption ?? alt }];
  });
  if (fromGallery.length > 0) return fromGallery;
  const images = record(post.preview).images;
  const first = Array.isArray(images) ? record(images[0]) : {};
  const src = safeUrl(record(first.source).url);
  return src === undefined ? [] : [{ image: src, alt }];
}

async function resolveReddit(context: Context, target: Extract<Target, { platform: 'reddit' }>) {
  const data = await getJson(
    context,
    `https://www.reddit.com/comments/${target.id}.json?raw_json=1&limit=1&depth=1`,
  );
  const listing = Array.isArray(data) ? record(data[0]) : record(data);
  const children = record(listing.data).children;
  const post = Array.isArray(children) ? record(record(children[0]).data) : {};
  if (str(post.id) === undefined)
    throw new ResolvePostError('NOT_FOUND', 'Reddit post not found or not public');
  const title = clip(str(post.title), LIMITS.title);
  const user = str(post.author);
  const permalink = str(post.permalink);
  const fields: SocialPostFields = {
    platform: 'reddit',
    url:
      permalink?.startsWith('/') === true
        ? `https://www.reddit.com${permalink}`
        : `https://www.reddit.com/comments/${target.id}/`,
    author: author(user, 'Reddit user', {
      handle: user === '[deleted]' ? undefined : handleOf(user, 'u/'),
    }),
    title,
    text: clip(str(post.selftext), LIMITS.text),
    date: isoFromEpochSeconds(post.created_utc),
    media: redditMedia(post, title).slice(0, MAX_MEDIA),
    metrics: metrics(context.asOf, { likes: count(post.score), replies: count(post.num_comments) }),
  };
  return fields;
}

async function resolveHackerNews(
  context: Context,
  target: Extract<Target, { platform: 'hackernews' }>,
) {
  const item = record(
    await getJson(context, `https://hacker-news.firebaseio.com/v0/item/${target.id}.json`),
  );
  if (count(item.id) === undefined || item.deleted === true || item.dead === true) {
    throw new ResolvePostError('NOT_FOUND', 'Hacker News item not found, deleted or dead');
  }
  const body = typeof item.text === 'string' ? htmlToText(item.text) : undefined;
  const link = safeUrl(item.url);
  const fields: SocialPostFields = {
    platform: 'hackernews',
    url: `https://news.ycombinator.com/item?id=${target.id}`,
    author: author(str(item.by), 'Hacker News user'),
    title: clip(str(item.title), LIMITS.title),
    text: clip(
      [link, body].filter((part) => part !== undefined && part !== '').join('\n\n'),
      LIMITS.text,
    ),
    date: isoFromEpochSeconds(item.time),
    metrics: metrics(context.asOf, { likes: count(item.score), replies: count(item.descendants) }),
  };
  return fields;
}

function resolveTarget(context: Context, target: Target): Promise<SocialPostFields> {
  switch (target.platform) {
    case 'x':
      return resolveX(context, target);
    case 'youtube':
      return resolveYouTube(context, target);
    case 'bluesky':
      return resolveBluesky(context, target);
    case 'reddit':
      return resolveReddit(context, target);
    case 'hackernews':
      return resolveHackerNews(context, target);
  }
}

/**
 * Resolve a public post URL into a `social-post` block fragment.
 *
 * Throws {@link ResolvePostError} for an unsupported platform, a malformed URL,
 * a refused request, or a post the public endpoint does not return.
 */
export async function resolvePost(
  url: string,
  options: ResolvePostOptions = {},
): Promise<SocialPostFragment> {
  const target = parsePostUrl(url);
  const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (fetchImpl === undefined) throw new ResolvePostError('FETCH_FAILED', 'fetch is not available');
  const context: Context = {
    fetch: fetchImpl,
    asOf: (options.now?.() ?? new Date()).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    timeoutMs: options.timeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? DEFAULT_RESOLVE_MAX_BYTES,
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS),
    hosts: PLATFORM_HOSTS[target.platform],
  };
  let fields: SocialPostFields;
  try {
    fields = await resolveTarget(context, target);
  } catch (error) {
    if (error instanceof ResolvePostError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new ResolvePostError(
      'BAD_RESPONSE',
      `unexpected reply while resolving the post: ${reason}`,
    );
  }
  return compact({ type: 'social-post', ...fields });
}
