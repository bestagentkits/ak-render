import { describe, expect, it } from 'vitest';
import {
  checkAdapterMarkup,
  MAX_DIAGRAM_MARKUP_BYTES,
  runDiagramAdapter,
} from '../../src/index.js';

/** Adapter markup carrying one stylesheet. */
function styled(css: string): string {
  return `<svg viewBox="0 0 10 10"><style>${css}</style><rect class="n" /></svg>`;
}

function reason(css: string): string | undefined {
  return checkAdapterMarkup(styled(css)).reason;
}

describe('diagram adapter stylesheets: accepted CSS', () => {
  const accepted: readonly [string, string][] = [
    ['plain rules', '.n{fill:#fff;stroke:#333}'],
    ['a fragment url()', '.n{fill:url(#grad)}.m{filter:url("#soft")}'],
    ['a media query', '@media (prefers-color-scheme:dark){.n{fill:#000}}'],
    ['a supports query', '@supports (fill:color-mix(in srgb,red,blue)){.n{fill:red}}'],
    [
      'keyframes and an animation',
      '@keyframes flow{from{stroke-dashoffset:10}to{stroke-dashoffset:0}}.e{animation:flow 1s linear infinite}',
    ],
    ['nesting', '.g{& .n{fill:red}&:hover{opacity:.5}}'],
    ['strings', '.t{font-family:"Inter",sans-serif}.u::after{content:"}"}'],
    ['page-wide selectors, which the scope neutralises', ':root{color:red}html,body{margin:0}'],
  ];
  for (const [label, css] of accepted) {
    it(`accepts ${label}`, () => {
      expect(checkAdapterMarkup(styled(css)), label).toEqual({ ok: true });
    });
  }

  it('scopes the stylesheet to the panel canvas', () => {
    const result = runDiagramAdapter(
      { name: 'a', version: '1', render: () => styled('.n{fill:#fff}') },
      { spec: null, title: 'T', nodeId: 'panel-1' },
    );
    expect(result?.scope).toBe('panel-1');
    expect(result?.markup).toContain(
      '<style data-ak-adapter-style>@scope (.ak-diagram-canvas[data-ak-diagram-scope="panel-1"]){.n{fill:#fff}}</style>',
    );
  });

  it('hashes a node id that is not a safe token', () => {
    const result = runDiagramAdapter(
      { name: 'a', version: '1', render: () => styled('.n{fill:#fff}') },
      { spec: null, title: 'T', nodeId: '"]){} *{color:red' },
    );
    expect(result?.scope).toMatch(/^s[a-z0-9]+$/u);
    expect(result?.markup).not.toContain('color:red');
  });
});

