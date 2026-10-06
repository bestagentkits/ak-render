import { describe, expect, it } from 'vitest';
import {
  checkAdapterMarkup,
  compile,
  type DiagramAdapter,
  type DiagramRenderRequest,
  MAX_DIAGRAM_MARKUP_BYTES,
  runDiagramAdapter,
} from '../../src/index.js';

const SPEC = `version: 1
meta:
  title: Architecture
blocks:
  - type: diagram-panel
    id: arch
    title: Architecture
    spec:
      meta:
        title: Compiler pipeline
      components:
        - id: compiler
          label: Compiler
        - id: runtime
          label: Runtime
      connections:
        - from: compiler
          to: runtime
          label: emits
`;

function adapter(render: (request: DiagramRenderRequest) => string | undefined): DiagramAdapter {
  return { name: 'test-adapter', version: '1.0.0', render };
}

const VALID_SVG =
  '<svg viewBox="0 0 10 10" role="img" aria-label="Pipeline"><rect x="1" y="1" width="8" height="8" /></svg>';

describe('diagram adapter: public contract', () => {
  it('embeds accepted adapter output and keeps the accessible fallback', () => {
    const result = compile(SPEC, { diagramAdapter: adapter(() => VALID_SVG) });
    expect(result.html).toContain('data-ak-diagram-adapter="test-adapter"');
    expect(result.html).toContain('<svg viewBox="0 0 10 10"');
    // The semantic description stays in the document as the text equivalent.
    expect(result.html).toContain('data-ak-diagram-fallback');
    expect(result.html).toContain('compiler');
    expect(result.warnings).toEqual([]);
  });

  it('receives the bounded spec, the title, the node id, and the contract version', () => {
    let seen: DiagramRenderRequest | undefined;
    compile(SPEC, {
      diagramAdapter: adapter((request) => {
        seen = request;
        return VALID_SVG;
      }),
    });
    expect(seen?.contractVersion).toBe(1);
    expect(seen?.nodeId).toBe('arch');
    expect(seen?.title).toBe('Compiler pipeline');
    expect(seen?.spec).toMatchObject({ meta: { title: 'Compiler pipeline' } });
  });

  it('puts adapter output in a named, keyboard-scrollable region', () => {
    const result = compile(SPEC, { diagramAdapter: adapter(() => VALID_SVG) });
    expect(result.html).toContain(
      '<div class="ak-diagram-rendered" data-ak-diagram-adapter="test-adapter" role="region" aria-label="Compiler pipeline" tabindex="0"><div class="ak-diagram-canvas" data-ak-diagram-scope="arch"><svg',
    );
  });

  it('folds the text description behind a closed disclosure when the adapter rendered', () => {
    const result = compile(SPEC, { diagramAdapter: adapter(() => VALID_SVG) });
    expect(result.html).toMatch(
      /<details class="ak-diagram-details" data-ak-diagram-fallback><summary>Text description<\/summary><div class="ak-diagram-fallback">/u,
    );
    expect(result.html).not.toMatch(/<details class="ak-diagram-details"[^>]*\sopen/u);
    expect(result.html).not.toContain('no diagram adapter is configured');
  });

  it('shows the description openly when there is no drawing', () => {
    const result = compile(SPEC);
    expect(result.html).not.toContain('<details class="ak-diagram-details"');
    expect(result.html).not.toContain('role="region"');
    expect(result.html).toContain('<div class="ak-diagram-fallback" data-ak-diagram-fallback>');
  });

  it('uses the structured fallback when no adapter is configured', () => {
    const result = compile(SPEC);
    expect(result.html).not.toContain('data-ak-diagram-adapter');
    expect(result.html).toContain('data-ak-diagram-fallback');
    expect(result.html).toContain('no diagram adapter is configured');
  });

  it('falls back when the adapter declines to render', () => {
    const result = compile(SPEC, { diagramAdapter: adapter(() => undefined) });
    expect(result.html).not.toContain('data-ak-diagram-adapter');
    expect(result.html).toContain('data-ak-diagram-fallback');
    expect(result.warnings).toEqual([]);
  });

  it('falls back with a warning when the adapter throws', () => {
    const result = compile(SPEC, {
      diagramAdapter: adapter(() => {
        throw new Error('adapter exploded');
      }),
    });
    expect(result.html).not.toContain('data-ak-diagram-adapter');
    expect(result.html).toContain('data-ak-diagram-fallback');
    expect(result.warnings.map((warning) => warning.message).join(' ')).toMatch(
      /adapter threw|rejected/u,
    );
  });

  it('is deterministic for the same spec and adapter', () => {
    const first = compile(SPEC, { diagramAdapter: adapter(() => VALID_SVG) });
    const second = compile(SPEC, { diagramAdapter: adapter(() => VALID_SVG) });
    expect(second.hash).toBe(first.hash);
    expect(second.html).toBe(first.html);
  });
});

