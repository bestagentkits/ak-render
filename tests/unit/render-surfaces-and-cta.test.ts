import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';

function page(blocks: string, hero = '', policy = 'deny'): string {
  return `version: 1
meta:
  title: Surface fixture
theme:
  preset: blueprint
policy:
  network: ${policy}
blocks:
  - type: hero
    title: Surface fixture
${hero}${blocks}`;
}

const css = (html: string): string => html.slice(html.indexOf('<style'), html.indexOf('</style>'));

describe('night band', () => {
  it('sets an inverse section on the theme dark palette', () => {
    const { html } = compile(
      page(`  - type: section
    title: Numbers
    surface: inverse
    blocks:
      - type: text
        text: Inside the band`),
    );
    expect(html).toMatch(/<section class="ak-block ak-section"[^>]*data-surface="inverse"/u);
    // Blueprint's dark text colour, declared as a literal inside the band.
    expect(css(html)).toMatch(/\[data-surface="inverse"\]\{[^}]*--ak-color-text:#dbe7f3/u);
    expect(css(html)).toContain('color-scheme:dark');
  });

  it('emits no band sheet for a page without one', () => {
    const { html } = compile(
      page(`  - type: section
    title: Plain
    blocks:
      - type: text
        text: Outside`),
    );
    expect(html).not.toContain('data-surface');
    expect(css(html)).not.toContain('[data-surface');
  });
});

describe('cta block', () => {
  const ctaBlock = `  - type: cta
    eyebrow: Next
    title: Ship the page.
    text: Open it from disk.
    actions:
      - label: Read the docs
        href: https://example.com/docs
        variant: primary
      - label: Gallery
        href: index.html`;

  it('renders a heading and real links on the night band', () => {
    const { html, features } = compile(page(ctaBlock));
    expect(features).toContain('cta');
    expect(html).toMatch(/<section class="ak-block ak-cta"[^>]*data-surface="inverse"/u);
    expect(html).toContain('<h2 class="ak-cta-title">Ship the page.</h2>');
    expect(html).toContain(
      '<a class="ak-btn" data-variant="primary" href="https://example.com/docs" rel="noreferrer noopener">Read the docs</a>',
    );
    expect(html).toContain('data-variant="secondary" href="index.html"');
    expect(css(html)).toContain('[data-surface="inverse"]');
  });

  it('rejects a script URL in an action', () => {
    expect(() =>
      compile(
        page(`  - type: cta
    title: Bad
    actions:
      - label: Run
        href: javascript:alert(1)`),
      ),
    ).toThrow();
  });

  it('tree-shakes the CTA sheet from a page without one', () => {
    expect(css(compile(page('')).html)).not.toContain('.ak-cta');
  });
});

describe('hero media', () => {
  const shot = `    align: center
    src: assets/shot.webp
    alt: The product
    address: app.html
`;

  it('frames a product shot below the copy and loads it eagerly', () => {
    const { html } = compile(page('', shot));
    expect(html).toMatch(/class="ak-block ak-hero"[^>]*data-align="center"[^>]*data-media="true"/u);
    expect(html).toContain('<figure class="ak-hero-media"><div class="ak-hero-stage">');
    expect(html).toContain('<span class="ak-frame-address">app.html</span>');
    expect(html).toContain('<img src="assets/shot.webp" alt="The product" loading="eager"');
  });

  it('requires alt text when a shot is set', () => {
    expect(() => compile(page('', '    src: assets/shot.webp\n'))).toThrow(/alt text/u);
  });

  it('keeps a remote shot out of a network-denied page', () => {
    const { html } = compile(page('', '    src: https://example.com/a.png\n    alt: Remote\n'));
    expect(html).not.toMatch(/<img[^>]+src="https:/u);
    expect(html).toContain('Remote image not loaded');
  });

  it('lets an allowed remote shot through the policy and the CSP', () => {
    const { html } = compile(
      page(
        '',
        '    src: https://images.example.com/a.png\n    alt: Remote\n',
        '\n    allow: [images]',
      ),
    );
    expect(html).toMatch(
      /img-src data: file: (?:'|&#39;)self(?:'|&#39;) https:\/\/images\.example\.com/u,
    );
  });
});

describe('theme toggle transition', () => {
  it('reveals the new scheme from the toggle where the engine supports it', () => {
    const { html } = compile(page(''));
    expect(html).toContain('startViewTransition');
    expect(css(html)).toContain('::view-transition-new(root)');
    expect(css(html)).toMatch(/prefers-reduced-motion:no-preference\)\{::view-transition-old/u);
  });
});
