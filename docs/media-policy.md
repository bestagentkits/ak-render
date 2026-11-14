# Media and network policy

A page is offline by default. `policy.network` defaults to `deny`, and under
`deny` nothing is fetched: a remote image, video, or audio reference becomes a
safe fallback with the text a reader needs — a poster, a description, and a link
— rather than a silent request.

**AK Render never emits an iframe.** That is a structural property of the
compiler, not a setting: `verifyDocument` fails the build if the emitted markup
contains one, and the forbidden-key scan rejects `iframe`, `embed`, `object`,
`srcdoc`, `rawHTML`, and the rest at the spec boundary. A provider reference
therefore becomes a link, never a frame, even when it is explicitly allowed.

## Opting in

```yaml
version: 1
meta:
  title: Media
policy:
  network:
    allow:
      - images
      - media
    providers:
      - youtube
blocks:
  - type: video
    id: clip
    title: Talk
    src: https://www.youtube.com/watch?v=…
    provider: youtube
    fallback:
      description: A conference talk.
```

`allow` names capabilities. The vocabulary is closed:

| Capability | Covers |
| --- | --- |
| `images` | `image`, `gallery` sources, a `video` block's `poster`, and social post avatars, images and posters |
| `media` | `video`, `audio` sources and social post videos |
| `fonts` | reserved; no fonts are fetched (bundled faces are inlined as `data:`) |

An unknown capability, an empty `allow` list, or an unknown key inside
`policy.network` is an error rather than a silently ignored opt-in.

## Provider allowlist

`providers` is a second, narrower gate. When it is present, remote media must
come from one of the named providers' hosts. A subdomain of a listed host
matches. [`src/spec/providers.ts`](../src/spec/providers.ts) owns the list:

| Provider | Page hosts | Asset hosts |
| --- | --- | --- |
| `youtube` | `youtube.com`, `youtu.be`, `youtube-nocookie.com` | `ytimg.com`, `yt3.ggpht.com` |
| `vimeo` | `vimeo.com` | |
| `spotify` | `open.spotify.com` | |
| `soundcloud` | `soundcloud.com` | |
| `x` | `x.com`, `twitter.com` | `twimg.com` |
| `threads` | `threads.net`, `threads.com` | `cdninstagram.com`, `fbcdn.net` |
| `bluesky` | `bsky.app` | none: `cdn.bsky.app` and `video.bsky.app` are already under `bsky.app` |
| `linkedin` | `linkedin.com` | `licdn.com` |
| `reddit` | `reddit.com`, `redd.it` | `redditmedia.com`, `redditstatic.com` |
| `hackernews` | `news.ycombinator.com` | |

Asset hosts are the CDNs a provider serves avatars, images and video files
from. They count only for a loaded file that names no provider, such as a
social post's avatar or media item: an unlabelled asset passes when its host
is one of a declared provider's page hosts or asset hosts. A block that names a
`provider` still needs one of that provider's page hosts.

Two rules follow, and both are tested:

- **A declared list narrows.** With `providers: [youtube]`, a direct CDN file
  outside YouTube's hosts is no longer allowed, because the page has said which
  hosts it trusts. A page of social posts must list every platform it quotes,
  or omit `providers` and rely on the capability gate alone. Mastodon and
  `other` posts have no provider entry, so their remote media loads only on a
  page without `providers`.
- **Matching is on the parsed hostname.** `https://youtube.com.evil.example/`
  does not match `youtube`, so a lookalike domain cannot inherit an allowlist
  entry by containing the provider's name.

A block may name its `provider`. That is a statement of intent, not a
promotion: the provider must also be in the page's allowlist and the capability
must be opted into, or the block falls back.

## What a reader sees

| State | Emitted |
| --- | --- |
| Local path | `<img>`, `<video controls>`, `<audio controls>` |
| Remote, `deny` | Fallback: description, note, link. No element, no request. |
| Remote, allowed | The media element, with the origin added to `img-src`/`media-src` in the CSP. |
| Provider, allowed | Poster and link, plus a note that the page links to the provider instead of embedding. |
| Provider, not allowed | The same fallback, with a note that the page denies network access. |

The Content Security Policy is derived from what the page actually uses: a page
that allows nothing emits `img-src data: file:` and `media-src file:` with no
remote origin at all. An origin enters `img-src` or `media-src` only when its
reference passes the same gate the renderer applies, provider allowlist
included, so a host the page did not allow never appears in the policy
([`src/spec/asset-references.ts`](../src/spec/asset-references.ts)).

## Social posts

`social-post` and `social-feed` draw static cards from supplied data. They emit
no frame, no platform script and no beacon. Each avatar and media file passes
the gate above on its own:

- A blocked avatar becomes the author's initials.
- A blocked image becomes its alt text with the reason it was not loaded.
- A blocked video becomes its label, the reason and a "Watch on" link to the
  post. A blocked `poster` is dropped rather than rejected, so a `deny` page of
  posts still validates.
- Under `deny` the cards make no request at all.

Threads media is served from signed Meta CDN URLs that expire; `validate` warns
on a `cdninstagram.com` or `fbcdn.net` URL carrying `oe=`. Copy such a file to
a local asset.

## Resolving a post URL

`ak-render resolve-post <url>` is an authoring-time helper, not part of the
compiler: `render`, `validate` and the MCP tools never call it, so compiling
stays offline and deterministic. It prints one `social-post` block as plain
spec data; counts carry `metrics.asOf` with the capture time.

| Platform | Source (no key) | Gives |
| --- | --- | --- |
| X | `publish.twitter.com/oembed` | author, handle, text, date (from the post id) |
| YouTube | `youtube.com/oembed` | title, channel, thumbnail |
| Bluesky | `public.api.bsky.app` `getPostThread` | author, avatar, text, date, images, counts, quoted post |
| Reddit | `www.reddit.com/comments/<id>.json` | title, body, author, date, image, score, comments |
| Hacker News | `hacker-news.firebaseio.com` | title, link, text, author, date, points, comments |

Threads, LinkedIn and other sites exit non-zero; write their fields by hand.

The post URL is only parsed, never fetched. Each platform maps it to one fixed
endpoint, and every request and redirect must be https, on that endpoint
allowlist and not a private host; each response is capped at 1 MB and the whole
resolve at 10 s
(`--timeout`). Returned HTML is reduced to text, never passed through. Reddit
and X may refuse anonymous requests from some networks; the command then exits
1 with the HTTP status, and the post has to be written by hand.

## Rejected input

| Input | Result |
| --- | --- |
| `iframe`, `embed`, `object`, `srcdoc`, `rawHTML`, `style`, `script` as a spec key | `POLICY_VIOLATION` |
| `policy.network.allow: []` | `SPEC_VALIDATION_ERROR` |
| `policy.network.allow: [frames]` | `POLICY_VIOLATION` with the known capability list |
| `policy.network.providers: []` | `SPEC_VALIDATION_ERROR` |
| `policy.network.providers: [mytube]` | `POLICY_VIOLATION` with the known provider list |
| `policy.network.frames: true` | `SPEC_VALIDATION_ERROR` |
| A remote video `poster` the policy does not allow as an image | `POLICY_VIOLATION` at `$.blocks[…].poster`, naming the reason |

A `video` block's poster is the one remote reference that is rejected instead
of degraded: the fallback it would sit in already links to the video, so a
blocked poster has nothing left to show. Use a local poster file, or add
`images` to `allow`. A social post's poster is dropped instead, as described
above.

`fixtures/rejected/` holds the injection fixtures this is verified against.
