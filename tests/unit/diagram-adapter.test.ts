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