describe('diagram adapter stylesheets: refused CSS', () => {
  const refused: readonly [string, string, string | RegExp][] = [
    ['a hex escape hiding @import', '@\\69mport "x.css";', 'CSS escape'],
    ['an escaped remote url()', '.n{fill:url(https:\\2f\\2f evil.example/x)}', 'CSS escape'],
    ['an escaped scheme-relative url()', '.n{fill:url(\\2f\\2f evil.example)}', 'CSS escape'],
    ['image-set()', '.n{fill:image-set("https://evil.example/x.png" 1x)}', 'CSS image-set()'],
    ['-webkit-image-set()', '.n{fill:-webkit-image-set("x.png" 1x)}', 'CSS -webkit-image-set()'],
    ['a relative url()', '.n{fill:url(x.svg#a)}', /url\(\) other than a fragment/u],
    ['a same-origin url()', '.n{background:url(/x.png)}', /url\(\) other than a fragment/u],
    ['a data url()', '.n{fill:url(data:image/svg+xml,x)}', /url\(\) other than a fragment/u],
    ['an uppercase URL()', '.n{fill:URL("x.png")}', /url\(\) other than a fragment/u],
    ['@import', '@import "x.css";', 'CSS @import'],
    ['@font-face', '@font-face{font-family:x;src:local(x)}', 'CSS @font-face'],
    ['@namespace', '@namespace svg "http://www.w3.org/2000/svg";', 'CSS @namespace'],
    ['@property', '@property --x{syntax:"*";inherits:true}', 'CSS @property'],
    ['@layer', '@layer x{.n{fill:red}}', 'CSS @layer'],
    ['a nested @scope', '@scope (body){.n{fill:red}}', 'CSS @scope'],
    ['a bare at sign', '@ {}', 'CSS at-rule'],
    ['expression()', '.n{width:expression(alert(1))}', 'CSS expression()'],
    ['a comment', '.n{fill:red}/* x */', 'CSS comment'],
    ['a comment splitting a token', '@im/**/port "x.css";', /CSS (comment|@im)/u],
    ['!important', '.n{fill:red!important}', 'CSS !important'],
    ['a spaced ! important', '.n{animation:x 1s ! important}', 'CSS !important'],
    ['an extra closing brace', '.n{fill:red}} .ak-shell{display:none}', 'unbalanced CSS brackets'],
    ['an unclosed block', '.n{fill:red', 'unbalanced CSS brackets'],
    ['mismatched brackets', '.n{fill:red)', 'unbalanced CSS brackets'],
    ['an unterminated string', '.n::after{content:"x}', 'unterminated CSS string'],
    ['an escape inside a string', '.n::after{content:"\\7d"}', 'CSS escape'],
    ['a decimal character reference', '&#64;import "x.css";', /character reference/u],
    ['a named character reference', '.n{fill:red}&commat;import "x.css";', /character reference/u],
    ['a page keyframes name', '@keyframes ak-rise{to{opacity:0}}', /reserved by the page/u],
    [
      'a quoted page keyframes name',
      '@keyframes "AK-fade"{to{opacity:0}}',
      /reserved by the page/u,
    ],
  ];
  for (const [label, css, expected] of refused) {
    it(`refuses ${label}`, () => {
      const why = reason(css);
      if (typeof expected === 'string') expect(why, label).toBe(expected);
      else expect(why, label).toMatch(expected);
    });
  }

  it('refuses markup inside a style element', () => {
    expect(
      checkAdapterMarkup('<svg><style>.n{fill:red}<![CDATA[@import "x";]]></style></svg>'),
    ).toMatchObject({ ok: false, reason: /containing markup/u });
    expect(checkAdapterMarkup('<svg><style>.n{fill:red}<!-- --></style></svg>')).toMatchObject({
      ok: false,
    });
  });

  it('refuses a style element that never ends', () => {
    expect(checkAdapterMarkup('<svg><style>.n{fill:red}')).toMatchObject({ ok: false });
    expect(checkAdapterMarkup('<svg><style>.n{fill:red}</styles></svg>')).toMatchObject({
      ok: false,
    });
  });

  it('refuses a self-closing style element', () => {
    expect(checkAdapterMarkup('<svg><style/><rect /></svg>')).toMatchObject({
      ok: false,
      reason: 'self-closing style element',
    });
  });

  it('checks every style element, not only the first', () => {
    expect(
      checkAdapterMarkup(
        '<svg><style>.n{fill:red}</style><g><style>@import "x";</style></g></svg>',
      ),
    ).toMatchObject({ ok: false, reason: 'CSS @import' });
  });
});

/**
 * Fastest of a few runs, in milliseconds. The fastest run measures the work
 * itself rather than whatever else the machine is doing at that moment.
 */
function fastestRun(work: () => unknown): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = performance.now();
    work();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

describe('diagram adapter: matching stays linear', () => {
  // Each shape is padded to just under the size bound. A backtracking matcher
  // takes minutes on the first one; a linear one takes milliseconds.
  const shapes: readonly [string, string][] = [
    ['unterminated tags', '<a '],
    ['unterminated attributes', '<a b '],
    ['open quoted values', '<a b="'],
    ['open single-quoted values', "<a b='x"],
    ['unquoted values', '<a b=c '],
    ['slashes', '<a / '],
  ];
  for (const [label, unit] of shapes) {
    it(`checks ${label} at the size bound in well under 200 ms`, () => {
      const markup = `<svg>${unit.repeat(Math.floor((MAX_DIAGRAM_MARKUP_BYTES - 16) / unit.length))}`;
      expect(markup.length).toBeLessThanOrEqual(MAX_DIAGRAM_MARKUP_BYTES);
      const run = () =>
        runDiagramAdapter(
          { name: 'a', version: '1', render: () => markup },
          { spec: null, title: 'T', nodeId: 'n' },
        );
      expect(fastestRun(run), label).toBeLessThan(200);
    });
  }

  it('filters a stylesheet at the size bound in well under 200 ms', () => {
    const css = '.n{fill:url(#a)}'.repeat(Math.floor((MAX_DIAGRAM_MARKUP_BYTES - 64) / 16));
    const markup = styled(css);
    expect(checkAdapterMarkup(markup)).toEqual({ ok: true });
    expect(fastestRun(() => checkAdapterMarkup(markup))).toBeLessThan(200);
  });
});
