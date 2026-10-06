import { describe, expect, it } from 'vitest';
import {
  compile,
  isRenderError,
  loadTheme,
  normalizeSpec,
  type RenderError,
  validate,
} from '../../src/index.js';
import { DEFAULT_REGISTRY } from '../../src/registry/registry.js';
import { renderNode } from '../../src/render/blocks.js';

const REMOTE_VIDEO = 'https://cdn.example.test/clip.mp4';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

function videoSpec(src: string, options: { policy?: string; provider?: string } = {}): string {
  return `version: 1
meta:
  title: Media
${options.policy ?? ''}blocks:
  - type: video
    id: clip
    title: Clip
    src: ${src}
${options.provider === undefined ? '' : `    provider: ${options.provider}\n`}    fallback:
      description: A short clip.
`;
}

describe('media policy: offline default', () => {
  it('degrades a remote video to a poster plus link and emits no video element', () => {
    const result = compile(videoSpec(REMOTE_VIDEO));
    expect(result.html).not.toContain('<video');
    expect(result.html).toContain('ak-media-fallback');
    expect(result.html).toContain('denies network access');
    expect(result.html).toContain(`href="${REMOTE_VIDEO}"`);
  });

  it('degrades a remote image to a link', () => {
    const result = compile(`version: 1
meta:
  title: Media
blocks:
  - type: image
    id: shot
    src: https://cdn.example.test/shot.png
    alt: A screenshot
`);
    expect(result.html).not.toContain('<img');
    expect(result.html).toContain('Remote image not loaded');
    expect(result.html).toContain('A screenshot');
  });

  it('always plays a local source, because a relative path is not remote', () => {
    const result = compile(videoSpec('./assets/clip.mp4'));
    expect(result.html).toContain('<video controls');
    expect(result.html).toContain('src="./assets/clip.mp4"');
  });

  it('never emits an iframe, whatever the media blocks ask for', () => {
    for (const spec of [videoSpec(REMOTE_VIDEO), videoSpec(YOUTUBE, { provider: 'youtube' })]) {
      expect(compile(spec).html).not.toContain('<iframe');
    }
  });
});

describe('media policy: explicit opt-in', () => {
  const allowMedia = 'policy:\n  network:\n    allow:\n      - media\n';

  it('loads a remote source only when the capability is opted into', () => {
    const denied = compile(videoSpec(REMOTE_VIDEO));
    expect(denied.html).not.toContain('<video');
    const allowed = compile(videoSpec(REMOTE_VIDEO, { policy: allowMedia }));
    expect(allowed.html).toContain('<video controls');
    expect(allowed.html).toContain(REMOTE_VIDEO);
  });

  it('puts the allowed origin in the content security policy', () => {
    const result = compile(videoSpec(REMOTE_VIDEO, { policy: allowMedia }));
    expect(result.html).toContain('https://cdn.example.test');
  });

  it('keeps an opted-in but unlisted provider as a link', () => {
    const result = compile(videoSpec(YOUTUBE, { policy: allowMedia, provider: 'youtube' }));
    expect(result.html).not.toContain('<iframe');
    expect(result.html).not.toContain('<video');
    expect(result.html).toContain('links to YouTube instead');
    expect(result.html).toContain('Open on YouTube');
  });
});

describe('media policy: provider allowlist', () => {
  const withProvider = (providers: string): string =>
    `policy:\n  network:\n    allow:\n      - media\n    providers:\n${providers}`;

  it('allows a reference from an allowlisted provider host', () => {
    const result = compile(
      videoSpec(YOUTUBE, {
        policy: withProvider('      - youtube\n'),
        provider: 'youtube',
      }),
    );
    expect(result.html).toContain('links to YouTube instead');
    // Attribute values escape `=` as `&#61;`, so the reference survives in its
    // emitted (encoded) form; the browser decodes it back to the same URL.
    expect(result.html).toContain('https://www.youtube.com/watch?v&#61;dQw4w9WgXcQ');
    // Even allowed, a provider page is linked, never framed.
    expect(result.html).not.toContain('<iframe');
  });

  it('refuses a lookalike host that merely contains the provider name', () => {
    const result = compile(
      videoSpec('https://youtube.com.evil.example/watch?v=1', {
        policy: withProvider('      - youtube\n'),
        provider: 'youtube',
      }),
    );
    // The note names the real reason: the host, not the network as a whole.
    expect(result.html).toContain('not on the page’s provider allowlist');
    expect(result.html).not.toContain('<video');
  });

  it('narrows remote media to the declared providers when the list is present', () => {
    // A direct CDN file is no longer allowed once the page declares providers.
    const result = compile(videoSpec(REMOTE_VIDEO, { policy: withProvider('      - youtube\n') }));
    expect(result.html).not.toContain('<video');
    expect(result.html).toContain('not on the page’s provider allowlist');
  });

  it('allows a direct CDN file when no provider list is declared', () => {
    const result = compile(
      videoSpec(REMOTE_VIDEO, { policy: 'policy:\n  network:\n    allow:\n      - media\n' }),
    );
    expect(result.html).toContain('<video controls');
  });

  it('rejects an unknown provider name with the known list', () => {
    try {
      compile(videoSpec(YOUTUBE, { policy: withProvider('      - mytube\n') }));
      throw new Error('expected a rejection');
    } catch (error) {
      expect(isRenderError(error)).toBe(true);
      expect((error as RenderError).code).toBe('POLICY_VIOLATION');
      expect(JSON.stringify((error as RenderError).details?.['allowed'])).toContain('youtube');
    }
  });

  it('rejects an unknown network policy field', () => {
    expect(() =>
      compile(
        videoSpec(REMOTE_VIDEO, {
          policy: 'policy:\n  network:\n    allow:\n      - media\n    frames: true\n',
        }),
      ),
    ).toThrowError(/unknown network policy field/u);
  });

  it('rejects an empty provider list rather than treating it as "allow all"', () => {
    expect(() =>
      compile(
        videoSpec(REMOTE_VIDEO, {
          policy: 'policy:\n  network:\n    allow:\n      - media\n    providers: []\n',
        }),
      ),
    ).toThrowError(/non-empty list of provider names/u);
  });

  it('rejects an empty capability list', () => {
    expect(() =>
      compile(videoSpec(REMOTE_VIDEO, { policy: 'policy:\n  network:\n    allow: []\n' })),
    ).toThrowError(/non-empty list of capabilities/u);
  });

  it('rejects an unknown capability', () => {
    expect(() =>
      compile(
        videoSpec(REMOTE_VIDEO, { policy: 'policy:\n  network:\n    allow:\n      - frames\n' }),
      ),
    ).toThrowError(/unknown network capability/u);
  });
});