describe('diagram adapter: trust boundary', () => {
  const hostile: readonly [string, string][] = [
    ['a script element', '<svg><script>alert(1)</script></svg>'],
    ['an iframe', '<iframe src="https://evil.example"></iframe>'],
    ['an object element', '<object data="x"></object>'],
    ['an embed element', '<embed src="x" />'],
    ['an SVG foreignObject', '<svg><foreignObject><b>x</b></foreignObject></svg>'],
    ['an inline handler', '<svg onload="alert(1)"></svg>'],
    ['a javascript URL', '<a href="javascript:alert(1)">x</a>'],
    ['a srcdoc attribute', '<div srcdoc="<b>x</b>"></div>'],
    ['a data: html URL', '<a href="data:text/html,<b>x</b>">x</a>'],
    ['a base element', '<base href="https://evil.example/">'],
    ['a form element', '<form action="https://evil.example"><input /></form>'],
  ];

  for (const [label, markup] of hostile) {
    it(`rejects ${label}`, () => {
      const result = compile(SPEC, { diagramAdapter: adapter(() => markup) });
      expect(result.html, label).not.toContain('data-ak-diagram-adapter');
      expect(result.html, label).toContain('data-ak-diagram-fallback');
      // The refused markup must not reach the artifact at all.
      expect(result.html, label).not.toContain('evil.example');
      expect(result.warnings.length, label).toBe(1);
      expect(result.warnings[0]?.severity, label).toBe('warning');
    });
  }

  it('rejects empty output', () => {
    const result = compile(SPEC, { diagramAdapter: adapter(() => '   ') });
    expect(result.warnings[0]?.message).toMatch(/empty output/u);
  });

  it('rejects output beyond the size bound', () => {
    const huge = `<svg>${'x'.repeat(MAX_DIAGRAM_MARKUP_BYTES + 1)}</svg>`;
    const result = compile(SPEC, { diagramAdapter: adapter(() => huge) });
    expect(result.warnings[0]?.message).toMatch(/exceeds/u);
  });

  it('names the adapter and the reason in the diagnostic', () => {
    const result = compile(SPEC, {
      diagramAdapter: { name: 'ak-diagram', version: '1.0.0', render: () => '<script></script>' },
    });
    expect(result.warnings[0]?.message).toContain('ak-diagram');
    expect(result.warnings[0]?.message).toContain('script element');
  });

  it('exposes the same check to adapter authors', () => {
    expect(checkAdapterMarkup(VALID_SVG)).toEqual({ ok: true });
    expect(checkAdapterMarkup('')).toMatchObject({ ok: false, reason: 'empty output' });
    expect(checkAdapterMarkup('<script></script>')).toMatchObject({
      ok: false,
      reason: 'script element',
    });
  });

  it('treats a non-string return as a decline rather than embedding it', () => {
    const result = runDiagramAdapter(
      { name: 'bad', version: '1', render: () => undefined },
      { spec: null, title: 'T', nodeId: 'n' },
    );
    expect(result).toBeUndefined();
  });

  it('refuses a markup value that is not a string', () => {
    const result = runDiagramAdapter(
      // A misbehaving adapter that returns a non-string at runtime.
      { name: 'bad', version: '1', render: () => 42 as unknown as string },
      { spec: null, title: 'T', nodeId: 'n' },
    );
    expect(result?.rejected).toBe('empty output');
  });
});

