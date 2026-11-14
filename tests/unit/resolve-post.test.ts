import { afterEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { run } from '../../src/cli.js';
import { compile, validate } from '../../src/index.js';
import {
  assertAllowedRequest,
  type FetchLike,
  htmlToText,
  oembedDate,
  parsePostUrl,
  RESOLVE_ENDPOINT_HOSTS,
  ResolvePostError,
  resolvePost,
  snowflakeTime,
} from '../../src/social/resolve-post.js';

const NOW = () => new Date('2026-11-14T02:30:00.000Z');

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch stub that answers by URL prefix and records every request. */
function stubFetch(routes: Record<string, () => Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (key === undefined) throw new Error(`unexpected request ${url}`);
    return (routes[key] as () => Response)();
  };
  return { fetch, calls };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

async function rejection(promise: Promise<unknown>): Promise<ResolvePostError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ResolvePostError);
    return error as ResolvePostError;
  }
  throw new Error('expected a rejection');
}

const X_OEMBED = {
  author_name: 'Claude Devs',
  author_url: 'https://twitter.com/ClaudeDevs',
  html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Ship it &amp; see<br>line two <a href="https://t.co/x">https://t.co/x</a><script>alert(1)</script></p>&mdash; Claude Devs (@ClaudeDevs) <a href="https://twitter.com/ClaudeDevs/status/1925591505332576377?ref_src=twsrc%5Etfw">May 22, 2025</a></blockquote>\n<script async src="https://platform.twitter.com/widgets.js"></script>',
};

