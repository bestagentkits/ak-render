import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { builtinThemeCatalog } from '../../src/theme/theme-catalog.js';
import { GOLDEN_CASES, goldenPage } from './support/diagram-golden.js';
import { gridDiagramAdapter } from './support/grid-diagram-adapter.js';

const adapter = gridDiagramAdapter();
const render = (page: Record<string, unknown>) => compile(page, { diagramAdapter: adapter });

/** The drawn canvas, from its contract marker to the end of its SVG. */
function canvas(html: string): string {
  const start = html.indexOf('data-ak-diagram-contract="2"');
  expect(start).toBeGreaterThan(-1);
  // The style nonce hashes the whole page, so it is left out of the comparison.
  return html.slice(start, html.indexOf('</svg>', start) + 6).replace(/ nonce="[^"]*"/u, '');
}

const attrs = (markup: string, name: string) =>
  [...markup.matchAll(new RegExp(`${name}="([^"]*)"`, 'gu'))].map((match) => match[1] as string);

describe('diagram golden cases', () => {
  it('covers at least twenty shapes', () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(GOLDEN_CASES.map((golden) => golden.name)).size).toBe(GOLDEN_CASES.length);
  });

  for (const golden of GOLDEN_CASES) {
    describe(golden.name, () => {
      const result = render(goldenPage(golden));
      const drawn = canvas(result.html);

      it('compiles deterministically', () => {
        expect(render(goldenPage(golden)).html).toBe(result.html);
      });

      it('draws every declared node once and nothing else', () => {
        expect(attrs(drawn, 'data-ak-node').sort()).toEqual([...golden.nodes].sort());
      });

      it('draws exactly the declared relationships, in spec order', () => {
        const edges = attrs(drawn, 'data-ak-edge');
        expect(edges).toEqual(golden.edges.map((_, index) => String(index)));
        const from = attrs(drawn, 'data-ak-from');
        const to = attrs(drawn, 'data-ak-to');
        // Every drawn line belongs to a declared relationship: none is drawn bare.
        const lines = drawn.slice(drawn.indexOf('</defs>')).match(/<path /gu) ?? [];
        expect(lines).toHaveLength(golden.edges.length);
        expect(from.map((id, index) => [id, to[index]])).toEqual(
          golden.edges.map((edge) => [...edge]),
        );
      });

      it('keeps ids unique and markup inert', () => {
        const ids = attrs(result.html, ' id');
        expect(new Set(ids).size).toBe(ids.length);
        expect(drawn).not.toMatch(/<script|<img|\son[a-z]+=/iu);
      });

      it('names the drawing and every node for assistive technology', () => {
        expect(drawn).toMatch(/role="img"/u);
        const named = attrs(drawn, 'data-ak-node').length;
        expect(attrs(drawn, 'data-ak-label').length).toBeGreaterThanOrEqual(named);
        expect(drawn).toMatch(/aria-label="[^"]+"/u);
        expect(result.html).toContain('Text description');
      });

      it('matches its golden digest', () => {
        const digest = {
          nodes: golden.nodes.length,
          edges: golden.edges.length,
          groups: attrs(drawn, 'data-ak-group').length,
          canvas: createHash('sha256').update(drawn).digest('hex').slice(0, 16),
        };
        expect(digest).toMatchSnapshot();
      });
    });
  }

  it('renders under every built-in preset with the same drawing', () => {
    const golden = GOLDEN_CASES.find((item) => item.name === 'nested-boundaries');
    if (golden === undefined) throw new Error('missing case');
    const reference = canvas(render(goldenPage(golden)).html);
    for (const preset of Object.keys(builtinThemeCatalog().entries)) {
      expect(canvas(render(goldenPage(golden, { preset })).html), preset).toBe(reference);
    }
  });
});
