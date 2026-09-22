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
| `images` | `image`, `gallery` sources |
| `media` | `video`, `audio` sources |
| `fonts` | reserved; no fonts are fetched today |

An unknown capability, an empty `allow` list, or an unknown key inside
`policy.network` is an error rather than a silently ignored opt-in.

## Provider allowlist

`providers` is a second, narrower gate. When it is present, remote media must
come from one of the named providers' own hosts:

| Provider | Hosts |
| --- | --- |
| `youtube` | `youtube.com`, `youtu.be`, `youtube-nocookie.com` |
| `vimeo` | `vimeo.com` |
| `spotify` | `open.spotify.com` |
| `soundcloud` | `soundcloud.com` |

Two rules follow, and both are tested:

- **A declared list narrows.** With `providers: [youtube]`, a direct CDN file is
  no longer allowed, because the page has said which hosts it trusts.
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
remote origin at all.

## Rejected input

| Input | Result |
| --- | --- |
| `iframe`, `embed`, `object`, `srcdoc`, `rawHTML`, `style`, `script` as a spec key | `POLICY_VIOLATION` |
| `policy.network.allow: []` | `SPEC_VALIDATION_ERROR` |
| `policy.network.allow: [frames]` | `POLICY_VIOLATION` with the known capability list |
| `policy.network.providers: []` | `SPEC_VALIDATION_ERROR` |
| `policy.network.providers: [mytube]` | `POLICY_VIOLATION` with the known provider list |
| `policy.network.frames: true` | `SPEC_VALIDATION_ERROR` |

`fixtures/rejected/` holds the injection fixtures this is verified against.