describe('media policy: audio', () => {
  it('degrades remote audio and honours the provider allowlist', () => {
    const result = compile(`version: 1
meta:
  title: Media
blocks:
  - type: audio
    id: track
    title: Track
    src: https://open.spotify.com/track/abc
    provider: spotify
    fallback:
      description: A track.
`);
    expect(result.html).not.toContain('<audio');
    expect(result.html).toContain('links to Spotify instead');
  });

  it('plays local audio', () => {
    const result = compile(`version: 1
meta:
  title: Media
blocks:
  - type: audio
    id: track
    title: Track
    src: ./assets/track.mp3
    fallback:
      description: A track.
`);
    expect(result.html).toContain('<audio controls');
  });
});

describe('media policy: video poster', () => {
  const REMOTE_POSTER = 'https://img.example.test/poster.png';
  const allowImages = 'policy:\n  network:\n    allow:\n      - images\n';
  const posterSpec = (
    src: string,
    options: { policy?: string; provider?: string; poster?: string } = {},
  ): string =>
    videoSpec(src, options).replace(
      '    fallback:\n',
      `    poster: ${options.poster ?? REMOTE_POSTER}\n    fallback:\n`,
    );

  it('rejects a remote poster at validate with its own path and the policy reason', () => {
    for (const spec of [
      posterSpec(REMOTE_VIDEO),
      posterSpec(YOUTUBE, { provider: 'youtube' }),
      posterSpec('./assets/clip.mp4'),
    ]) {
      const result = validate(spec);
      expect(result.ok).toBe(false);
      const diagnostic = result.diagnostics.find((entry) => entry.severity === 'error');
      expect(diagnostic?.code).toBe('POLICY_VIOLATION');
      expect(diagnostic?.path).toBe('$.blocks[0].poster');
      expect(diagnostic?.nodeId).toBe('clip');
      expect(diagnostic?.message).toContain('the page denies network access');
    }
  });

  it('names the missing capability when the page allows only media', () => {
    const result = validate(
      posterSpec(REMOTE_VIDEO, { policy: 'policy:\n  network:\n    allow:\n      - media\n' }),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.path).toBe('$.blocks[0].poster');
    expect(result.diagnostics[0]?.message).toContain('the page does not allow remote images');
  });

  it('fails compile at the poster path rather than the document root', () => {
    try {
      compile(posterSpec(REMOTE_VIDEO));
      throw new Error('expected a rejection');
    } catch (error) {
      expect(isRenderError(error)).toBe(true);
      expect((error as RenderError).code).toBe('POLICY_VIOLATION');
      expect((error as RenderError).path).toBe('$.blocks[0].poster');
    }
  });

  it('accepts a local poster under the default deny policy', () => {
    const spec = posterSpec(REMOTE_VIDEO, { poster: 'assets/poster.png' });
    expect(validate(spec).ok).toBe(true);
    expect(compile(spec).html).toContain('<img src="assets/poster.png" alt="" />');
  });

  it('emits a remote poster once remote images are allowed, with its origin in the CSP', () => {
    const fallback = compile(posterSpec(REMOTE_VIDEO, { policy: allowImages }));
    expect(validate(posterSpec(REMOTE_VIDEO, { policy: allowImages })).ok).toBe(true);
    expect(fallback.html).toContain(`<img src="${REMOTE_POSTER}" alt="" />`);
    // The CSP sits in a meta attribute, so its quotes are entity-escaped.
    expect(fallback.html).toContain('img-src data: file: &#39;self&#39; https://img.example.test;');

    const player = compile(
      posterSpec(REMOTE_VIDEO, {
        policy: 'policy:\n  network:\n    allow:\n      - images\n      - media\n',
      }),
    );
    expect(player.html).toContain(`<video controls preload="metadata" poster="${REMOTE_POSTER}">`);
  });

  it('drops a blocked poster in the renderer when the IR skipped validation', () => {
    const { ir } = normalizeSpec(posterSpec(REMOTE_VIDEO));
    const node = ir.nodes.find((candidate) => candidate.type === 'video');
    if (node === undefined) throw new Error('expected a video node');
    const markup = renderNode(node, {
      ir,
      theme: loadTheme(),
      features: new Set(),
      registry: DEFAULT_REGISTRY,
      renderChildren: () => '',
      renderSlot: () => '',
      byId: () => undefined,
    });
    expect(markup).toContain('ak-media-fallback');
    expect(markup).not.toContain(REMOTE_POSTER);
    expect(markup).not.toContain('<img');
  });
});
