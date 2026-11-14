import { describe, expect, it } from 'vitest';
import { normalizeHandle, parsePostDate } from '../../src/blocks/social/social-render.js';
import { compile, repair, validate } from '../../src/index.js';
import { hostMatchesProvider } from '../../src/spec/providers.js';

const DENY = 'policy:\n  network: deny\n';
const ALLOW_X = `policy:
  network:
    allow: [images, media]
    providers: [x]
`;

function page(blocks: string, policy = DENY): string {
  return `version: 1
meta:
  title: Social
${policy}blocks:
${blocks}`;
}

const X_POST = `  - type: social-post
    id: launch
    platform: x
    url: https://x.com/edgeweekly/status/1
    author:
      name: Edge Weekly
      handle: edgeweekly
      avatar: https://pbs.twimg.com/profile_images/a.jpg
      verified: true
    text: |
      Shipping **today**.

      Second paragraph.
    date: 2026-11-13T14:32:00Z
    media:
      - image: https://pbs.twimg.com/media/b.jpg
        alt: Build dashboard
      - video: https://video.twimg.com/c.mp4
        poster: https://pbs.twimg.com/media/p.jpg
        alt: Demo clip
    metrics: { views: 1284000, likes: 8410, reposts: 1, replies: 230, asOf: '2026-11-14' }
    quoted:
      platform: x
      url: https://x.com/mira/status/2
      author: { name: Mira Okafor, handle: '@mira' }
      text: Predictable beats fast.
`;

function cspOf(html: string): string {
  return (/http-equiv="Content-Security-Policy" content="([^"]*)"/u.exec(html)?.[1] ?? '').replace(
    /&#39;/gu,
    "'",
  );
}

function directive(csp: string, name: string): string {
  return (
    csp
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ''
  );
}

