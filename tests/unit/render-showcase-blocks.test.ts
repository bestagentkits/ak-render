import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { buildFileTree, sparkPaths } from '../../src/render/showcase-blocks.js';

function page(blocks: string, policy = 'deny'): string {
  return `version: 1
meta:
  title: Showcase fixture
policy:
  network: ${policy}
blocks:
  - type: hero
    title: Showcase fixture now
${blocks}`;
}

describe('showcase blocks', () => {
  it('splits the hero title into word wrappers without changing its text', () => {
    const { html } = compile(page(''));
    expect(html).toContain(
      '<h1><span class="ak-word"><span>Showcase</span></span> <span class="ak-word"><span>fixture</span></span> <span class="ak-word"><span>now</span></span></h1>',
    );
  });

  it('renders bento tiles with sizes, figures, and local images', () => {
    const { html, features } = compile(
      page(`  - type: bento
    items:
      - title: Big
        size: large
        src: assets/a.png
        alt: A screenshot
      - title: Count
        value: '6'`),
    );
    expect(features).toContain('bento');
    expect(html).toMatch(/<li class="ak-tile" data-media="true" data-size="large">/u);
    expect(html).toContain('<img src="assets/a.png" alt="A screenshot"');
    expect(html).toContain('<p class="ak-tile-value">6</p>');
  });

  it('keeps a remote bento image out of a network-denied page', () => {
    const { html } = compile(
      page(`  - type: bento
    items:
      - title: Remote
        src: https://example.com/a.png
        alt: Remote image`),
    );
    expect(html).not.toMatch(/<img[^>]+src="https:/u);
    // The note keeps the alt text and names the real reason.
    expect(html).toContain(
      '<strong>Remote image</strong>. Remote image not loaded: the page denies network access.',
    );
  });

  it('names a missing capability, not a denied network, when only media is allowed', () => {
    const { html } = compile(
      page(
        `  - type: bento
    items:
      - title: Remote
        src: https://example.com/a.png
        alt: Remote image`,
        '\n    allow: [media]',
      ),
    );
    expect(html).toContain('Remote image not loaded: the page does not allow remote images.');
  });

  it('requires alt text on a bento tile with an image, accepting an explicit empty alt', () => {
    expect(() =>
      compile(
        page(`  - type: bento
    items:
      - title: Shot
        src: assets/a.png`),
      ),
    ).toThrowError(/bento tile with src needs alt text/u);
    const { html } = compile(
      page(`  - type: bento
    items:
      - title: Shot
        src: assets/a.png
        alt: ''`),
    );
    expect(html).toContain('<img src="assets/a.png" alt=""');
  });

  it('lets an allowed remote image through the policy and the CSP', () => {
    const { html } = compile(
      page(
        `  - type: showcase
    title: Remote shot
    src: https://images.example.com/shot.png
    alt: A remote screenshot`,
        '\n    allow: [images]',
      ),
    );
    expect(html).toContain('<img src="https://images.example.com/shot.png"');
    expect(html).toMatch(
      /img-src data: file: (?:'|&#39;)self(?:'|&#39;) https:\/\/images\.example\.com/u,
    );
  });

  it('gives a marquee one readable list and one hidden repeat', () => {
    const { html } = compile(
      page(`  - type: marquee
    label: Highlights
    items: [One, Two]`),
    );
    expect(html).toContain('aria-label="Highlights"');
    expect(html).toContain(
      '<ul class="ak-marquee-track"><li>One</li><li>Two</li></ul><ul class="ak-marquee-track" aria-hidden="true"><li>One</li><li>Two</li></ul>',
    );
  });

  it('renders a terminal session with kinds and a copy control', () => {
    const { html, features } = compile(
      page(`  - type: terminal
    id: session
    lines:
      - kind: command
        text: ak-render themes
      - text: blueprint`),
    );
    expect(features).toEqual(expect.arrayContaining(['terminal', 'copy']));
    expect(html).toContain(
      '<span class="ak-term-line" data-kind="command">ak-render themes</span>',
    );
    expect(html).toContain('<span class="ak-term-line" data-kind="output">blueprint</span>');
    expect(html).toMatch(/data-ak-on-click="[^"]*copy[^"]*session/u);
    // The caption is a direct child of the figure, and names it by title alone.
    expect(html).toMatch(
      /<figure class="ak-block ak-terminal" aria-label="Terminal" data-ak-animate><figcaption class="ak-terminal-bar">/u,
    );
  });

  it('orders file names by code point, independent of the runtime collation', () => {
    const { html } = compile(
      page(`  - type: file-tree
    items:
      - path: ñ.ts
      - path: b.ts
      - path: B.md
      - path: a.ts
      - path: Z.ts`),
    );
    const order = ['a.ts', 'B.md', 'b.ts', 'Z.ts', 'ñ.ts'].map((name) => html.indexOf(`>${name}<`));
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('builds a sorted, compacted file tree with status as text', () => {
    const tree = buildFileTree([
      { path: 'src/render/b.ts', status: 'added' },
      { path: 'src/render/a.ts' },
      { path: 'README.md', status: 'modified' },
    ]);
    expect([...tree.dirs.keys()]).toEqual(['src']);
    expect(tree.files.map((file) => file.name)).toEqual(['README.md']);

    const { html } = compile(
      page(`  - type: file-tree
    items:
      - path: src/render/b.ts
        status: added
      - path: src/render/a.ts
      - path: README.md
        status: modified`),
    );
    // A folder chain with no files of its own folds into one entry.
    expect(html).toContain('data-kind="folder">src/render/</span>');
    expect(html.indexOf('a.ts')).toBeLessThan(html.indexOf('b.ts'));
    expect(html).toContain('<span class="ak-tree-status">added</span>');
    expect(html).toContain('<li data-status="added"><strong>1</strong> added</li>');
  });

  it('renders a before/after slider that works without script', () => {
    const { html, features } = compile(
      page(`  - type: before-after
    before: { src: assets/a.png, alt: Light mode }
    after: { src: assets/b.png, alt: Dark mode, label: Dark }
    start: 30`),
    );
    expect(features).toContain('before-after');
    expect(html).toMatch(
      /<input type="range" class="ak-ba-range" min="0" max="100" step="1" value="30" aria-label="Reveal Before or Dark" \/>/u,
    );
    expect(html).toContain('alt="Light mode"');
    expect(html).toContain('wireBeforeAfter();');
  });

  it('draws KPI sparklines and judges direction against the good side', () => {
    const { html } = compile(
      page(`  - type: kpi
    items:
      - label: Size
        value: 12 kB
        delta: +2 kB
        trend: up
        good: down
        series: [1, 2, 3]
      - label: Flat
        value: '1'`),
    );
    expect(html).toContain('<li class="ak-kpi-card" data-verdict="bad">');
    expect(html).toContain('<span class="ak-sr"> (worsening)</span>');
    expect(html).toContain('<li class="ak-kpi-card" data-verdict="neutral">');
    expect(html).toMatch(/<svg class="ak-kpi-spark"[^>]*aria-hidden="true"/u);
    expect(html.match(/class="ak-kpi-spark"/gu)).toHaveLength(1);
  });

  it('scales a sparkline into its view box', () => {
    const paths = sparkPaths([0, 10]);
    expect(paths.line).toBe('M0 33 L120 3');
    expect(paths.area).toBe('M0 33 L120 3 L120 36 L0 36 Z');
    expect(sparkPaths([5, 5]).line).toBe('M0 18 L120 18');
  });

  it('emits the browser frame for a hero shot and a showcase, and nowhere else', () => {
    const framed = compile(`version: 1
meta:
  title: Framed
blocks:
  - type: hero
    title: Framed
    src: assets/a.png
    alt: A shot`);
    expect(framed.features).toContain('frame');
    expect(framed.html).toContain('.ak-hero-stage{');
    expect(compile(page('')).features).not.toContain('frame');
  });

  it('counts checklist progress and states each item in text', () => {
    const { html } = compile(
      page(`  - type: checklist
    title: Gates
    items:
      - text: Tests
        done: true
      - text: Docs`),
    );
    expect(html).toContain('<strong>1</strong> of 2 done');
    expect(html).toContain('value="50"');
    expect(html).toContain('<span class="ak-sr"> (done)</span>');
    expect(html).toContain('<span class="ak-sr"> (open)</span>');
  });

  it('tree-shakes every showcase stylesheet from a page without those blocks', () => {
    const { html } = compile(page(''));
    const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
    for (const marker of [
      '.ak-bento',
      '.ak-marquee',
      '.ak-terminal',
      '.ak-tree',
      '.ak-ba-stage',
      '.ak-kpi',
      '.ak-showcase',
      '.ak-checklist',
      '.ak-frame-',
      '.ak-hero-stage',
      '.ak-tile-media',
    ]) {
      expect(css).not.toContain(marker);
    }
  });
});
