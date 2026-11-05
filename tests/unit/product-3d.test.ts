import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const FIXTURE = readFileSync(
  new URL('../../fixtures/3d/product-3d-speaker.yaml', import.meta.url),
  'utf8',
);

interface Hotspot {
  id: string;
  at: number[];
  shift: number[];
  dir: number[];
}
interface Product {
  variant: string;
  exploded: boolean;
  spread: number;
  closeUp: number;
  hotspots: Hotspot[];
  variants: { id: string }[];
  explode: Record<string, number[]>;
  bind?: string;
  variantBind?: string;
  explodeBind?: string;
}

function spec(block: Record<string, unknown>, state: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Product' },
    state,
    blocks: [{ type: 'product-3d', id: 'p', summary: 'A product.', ...block }],
  };
}

const parts = [
  { id: 'body', shape: 'rounded-box', scale: [1, 2, 1], position: [0, 1, 0], explode: [0, 0, -1] },
  {
    id: 'cap',
    shape: 'cylinder',
    position: [0, 2.1, 0],
    scale: [0.6, 0.2, 0.6],
    explode: [0, 1, 0],
  },
];

function errors(input: unknown) {
  return normalizeSpec(input)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.path}: ${d.message}`);
}

function sceneOf(html: string): { objects: Record<string, unknown>[]; product: Product } {
  const match = /data-ak-scene="([^"]*)"/u.exec(html);
  const raw = (match?.[1] ?? '{}')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  return JSON.parse(raw);
}

describe('product-3d contract', () => {
  it('compiles the fixture byte-identically three times with the 3D runtime', () => {
    const runs = [0, 1, 2].map(() => compile(FIXTURE, { source: 'product' }).html);
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
    expect(runs[0]).toContain('data-ak-3d="product"');
    expect(runs[0]).toContain('__akThree');
  });

  it('renders at least three finishes and five hotspots readable without JS', () => {
    const html = compile(FIXTURE, { source: 'product' }).html;
    const dropdown =
      /<select disabled data-ak-product-variant>(.*?)<\/select>/u.exec(html)?.[1] ?? '';
    expect(dropdown.match(/<option /gu)?.length).toBe(4);
    expect(html.match(/data-ak-product-hotspot="/gu)?.length).toBe(6);
    expect(html.match(/class="ak-product-pin"/gu)?.length).toBe(6);
    expect(html).toContain('class="ak-product-finishes"');
    expect(html).toContain('<li aria-current="true">Graphite</li>');
    expect(html).toContain('Long-throw aluminium cone');
    expect(html).toContain(
      'aria-pressed="true"><span class="ak-3d-name"><span class="ak-3d-num" aria-hidden="true">1</span>5-inch woofer',
    );
  });

  it('applies the bound variant to the parts the first frame and the plan show', () => {
    const doc = parse(FIXTURE) as { state: Record<string, unknown> };
    const silver = compile({ ...doc, state: { ...doc.state, finish: 'silver' } } as never).html;
    const { objects, product } = sceneOf(silver);
    const body = objects.find((o) => o.id === 'body');
    expect(body?.tone).toBe('light');
    expect(body?.material).toBe('metal');
    expect(product.variant).toBe('silver');
    expect(silver).toContain('<option value="silver" selected>');
    // An unknown bound value falls back to the first variant.
    const fallback = sceneOf(
      compile({ ...doc, state: { ...doc.state, finish: 'nope' } } as never).html,
    );
    expect(fallback.product.variant).toBe('graphite');
  });

  it('resolves hotspot points, exploded shifts and close-up bearings at compile time', () => {
    const html = compile(
      spec(
        {
          parts,
          hotspots: [
            { id: 'top', label: 'Top', part: 'cap', offset: [0, 0.1, 0] },
            { id: 'side', label: 'Side', part: 'body', offset: [0.5, 0, 0] },
          ],
          explodeBind: 'state.view',
        },
        { view: 'exploded' },
      ),
    ).html;
    const { objects, product } = sceneOf(html);
    expect(objects.every((o) => !('explode' in o))).toBe(true);
    expect(product.explode).toEqual({ body: [0, 0, -1], cap: [0, 1, 0] });
    expect(product.exploded).toBe(true);
    expect(product.spread).toBeGreaterThan(1);
    const [top, side] = product.hotspots;
    expect(top?.at).toEqual([0, 2.2, 0]);
    expect(top?.shift).toEqual([0, 1, 0]);
    expect(side?.shift).toEqual([0, 0, -1]);
    for (const hotspot of product.hotspots) {
      expect(Math.hypot(...hotspot.dir)).toBeCloseTo(1, 3);
      expect(hotspot.dir[1]).toBeGreaterThanOrEqual(0.12 / Math.hypot(1, 0.12) - 1e-3);
    }
    expect(html).toContain('data-ak-product-explode aria-pressed="true"');
  });

  it('reports duplicate ids and unknown part references at exact paths', () => {
    expect(
      errors(
        spec({
          parts: [...parts, { id: 'lid', parent: 'nope' }],
          variants: [
            { id: 'a', label: 'A', finishes: [{ part: 'ghost', tone: 'dark' }] },
            { id: 'a', label: 'A2' },
          ],
          hotspots: [
            { id: 'h', label: 'H', part: 'cap' },
            { id: 'h', label: 'H2', part: 'missing' },
          ],
        }),
      ),
    ).toEqual([
      '$.blocks[0].parts[2].parent: parent "nope" is not an object id in this scene',
      '$.blocks[0].variants[0].finishes[0].part: "ghost" is not a part id',
      '$.blocks[0].variants[1].id: id "a" is used twice',
      '$.blocks[0].hotspots[1].id: id "h" is used twice',
      '$.blocks[0].hotspots[1].part: "missing" is not a part id',
    ]);
  });

  it('keeps the vocabulary closed: unknown tones, materials and shader keys fail', () => {
    expect(errors(spec({ parts: [{ id: 'a', tone: 'chartreuse' }] })).length).toBe(1);
    expect(
      errors(
        spec({
          parts,
          variants: [{ id: 'v', label: 'V', finishes: [{ part: 'body', material: 'chrome' }] }],
        }),
      ).length,
    ).toBe(1);
    expect(errors(spec({ parts, fragmentShader: 'void main(){}' })).length).toBeGreaterThan(0);
  });

  it('draws only parts visible from outside in the plan', () => {
    const html = compile(
      spec({
        parts: [
          { id: 'shell', shape: 'box', scale: [2, 2, 2] },
          { id: 'core', shape: 'box', scale: [0.5, 0.5, 0.5] },
        ],
      }),
    ).html;
    expect(html.match(/class="ak-3d-mark ak-product-part"/gu)?.length).toBe(1);
  });
});