describe('diagram adapter: page style policy', () => {
  const STYLED_SVG =
    '<svg viewBox="0 0 10 10" role="img" aria-label="Styled"><style>.n{fill:#fff}</style><rect class="n" x="1" y="1" width="8" height="8" /></svg>';

  // The policy sits in a meta attribute, so its quotes are entity-escaped.
  function policy(html: string): string {
    const content = /http-equiv="Content-Security-Policy" content="([^"]+)"/u.exec(html)?.[1];
    return (content ?? '').replaceAll('&#39;', "'");
  }

  function styleNonce(html: string): string {
    const match = /style-src 'nonce-([^']+)'/u.exec(policy(html));
    if (match?.[1] === undefined) throw new Error('page has no style nonce');
    return match[1];
  }

  it('gives adapter style elements the page style nonce', () => {
    const result = compile(SPEC, { diagramAdapter: adapter(() => STYLED_SVG) });
    const nonce = styleNonce(result.html);
    expect(result.html).toContain(
      `<style nonce="${nonce}" data-ak-adapter-style>@scope (.ak-diagram-canvas[data-ak-diagram-scope="arch"]){.n{fill:#fff}}</style>`,
    );
    // Every style element on the page carries the one page nonce.
    const styleTags = result.html.match(/<style\b[^>]*>/gu) ?? [];
    expect(styleTags.length).toBe(2);
    for (const tag of styleTags) expect(tag).toContain(`nonce="${nonce}"`);
    expect(result.warnings).toEqual([]);
  });

  it('keeps the policy nonce-only', () => {
    const result = compile(SPEC, { diagramAdapter: adapter(() => STYLED_SVG) });
    expect(policy(result.html)).not.toMatch(/unsafe-inline/u);
    expect(policy(result.html)).toMatch(/style-src 'nonce-[^']+';/u);
  });

  it('normalises the style tag and keeps its other attributes', () => {
    const result = compile(SPEC, {
      diagramAdapter: adapter(() => STYLED_SVG.replace('<style>', '<STYLE media="all">')),
    });
    const nonce = styleNonce(result.html);
    expect(result.html).toContain(`<style nonce="${nonce}" data-ak-adapter-style media="all">`);
  });

  it('rejects markup that writes its own nonce', () => {
    const result = compile(SPEC, {
      diagramAdapter: adapter(() => STYLED_SVG.replace('<style>', '<style nonce="guessed">')),
    });
    expect(result.html).not.toContain('guessed');
    expect(result.html).not.toContain('data-ak-diagram-adapter');
    expect(result.warnings[0]?.message).toContain('nonce attribute');
  });

  it('cannot be tricked into writing the nonce inside an attribute value', () => {
    // The style marker inside a quoted value would otherwise receive the nonce,
    // and the quote the nonce brings would end the attribute early.
    const markup =
      '<svg viewBox="0 0 10 10"><g aria-label="<style data-ak-adapter-style">x</g></svg>';
    const result = compile(SPEC, { diagramAdapter: adapter(() => markup) });
    expect(result.html).not.toContain('aria-label="<style');
    expect(result.html).not.toContain('data-ak-diagram-adapter');
    expect(result.warnings[0]?.message).toContain('reserved page attribute');
    const styleTags = result.html.match(/<style\b[^>]*>/gu) ?? [];
    expect(styleTags).toHaveLength(1);
  });

  it('rejects markup that claims the canvas scope attribute', () => {
    expect(
      checkAdapterMarkup('<svg><g data-ak-diagram-scope="other"><rect /></g></svg>'),
    ).toMatchObject({ ok: false, reason: 'reserved page attribute' });
  });

  it('scopes each panel to its own canvas', () => {
    const twoPanels = `${SPEC}  - type: diagram-panel
    id: second
    title: Second
    spec:
      components:
        - id: x
          label: X
`;
    const result = compile(twoPanels, { diagramAdapter: adapter(() => STYLED_SVG) });
    expect(result.html).toContain('@scope (.ak-diagram-canvas[data-ak-diagram-scope="arch"])');
    expect(result.html).toContain('@scope (.ak-diagram-canvas[data-ak-diagram-scope="second"])');
    expect(result.html).toContain('<div class="ak-diagram-canvas" data-ak-diagram-scope="second">');
  });

  it('removes inline style attributes and says so', () => {
    const markup =
      '<svg viewBox="0 0 10 10"><rect class="n" style="--step:1" x="1" /><rect style=\'fill:red\' y="2"/></svg>';
    const result = compile(SPEC, { diagramAdapter: adapter(() => markup) });
    expect(result.html).toContain('<rect class="n" x="1" />');
    expect(result.html).toContain('<rect y="2" />');
    expect(result.html).not.toContain('--step:1');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toMatch(/2 inline style attribute\(s\)/u);
    expect(result.warnings[0]?.message).toContain('test-adapter');
  });

  it('leaves text that merely mentions a style attribute alone', () => {
    const markup = '<svg viewBox="0 0 10 10"><text x="1">use style="x" sparingly</text></svg>';
    const result = compile(SPEC, { diagramAdapter: adapter(() => markup) });
    expect(result.html).toContain('<text x="1">use style="x" sparingly</text>');
    expect(result.warnings).toEqual([]);
  });

  it('rejects adapter CSS that would load another stylesheet or a remote resource', () => {
    expect(checkAdapterMarkup('<svg><style>@import "x.css";</style></svg>')).toMatchObject({
      ok: false,
      reason: 'CSS @import',
    });
    expect(
      checkAdapterMarkup('<svg><style>.n{fill:url(https://evil.example/x)}</style></svg>'),
    ).toMatchObject({ ok: false, reason: 'remote CSS url()' });
    expect(checkAdapterMarkup('<svg><rect fill="url(#grad)" /></svg>')).toEqual({ ok: true });
  });

  it('is deterministic with styled output', () => {
    const first = compile(SPEC, { diagramAdapter: adapter(() => STYLED_SVG) });
    const second = compile(SPEC, { diagramAdapter: adapter(() => STYLED_SVG) });
    expect(second.html).toBe(first.html);
  });
});
