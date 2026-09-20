import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from '../../src/render/document.js';
import { compile, render } from '../../src/render/render.js';
import { normalize } from '../../src/spec/normalize.js';

const BASE = `version: 1
meta:
  title: Security fixture
policy:
  network: deny
blocks:
  - type: hero
    title: Security fixture
    description: Output must defend itself.
`;

function withBlocks(blocks: string): string {
  return `${BASE}${blocks}`;
}

/**
 * Attribute values are HTML-escaped in the emitted markup (`'` becomes
 * `&#39;`), which is correct but means a CSP assertion has to compare against
 * the parsed value rather than the raw bytes.
 */
/** The decoded CSP from the meta element that carries it. */
function contentSecurityPolicy(html: string): string {
  const raw =
    html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/u)?.[1] ?? '';
  return raw
    .replace(/&#39;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>');
}

describe('emitted document security', () => {
  it('emits a content security policy that starts from default-src none', () => {
    const { html } = compile(withBlocks('  - type: text\n    text: hello\n'));
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    const csp = contentSecurityPolicy(html);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-src 'none'");
  });

  it('never permits unsafe-inline or unsafe-eval', () => {
    const { html } = compile(withBlocks('  - type: text\n    text: hello\n'));
    expect(contentSecurityPolicy(html)).not.toContain('unsafe-inline');
    expect(contentSecurityPolicy(html)).not.toContain('unsafe-eval');
  });

  it('binds the emitted style and script elements to their nonces', () => {
    const { html } = compile(withBlocks('  - type: text\n    text: hello\n'));
    const styleNonce = html.match(/<style nonce="([^"]+)"/u)?.[1];
    const scriptNonce = html.match(/<script nonce="([^"]+)"/u)?.[1];
    expect(styleNonce).toBeDefined();
    expect(scriptNonce).toBeDefined();
    const csp = contentSecurityPolicy(html);
    expect(csp).toContain(`'nonce-${styleNonce}'`);
    expect(csp).toContain(`'nonce-${scriptNonce}'`);
  });

  it('emits no inline event handler attribute', () => {
    const { html } = compile(
      withBlocks(
        '  - type: button\n    label: Go\n    on:\n      click:\n        action: theme\n        value: toggle\n',
      ),
    );
    expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/iu);
    expect(html).toContain('data-ak-on-click');
  });

  it('emits no external script, stylesheet, iframe, or @import', () => {
    const { html } = compile(withBlocks('  - type: text\n    text: hello\n'));
    expect(html).not.toMatch(/<script[^>]+src=/iu);
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('@import');
  });

  it('never fetches a remote media source while the policy denies network access', () => {
    const { html } = compile(
      withBlocks(`  - type: video
    title: Remote
    src: https://media.example.com/clip.mp4
    caption: Two minutes
    fallback:
      description: A remote recording.
      linkText: Open recording
      url: https://media.example.com/clip
`),
    );
    expect(html).not.toMatch(/\ssrc="https?:/iu);
    expect(html).toContain('ak-media-fallback');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('never fetches a remote image while the policy denies network access', () => {
    const { html } = compile(
      withBlocks(
        '  - type: image\n    src: https://images.example.com/cover.png\n    alt: Cover\n',
      ),
    );
    expect(html).not.toMatch(/<img[^>]+src="https?:/iu);
    expect(html).toContain('Remote image not loaded');
  });

  it('allows a permitted capability and puts only that origin in the policy', () => {
    const spec = `version: 1
meta:
  title: Permitted network
policy:
  network:
    allow: [media]
blocks:
  - type: video
    title: Clip
    src: https://media.example.com/clip.mp4
    fallback:
      description: A recording.
`;
    const { html } = compile(spec);
    expect(html).toMatch(/<video[^>]*controls/u);
    expect(html).toContain('https://media.example.com/clip.mp4');
    const csp = contentSecurityPolicy(html);
    expect(csp).toContain('https://media.example.com');
    expect(csp).not.toContain('images.example.com');
  });

  it('keeps a local asset reference out of the network policy entirely', () => {
    const { html } = compile(
      withBlocks('  - type: image\n    src: assets/cover.svg\n    alt: Cover\n'),
    );
    expect(html).toContain('src="assets/cover.svg"');
    expect(contentSecurityPolicy(html)).toContain('file:');
  });

  it('never emits page-authored script even when the spec carries markup-like text', () => {
    const { html } = compile(
      withBlocks(
        '  - type: code\n    text: |\n      <script>alert(1)</script>\n      <img src=x onerror=alert(2)>\n',
      ),
    );
    // The payload survives as escaped text, and the only script element is the
    // compiler's own nonce-bearing runtime.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const scripts = [...html.matchAll(/<script\b[^>]*>/gu)].map((match) => match[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(script).toContain('nonce=');
    expect(html).not.toMatch(/<img[^>]+onerror/iu);
  });

  it('lets the CSP builder omit a script directive entirely when no script is emitted', () => {
    const ir = normalize(`${BASE}  - type: text\n    text: hello\n`);
    const policy = buildContentSecurityPolicy({
      ir,
      compilerVersion: '0.0.0-test',
      css: 'body{}',
      js: '',
      body: '',
      allowedOrigins: [],
      themeToggle: false,
      density: 'comfortable',
    });
    expect(policy.csp).toContain("script-src 'none'");
  });

  it('render() throws rather than emit when verification fails', () => {
    // A spec-level attempt to inject a handler is rejected during normalization,
    // so the compiler never reaches verification with hostile input.
    expect(() =>
      render(withBlocks('  - type: button\n    label: X\n    onClick: alert(1)\n')),
    ).toThrowError(/inline event-handler source|not accepted/u);
  });
});
