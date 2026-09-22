import { describe, expect, it } from 'vitest';
import { compile, isRenderError, type RenderError } from '../../src/index.js';

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
    expect(result.html).toContain('denies network access');
    expect(result.html).not.toContain('<video');
  });

  it('narrows remote media to the declared providers when the list is present', () => {
    // A direct CDN file is no longer allowed once the page declares providers.
    const result = compile(videoSpec(REMOTE_VIDEO, { policy: withProvider('      - youtube\n') }));
    expect(result.html).not.toContain('<video');
    expect(result.html).toContain('denies network access');
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