describe('parsePostUrl', () => {
  it.each([
    ['https://x.com/ClaudeDevs/status/1925591505332576377', 'x'],
    ['https://twitter.com/jack/status/20?s=20', 'x'],
    ['https://mobile.twitter.com/jack/status/20', 'x'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1s', 'youtube'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'youtube'],
    ['https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l', 'bluesky'],
    ['https://www.reddit.com/r/programming/comments/1b3b2tq/some_title/', 'reddit'],
    ['https://old.reddit.com/comments/1b3b2tq', 'reddit'],
    ['https://news.ycombinator.com/item?id=8863', 'hackernews'],
  ])('recognises %s', (url, platform) => {
    expect(parsePostUrl(url).platform).toBe(platform);
  });

  it('refuses Threads and LinkedIn as manual-only platforms', () => {
    for (const url of [
      'https://www.threads.net/@zuck/post/C1',
      'https://www.linkedin.com/posts/x-1',
    ]) {
      expect(() => parsePostUrl(url)).toThrowError(/by hand/u);
    }
  });

  it('refuses unknown hosts and lookalikes', () => {
    for (const url of [
      'https://example.com/a',
      'https://x.com.evil.example/a/status/1',
      'https://evilx.com/a/status/1',
    ]) {
      try {
        parsePostUrl(url);
        expect.unreachable(url);
      } catch (error) {
        expect((error as ResolvePostError).code).toBe('UNSUPPORTED_PLATFORM');
      }
    }
  });

  it('refuses malformed post URLs on supported hosts', () => {
    for (const url of [
      'not a url',
      'ftp://x.com/a/status/1',
      'https://x.com/home',
      'https://bsky.app/profile/a',
    ]) {
      expect(() => parsePostUrl(url)).toThrowError(ResolvePostError);
    }
  });
});

describe('request guard', () => {
  it('allows only the fixed https endpoints', () => {
    for (const host of RESOLVE_ENDPOINT_HOSTS) {
      expect(assertAllowedRequest(`https://${host}/x`).hostname).toBe(host);
    }
  });

  it.each([
    'http://publish.twitter.com/oembed',
    'https://example.com/',
    'https://publish.twitter.com.evil.example/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/',
    'https://user:pw@www.reddit.com/',
    'https://www.reddit.com:8443/',
  ])('refuses %s', (url) => {
    expect(() => assertAllowedRequest(url)).toThrowError(ResolvePostError);
  });
});

describe('resolvePost', () => {
  it('turns an X oEmbed reply into plain text, never markup', async () => {
    const { fetch, calls } = stubFetch({
      'https://publish.twitter.com/oembed': () => json(X_OEMBED),
    });
    const block = await resolvePost('https://twitter.com/ClaudeDevs/status/1925591505332576377', {
      fetch,
      now: NOW,
    });
    expect(block).toEqual({
      type: 'social-post',
      platform: 'x',
      url: 'https://x.com/ClaudeDevs/status/1925591505332576377',
      author: { name: 'Claude Devs', handle: '@ClaudeDevs' },
      text: 'Ship it & see\nline two https://t.co/x',
      date: '2025-05-22T16:36:05.288Z',
    });
    expect(JSON.stringify(block)).not.toMatch(/<|script/u);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.redirect).toBe('manual');
  });

  it('follows an allowlisted redirect (publish.twitter.com -> publish.x.com)', async () => {
    const { fetch, calls } = stubFetch({
      'https://publish.twitter.com/': () => redirect('https://publish.x.com/oembed?url=a'),
      'https://publish.x.com/': () => json(X_OEMBED),
    });
    const block = await resolvePost('https://x.com/ClaudeDevs/status/1925591505332576377', {
      fetch,
      now: NOW,
    });
    expect(block.platform).toBe('x');
    expect(calls.map((call) => new URL(call.url).hostname)).toEqual([
      'publish.twitter.com',
      'publish.x.com',
    ]);
  });

  it.each([
    'https://evil.example/oembed',
    'http://publish.x.com/oembed',
    'https://10.0.0.5/oembed',
    'https://[fd00::1]/',
  ])('refuses a redirect to %s without requesting it', async (location) => {
    const { fetch, calls } = stubFetch({
      'https://publish.twitter.com/': () => redirect(location),
    });
    const error = await rejection(
      resolvePost('https://x.com/a/status/1925591505332576377', { fetch, now: NOW }),
    );
    expect(error.code).toBe('BLOCKED_REQUEST');
    expect(calls).toHaveLength(1);
  });

  it('stops after a bounded number of redirects', async () => {
    const { fetch, calls } = stubFetch({
      'https://publish.twitter.com/': () => redirect('https://publish.twitter.com/again'),
    });
    const error = await rejection(
      resolvePost('https://x.com/a/status/1925591505332576377', { fetch, now: NOW }),
    );
    expect(error.code).toBe('FETCH_FAILED');
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  it('caps the response size', async () => {
    const big = JSON.stringify({ html: 'x'.repeat(5000) });
    const { fetch } = stubFetch({ 'https://publish.twitter.com/': () => new Response(big) });
    const error = await rejection(
      resolvePost('https://x.com/a/status/1925591505332576377', {
        fetch,
        now: NOW,
        maxBytes: 1000,
      }),
    );
    expect(error.code).toBe('BAD_RESPONSE');
  });

  it('times out a stalled endpoint', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const error = await rejection(
      resolvePost('https://news.ycombinator.com/item?id=8863', { fetch, now: NOW, timeoutMs: 20 }),
    );
    expect(error.code).toBe('FETCH_FAILED');
  });

  it('maps 404 to NOT_FOUND and other failures to FETCH_FAILED', async () => {
    const missing = stubFetch({
      'https://www.youtube.com/': () => new Response('', { status: 404 }),
    });
    expect(
      (await rejection(resolvePost('https://youtu.be/dQw4w9WgXcQ', { fetch: missing.fetch }))).code,
    ).toBe('NOT_FOUND');
    const blocked = stubFetch({
      'https://www.reddit.com/': () => new Response('', { status: 403 }),
    });
    expect(
      (
        await rejection(
          resolvePost('https://www.reddit.com/comments/abc123', { fetch: blocked.fetch }),
        )
      ).code,
    ).toBe('FETCH_FAILED');
  });

  it('resolves YouTube oEmbed with a described thumbnail', async () => {
    const { fetch } = stubFetch({
      'https://www.youtube.com/oembed': () =>
        json({
          title: 'Talk',
          author_name: 'Chan',
          author_url: 'https://www.youtube.com/@chan',
          thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
        }),
    });
    expect(await resolvePost('https://youtu.be/abcdefghijk', { fetch, now: NOW })).toEqual({
      type: 'social-post',
      platform: 'youtube',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      author: { name: 'Chan', handle: '@chan' },
      title: 'Talk',
      media: [
        {
          image: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
          alt: 'Video thumbnail: Talk',
        },
      ],
    });
  });

  it('resolves a Bluesky handle, post, media, counts and quoted post', async () => {
    const { fetch, calls } = stubFetch({
      'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle': () =>
        json({ did: 'did:plc:abc' }),
      'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread': () =>
        json({
          thread: {
            post: {
              uri: 'at://did:plc:abc/app.bsky.feed.post/3kpost',
              author: {
                handle: 'alice.bsky.social',
                displayName: 'Alice',
                avatar: 'https://cdn.bsky.app/a.jpg',
              },
              record: { text: 'Hello', createdAt: '2026-11-13T10:00:00.000Z' },
              likeCount: 10,
              repostCount: 2,
              replyCount: 1,
              quoteCount: 0,
              embed: {
                $type: 'app.bsky.embed.recordWithMedia#view',
                media: {
                  $type: 'app.bsky.embed.images#view',
                  images: [
                    { fullsize: 'https://cdn.bsky.app/full.jpg', alt: 'A chart' },
                    { thumb: 'http://cdn.bsky.app/insecure.jpg', alt: 'dropped' },
                  ],
                },
                record: {
                  record: {
                    $type: 'app.bsky.embed.record#viewRecord',
                    uri: 'at://did:plc:bob/app.bsky.feed.post/3kquoted',
                    author: { handle: 'bob.test', displayName: 'Bob' },
                    value: { text: 'Quoted', createdAt: '2026-11-12T00:00:00.000Z' },
                  },
                },
              },
            },
          },
        }),
    });
    const block = await resolvePost('https://bsky.app/profile/alice.bsky.social/post/3kpost', {
      fetch,
      now: NOW,
    });
    expect(block).toEqual({
      type: 'social-post',
      platform: 'bluesky',
      url: 'https://bsky.app/profile/alice.bsky.social/post/3kpost',
      author: {
        name: 'Alice',
        handle: '@alice.bsky.social',
        avatar: 'https://cdn.bsky.app/a.jpg',
      },
      text: 'Hello',
      date: '2026-11-13T10:00:00.000Z',
      media: [{ image: 'https://cdn.bsky.app/full.jpg', alt: 'A chart' }],
      metrics: { likes: 10, reposts: 2, replies: 1, asOf: '2026-11-14T02:30:00Z' },
      quoted: {
        platform: 'bluesky',
        url: 'https://bsky.app/profile/bob.test/post/3kquoted',
        author: { name: 'Bob', handle: '@bob.test' },
        text: 'Quoted',
        date: '2026-11-12T00:00:00.000Z',
      },
    });
    expect(new URL(calls[1]?.url ?? '').searchParams.get('uri')).toBe(
      'at://did:plc:abc/app.bsky.feed.post/3kpost',
    );
  });

  it('resolves a Reddit post through the fixed JSON endpoint, not the input host', async () => {
    const { fetch, calls } = stubFetch({
      'https://www.reddit.com/comments/1b3b2tq.json': () =>
        json([
          {
            data: {
              children: [
                {
                  data: {
                    id: '1b3b2tq',
                    title: 'Title',
                    selftext: 'Body',
                    author: 'someone',
                    permalink: '/r/programming/comments/1b3b2tq/title/',
                    created_utc: 1700000000,
                    score: 42,
                    num_comments: 7,
                    preview: { images: [{ source: { url: 'https://preview.redd.it/a.jpg?s=1' } }] },
                  },
                },
              ],
            },
          },
        ]),
    });
    const block = await resolvePost(
      'https://old.reddit.com/r/programming/comments/1b3b2tq/title/',
      { fetch, now: NOW },
    );
    expect(block).toMatchObject({
      platform: 'reddit',
      url: 'https://www.reddit.com/r/programming/comments/1b3b2tq/title/',
      author: { name: 'someone', handle: 'u/someone' },
      title: 'Title',
      text: 'Body',
      date: '2023-11-14T22:13:20Z',
      media: [{ image: 'https://preview.redd.it/a.jpg?s=1' }],
      metrics: { likes: 42, replies: 7, asOf: '2026-11-14T02:30:00Z' },
    });
    expect(calls.map((call) => new URL(call.url).hostname)).toEqual(['www.reddit.com']);
  });

  it('resolves a Hacker News item and strips its HTML text', async () => {
    const { fetch } = stubFetch({
      'https://hacker-news.firebaseio.com/v0/item/8863.json': () =>
        json({
          id: 8863,
          by: 'dhouston',
          time: 1175714200,
          title: 'My YC app',
          text: 'First<p>Second &#x2F; <a href="x">link</a>',
          score: 104,
          descendants: 71,
        }),
    });
    expect(
      await resolvePost('https://news.ycombinator.com/item?id=8863', { fetch, now: NOW }),
    ).toEqual({
      type: 'social-post',
      platform: 'hackernews',
      url: 'https://news.ycombinator.com/item?id=8863',
      author: { name: 'dhouston' },
      title: 'My YC app',
      text: 'First\n\nSecond / link',
      date: '2007-04-04T19:16:40Z',
      metrics: { likes: 104, replies: 71, asOf: '2026-11-14T02:30:00Z' },
    });
  });

  it('clips long text to the block limit', async () => {
    const { fetch } = stubFetch({
      'https://hacker-news.firebaseio.com/': () =>
        json({ id: 1, title: 'a'.repeat(500), text: 'b'.repeat(5000) }),
    });
    const block = await resolvePost('https://news.ycombinator.com/item?id=1', { fetch, now: NOW });
    expect(Array.from(block.title ?? '')).toHaveLength(300);
    expect(Array.from(block.text ?? '')).toHaveLength(4000);
  });
});

describe('resolved fragments compile offline', () => {
  const ROUTES: Record<string, () => Response> = {
    'https://publish.twitter.com/': () => json(X_OEMBED),
    'https://www.youtube.com/oembed': () =>
      json({
        title: 'Talk',
        author_name: 'Chan',
        author_url: 'https://www.youtube.com/@chan',
        thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
      }),
    'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread': () =>
      json({
        thread: {
          post: {
            uri: 'at://did:plc:abc/app.bsky.feed.post/3kpost',
            author: { handle: 'alice.bsky.social', avatar: 'https://cdn.bsky.app/a.jpg' },
            record: { text: 'Hello <b>there</b>', createdAt: '2026-11-13T10:00:00.000Z' },
            likeCount: 3,
            embed: {
              $type: 'app.bsky.embed.video#view',
              thumbnail: 'https://video.bsky.app/t.jpg',
            },
          },
        },
      }),
    'https://www.reddit.com/': () =>
      json([
        {
          data: {
            children: [
              {
                data: {
                  id: 'abc123',
                  title: 'Title',
                  author: '[deleted]',
                  created_utc: 1700000000,
                  score: 1,
                  num_comments: 0,
                },
              },
            ],
          },
        },
      ]),
    'https://hacker-news.firebaseio.com/': () =>
      json({
        id: 8863,
        by: 'dhouston',
        time: 1175714200,
        title: 'Show HN',
        url: 'https://example.com/',
      }),
  };

  it.each([
    'https://x.com/ClaudeDevs/status/1925591505332576377',
    'https://youtu.be/abcdefghijk',
    'https://bsky.app/profile/did:plc:abc/post/3kpost',
    'https://www.reddit.com/r/a/comments/abc123/t/',
    'https://news.ycombinator.com/item?id=8863',
  ])('%s validates cleanly and renders under network deny', async (url) => {
    const { fetch } = stubFetch(ROUTES);
    const block = await resolvePost(url, { fetch, now: NOW });
    const spec = `version: 1
meta:
  title: Resolved
policy:
  network: deny
blocks:
${stringify([block], { lineWidth: 0 })}`;
    const result = validate(spec);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const { html } = compile(spec);
    expect(html).not.toMatch(/<(?:img|video|source)\b[^>]*\ssrc="https?:/u);
    expect(html).not.toMatch(/<iframe|<script\b(?![^>]*nonce)/u);
    expect(html).toContain('ak-social-post');
  });
});

describe('helpers', () => {
  it('decodes snowflake ids and skips pre-snowflake ids', () => {
    expect(snowflakeTime('1925591505332576377')).toBe('2025-05-22T16:36:05.288Z');
    expect(snowflakeTime('20')).toBeUndefined();
    expect(oembedDate('<a href="x">March 21, 2006</a>')).toBe('2006-03-21');
    expect(oembedDate('<a href="x">soon</a>')).toBeUndefined();
  });

  it('reduces HTML to text without tags or scripts', () => {
    expect(htmlToText('a<script>bad()</script><b>b</b>&lt;c&gt;<br/>d')).toBe('ab<c>\nd');
  });
});

describe('ak-render resolve-post', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function capture() {
    let out = '';
    let err = '';
    return {
      io: {
        stdout: (text: string) => {
          out += text;
        },
        stderr: (text: string) => {
          err += text;
        },
      },
      out: () => out,
      err: () => err,
    };
  }

  it('prints a YAML social-post fragment', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ 'https://publish.twitter.com/': () => json(X_OEMBED) }).fetch,
    );
    const c = capture();
    expect(
      await run(['resolve-post', 'https://x.com/ClaudeDevs/status/1925591505332576377'], c.io),
    ).toBe(0);
    expect(c.out()).toMatch(/^type: social-post\nplatform: x\n/u);
  });

  it('exits non-zero with a clear message for an unsupported platform, without fetching', async () => {
    const stub = stubFetch({});
    vi.stubGlobal('fetch', stub.fetch);
    const c = capture();
    expect(await run(['resolve-post', 'https://www.threads.net/@a/post/b'], c.io)).toBe(1);
    expect(c.err()).toMatch(/Threads posts cannot be resolved/u);
    expect(stub.calls).toHaveLength(0);

    const json = capture();
    expect(await run(['resolve-post', 'https://example.com/p', '--json'], json.io)).toBe(1);
    expect(JSON.parse(json.out())).toMatchObject({ ok: false, code: 'UNSUPPORTED_PLATFORM' });
  });

  it('rejects missing arguments and bad timeouts as usage errors', async () => {
    expect(await run(['resolve-post'], capture().io)).toBe(2);
    expect(
      await run(['resolve-post', 'https://x.com/a/status/1', '--timeout', '0'], capture().io),
    ).toBe(2);
  });
});
