import { describe, expect, it } from 'vitest';
import { checkAdapterMarkup, compile, MAX_DIAGRAM_MARKUP_BYTES } from '../../src/index.js';

const SPEC = `version: 1
meta: { title: Structure }
blocks:
  - type: diagram-panel
    id: arch
    title: Architecture
    spec:
      components: [ { id: a, label: Alpha } ]
`;

/**
 * Markup shaped like a typed diagram compiler's output: a title, data
 * attributes of its own, comments, keyframes, a reduced-motion guard that uses
 * `!important`, and inline step variables.
 */
const COMPILER_SHAPED_SVG = `<svg class="ak-diagram-svg" viewBox="0 0 300 120" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pipeline" data-diagram-type="architecture" data-theme="dark"><title>Pipeline</title><defs><style>/* core styles */
svg{--ak-bg:#031c18;font-family:system-ui, sans-serif;}
.ak-node-card{fill:var(--ak-bg);stroke:#10b981}
/* Motion */
@keyframes ak-node-in{from{opacity:0}to{opacity:1}}
.ak-node[data-animate]{animation:ak-node-in .4s ease-out both;animation-delay:calc(var(--step, 0) * 110ms)}
@media (prefers-reduced-motion: reduce){.ak-diagram-svg *,.ak-diagram-svg{animation:none !important;transition:none !important;}}
</style><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs><g class="ak-node" data-node-id="api" data-animate="node" tabindex="0" style="--step:1"><rect class="ak-node-card" x="10" y="30" width="120" height="50" rx="10"/><text x="30" y="60">API &amp; Gateway</text></g><path d="M130 55H200" marker-end="url(#arrow)"/></svg>`;

function reasonFor(markup: string): string | undefined {
  return checkAdapterMarkup(markup).reason;
}

describe('diagram adapter markup structure: accepted', () => {
  it('accepts markup shaped like a typed diagram compiler output', () => {
    expect(checkAdapterMarkup(COMPILER_SHAPED_SVG)).toEqual({ ok: true });
    const result = compile(SPEC, {
      diagramAdapter: { name: 'compiler', version: '1', render: () => COMPILER_SHAPED_SVG },
    });
    expect(result.html).toContain('data-ak-diagram-adapter="compiler"');
    // Only the inline step variable is reported; everything else is kept.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toMatch(/1 inline style attribute/u);
    expect(result.html).not.toContain('core styles');
    expect(result.html).not.toContain('animation:none !important');
  });

  const accepted: readonly [string, string][] = [
    ['svg title and desc', '<svg><title>T</title><desc>D</desc><g><rect /></g></svg>'],
    ['HTML void elements', '<div><br><img alt="" src="#a"><hr /></div>'],
    ['a less-than sign in text', '<svg><text>a &lt; b and 3 < 4</text></svg>'],
    ['a less-than sign in an attribute value', '<svg><g aria-label="a<b"><rect /></g></svg>'],
    ['mixed-case SVG names', '<svg><linearGradient id="g"><stop /></linearGradient></svg>'],
    ['data attributes of its own', '<svg><g data-node-id="a" data-edge-id="b"></g></svg>'],
    [
      'fragment references',
      `<svg><use href="#node" /><use xlink:href='#edge' /><a HREF=#legend><text>x</text></a></svg>`,
    ],
  ];
  for (const [label, markup] of accepted) {
    it(`accepts ${label}`, () => {
      expect(checkAdapterMarkup(markup), label).toEqual({ ok: true });
    });
  }
});