describe('social-post', () => {
  it('renders a static card that makes no request under deny', () => {
    const { html, features } = compile(page(X_POST));
    expect(features).toContain('social-post');
    expect(html).toContain('<article class="ak-social-post" data-platform="x"');
    expect(html).toContain('aria-labelledby="launch-name launch-time"');
    expect(html).toContain(
      '<time class="ak-social-time" id="launch-time" datetime="2026-11-13T14:32:00Z">2026-11-13 14:32 UTC</time>',
    );
    expect(html).toContain('<span class="ak-sr">Verified</span>');
    expect(html).toContain('<span class="ak-social-handle">@edgeweekly</span>');
    expect(html).toContain(
      '<blockquote class="ak-social-text" cite="https://x.com/edgeweekly/status/1">',
    );
    expect(html).toContain('<strong>today</strong>');
    // Initials stand in for the blocked avatar; media become described fallbacks.
    expect(html).toContain('data-initials="true" aria-hidden="true">EW</span>');
    expect(html).toContain('Remote image not loaded: the page denies network access.');
    expect(html).toContain('Video not loaded: the page denies network access.');
    expect(html).toContain('>Watch on X</a>');
    expect(html).not.toMatch(/src="https:\/\/(?:pbs|video)\.twimg\.com/u);
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<video');
    // Counts are text with labels, compact and deterministic.
    expect(html).toContain('<data value="1284000">1.3M</data> views');
    expect(html).toContain('<data value="1">1</data> repost<');
    expect(html).toContain('as of 2026-11-14');
    expect(html).toContain('rel="noreferrer noopener">Open on X</a>');
    // The quoted post is nested, without its own platform chip.
    expect(html).toContain(
      '<article class="ak-social-post ak-social-quoted" data-platform="x" aria-labelledby="launch-q-name">',
    );
    const csp = cspOf(html);
    expect(directive(csp, 'img-src')).not.toContain('https:');
    expect(directive(csp, 'media-src')).not.toContain('https:');
  });

  it('loads allowlisted media and lists exactly those origins in CSP', () => {
    const { html } = compile(page(X_POST, ALLOW_X));
    expect(html).toContain(
      '<img class="ak-avatar" src="https://pbs.twimg.com/profile_images/a.jpg" alt=""',
    );
    expect(html).toContain('<img src="https://pbs.twimg.com/media/b.jpg" alt="Build dashboard"');
    expect(html).toContain(
      '<video controls preload="metadata" poster="https://pbs.twimg.com/media/p.jpg" aria-label="Demo clip"><source src="https://video.twimg.com/c.mp4" />',
    );
    expect(html).not.toContain('autoplay');
    const csp = cspOf(html);
    expect(directive(csp, 'img-src')).toBe(
      "img-src data: file: 'self' https://pbs.twimg.com https://video.twimg.com",
    );
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'none'");
  });

  it('holds back hosts off the provider allowlist, lookalikes included', () => {
    const { html } = compile(
      page(
        `  - type: social-feed
    posts:
      - platform: bluesky
        url: https://bsky.app/profile/a/post/1
        author: { name: Ann, avatar: 'https://cdn.bsky.app/a.jpg' }
        media:
          - { image: 'https://cdn.bsky.app/i.jpg', alt: Bluesky picture }
          - { image: 'https://pbs.twimg.com.evil.example/x.jpg', alt: Lookalike }
`,
        ALLOW_X,
      ),
    );
    expect(html).not.toContain('src="https://cdn.bsky.app');
    expect(html).not.toContain('src="https://pbs.twimg.com.evil.example');
    expect(html).toContain('its host is not on the page’s provider allowlist');
    const csp = cspOf(html);
    expect(csp).not.toContain('cdn.bsky.app');
    expect(csp).not.toContain('evil.example');
    expect(
      hostMatchesProvider('x', 'https://pbs.twimg.com.evil.example/x.jpg', { assets: true }),
    ).toBe(false);
    expect(hostMatchesProvider('x', 'https://pbs.twimg.com/x.jpg', { assets: true })).toBe(true);
    // A CDN host is an asset host, never a page host for a labelled block.
    expect(hostMatchesProvider('x', 'https://pbs.twimg.com/x.jpg')).toBe(false);
  });

  it('escapes supplied text and is byte-identical across runs', () => {
    const spec = page(`  - type: social-post
    platform: x
    url: https://x.com/a/status/1
    author: { name: '<img src=x onerror=alert(1)>', handle: a }
    text: '<script>boom()</script>'
    title: '<iframe src=//evil>'
`);
    const { html } = compile(spec);
    expect(html).not.toContain('<script>boom');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;boom()&lt;/script&gt;');
    expect(compile(page(X_POST)).html).toBe(compile(page(X_POST)).html);
  });

  it('lays a feed out by count in the supplied order', () => {
    const one = compile(
      page(`  - type: social-feed
    posts:
      - { platform: x, url: 'https://x.com/a/status/1', author: { name: A } }
`),
    ).html;
    expect(one).toContain('data-layout="featured"');
    expect(one).not.toContain('<ul class="ak-social-feed"');
    const many = compile(
      page(`  - type: social-feed
    id: buzz
    title: Buzz
    posts:
      - { platform: reddit, url: 'https://www.reddit.com/r/a/comments/1/', author: { name: B, handle: b }, metrics: { likes: 2, replies: 1 } }
      - { platform: hackernews, url: 'https://news.ycombinator.com/item?id=1', author: { name: C, handle: c }, title: Show HN }
      - { platform: mastodon, url: 'https://hachyderm.io/@d/1', author: { name: D, handle: d@hachyderm.io }, metrics: { reposts: 3 } }
`),
    ).html;
    expect(many).toContain('data-layout="grid"');
    expect(many).toContain(
      '<ul class="ak-social-feed"><li><article class="ak-social-post" data-platform="reddit"',
    );
    expect(many).toContain('u/b</span>');
    expect(many).toContain('2</data> points');
    expect(many).toContain('1</data> comment<');
    expect(many).toContain('<span class="ak-social-handle">c</span>');
    expect(many).toContain('@d@hachyderm.io');
    expect(many).toContain('3</data> boosts');
    expect(many).toContain('id="buzz-p2-name"');
    expect(many.indexOf('data-platform="reddit"')).toBeLessThan(
      many.indexOf('data-platform="hackernews"'),
    );
  });
});

describe('social-post validation', () => {
  it('repairs a platform alias, a case slip and a doubled @ safely', () => {
    const spec = page(`  - type: social-post
    platform: twitter
    url: https://x.com/a/status/1
    author: { name: A, handle: '@@a' }
  - type: social-post
    platform: Bluesky
    url: https://bsky.app/profile/a/post/1
    author: { name: B }
`);
    const result = repair(spec);
    expect(result.ok).toBe(true);
    expect(result.changes.map((change) => change.rule).sort()).toEqual(
      ['enum/alias', 'enum/case', 'social/handle'].sort(),
    );
    expect(normalizeHandle('  @@@sam ')).toBe('@sam');
  });

  it('reports cross-field problems at their paths', () => {
    const { diagnostics } = validate(
      page(`  - type: social-post
    platform: x
    url: https://bsky.app/profile/a/post/1
    author: { name: A, handle: 'a b' }
    date: yesterday
    metrics: { likes: -1 }
    media:
      - { image: a.png }
      - { image: b.png, video: c.mp4, alt: both }
      - { image: 'https://scontent.cdninstagram.com/v/x.jpg?oe=6720AB12', alt: Signed }
    quoted:
      platform: x
      url: https://x.com/q
      author: { name: Q }
      quoted: { platform: x }
`),
    );
    const at = (path: string) => diagnostics.filter((diagnostic) => diagnostic.path === path);
    expect(at('$.blocks[0].platform')[0]).toMatchObject({ severity: 'warning' });
    expect(at('$.blocks[0].platform')[0]?.message).toContain('looks like Bluesky');
    expect(at('$.blocks[0].author.handle')[0]).toMatchObject({ severity: 'error' });
    expect(at('$.blocks[0].date')[0]).toMatchObject({ severity: 'warning' });
    expect(at('$.blocks[0].metrics.likes')[0]).toMatchObject({ severity: 'error' });
    expect(at('$.blocks[0].media[0].alt')[0]).toMatchObject({ severity: 'error' });
    expect(at('$.blocks[0].media[1]')[0]?.message).toContain('exactly one of image or video');
    expect(at('$.blocks[0].media[2].image')[0]).toMatchObject({ severity: 'warning' });
    expect(at('$.blocks[0].quoted.quoted')[0]?.message).toContain('unknown property');
  });

  it('accepts a deny page with remote posters, avatars and media', () => {
    const result = validate(page(X_POST));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });

  it('rejects an empty author name, which would leave the card unnamed', () => {
    const { diagnostics } = validate(
      page(`  - type: social-post
    platform: x
    url: https://x.com/a/status/1
    author: { name: '  ' }
`),
    );
    expect(diagnostics.find((item) => item.path === '$.blocks[0].author.name')).toMatchObject({
      severity: 'error',
    });
  });

  it('reads supplied dates without a clock', () => {
    expect(parsePostDate('2026-11-13')).toEqual({ datetime: '2026-11-13', label: '2026-11-13' });
    expect(parsePostDate('2026-11-13 09:05+0700')).toEqual({
      datetime: '2026-11-13T09:05+0700',
      label: '2026-11-13 09:05 UTC+07:00',
    });
    expect(parsePostDate('2026-02-30')).toBeUndefined();
    expect(parsePostDate('2026-11-13T24:00Z')).toBeUndefined();
    // HTML datetime takes at most three fraction digits.
    expect(parsePostDate('2026-11-13T09:05:00.123456Z')).toBeUndefined();
    expect(parsePostDate('2 hours ago')).toBeUndefined();
  });
});