describe('diagram adapter markup structure: refused', () => {
  const refused: readonly [string, string, string | RegExp][] = [
    ['a stray end tag that would close the page', '<svg></svg></figure>', /end tag <\/figure>/u],
    ['an end tag closing the panel', '</div><svg></svg>', /end tag <\/div>/u],
    ['misnested elements', '<svg><g><a></g></a></svg>', /end tag <\/g>/u],
    ['an element left open', '<svg><g><rect /></svg>', /end tag <\/svg>/u],
    ['an unclosed root', '<svg><rect />', 'unclosed svg element'],
    ['an unclosed HTML element', '<div><b>bold</div>', /end tag <\/div>/u],
    ['plaintext', '<plaintext>rest of page', 'plaintext element'],
    ['textarea', '<textarea>x</textarea>', 'textarea element'],
    ['xmp', '<xmp>x</xmp>', 'xmp element'],
    ['noembed', '<noembed>x</noembed>', 'noembed element'],
    ['noframes', '<noframes>x</noframes>', 'noframes element'],
    ['noscript', '<noscript>x</noscript>', 'noscript element'],
    ['template', '<template><svg></svg></template>', 'template element'],
    ['a title outside svg', '<title>x</title>', 'title element outside svg'],
    ['body, which merges attributes into the page', '<body class="x"></body>', 'body element'],
    ['html', '<html lang="x"></html>', 'html element'],
    ['meta', '<meta http-equiv="refresh" content="0">', 'meta element'],
    ['link', '<link rel="stylesheet" href="x.css">', 'link element'],
    ['math', '<math><mi>x</mi></math>', 'math element'],
    ['an HTML element that breaks out of svg', '<svg><div>x</div></svg>', /HTML div element/u],
    ['a self-closing HTML element', '<div/><svg></svg>', /self-closing HTML div/u],
    ['a runtime hook attribute', '<svg><g data-ak-on-click="[]"></g></svg>', /data-ak-on-click/u],
    ['a node id hook', '<svg data-ak-id="hero"></svg>', /reserved attribute data-ak-id/u],
    ['an uppercase hook', '<svg DATA-AK-THEME-TOGGLE></svg>', /data-ak-theme-toggle/u],
    ['an HTML comment', '<svg><!-- </g> --></svg>', 'comment or markup declaration'],
    ['CDATA', '<svg><![CDATA[x]]></svg>', 'comment or markup declaration'],
    ['an XML declaration', '<?xml version="1.0"?><svg></svg>', 'comment or markup declaration'],
    ['a malformed tag', '<svg><g a="1"b="2"></g></svg>', 'malformed tag'],
    ['a malformed end tag', '<svg></ g></svg>', 'malformed end tag'],
  ];
  for (const [label, markup, expected] of refused) {
    it(`refuses ${label}`, () => {
      const why = reasonFor(markup);
      if (typeof expected === 'string') expect(why, label).toBe(expected);
      else expect(why, label).toMatch(expected);
    });
  }

  const urls: readonly [string, string, string][] = [
    ['a remote href', '<svg><a href="https://evil.example/"><text>x</text></a></svg>', 'href'],
    ['a scheme-relative href', '<svg><use href="//evil.example/s.svg#a" /></svg>', 'href'],
    ['a relative href', '<svg><use href="sprite.svg#a" /></svg>', 'href'],
    ['a fragment in another document', '<svg><use href="/x.svg#a" /></svg>', 'href'],
    ['an empty href', '<svg><a href=""><text>x</text></a></svg>', 'href'],
    ['an href with no value', '<svg><a href><text>x</text></a></svg>', 'href'],
    ['an uppercase HREF', '<svg><image HREF="x.png" /></svg>', 'href'],
    ['an xlink:href', '<svg><image xlink:href="x.png" /></svg>', 'xlink:href'],
    ['an XLINK:HREF', '<svg><use XLINK:HREF="x.svg#a" /></svg>', 'xlink:href'],
    ['a data URL', '<svg><image href="data:image/png;base64,AAAA" /></svg>', 'href'],
    ['an entity-encoded fragment', '<svg><use href="&#35;a" /></svg>', 'href'],
    ['an img src', '<div><img alt="" src="x.png"></div>', 'src'],
    ['an img srcset', '<div><img alt="" src="#a" srcset="x.png 2x"></div>', 'srcset'],
    ['an unquoted remote src', '<div><img alt="" SRC=https://evil.example/x.png></div>', 'src'],
  ];
  for (const [label, markup, attribute] of urls) {
    it(`refuses ${label}`, () => {
      expect(reasonFor(markup), label).toBe(
        `${attribute} attribute that is not a same-document #fragment`,
      );
    });
  }

  it('falls back with a warning naming a URL attribute', () => {
    const result = compile(SPEC, {
      diagramAdapter: {
        name: 'remote',
        version: '1',
        render: () => '<svg><image href="https://evil.example/x.png" /></svg>',
      },
    });
    expect(result.html).not.toContain('data-ak-diagram-adapter');
    expect(result.html).not.toContain('evil.example');
    expect(result.warnings[0]?.message).toContain(
      'href attribute that is not a same-document #fragment',
    );
  });

  it('falls back with a warning instead of embedding a stray end tag', () => {
    const result = compile(SPEC, {
      diagramAdapter: { name: 'bad', version: '1', render: () => '<svg></svg></main>' },
    });
    expect(result.html).not.toContain('data-ak-diagram-adapter');
    expect(result.html).not.toContain('<svg></svg></main>');
    expect(result.warnings[0]?.message).toContain('without a matching element');
  });

  it('walks deeply nested markup at the size bound quickly', () => {
    const depth = Math.floor((MAX_DIAGRAM_MARKUP_BYTES - 16) / 7);
    const markup = `${'<g>'.repeat(depth)}${'</g>'.repeat(depth)}`.slice(
      0,
      MAX_DIAGRAM_MARKUP_BYTES,
    );
    let fastest = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = performance.now();
      checkAdapterMarkup(markup);
      fastest = Math.min(fastest, performance.now() - started);
    }
    expect(fastest).toBeLessThan(200);
  });
});
