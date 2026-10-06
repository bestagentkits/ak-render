import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

function page(blocks: unknown[]) {
  return { version: 1, meta: { title: 'Layouts' }, blocks };
}

const card = (title: string) => ({ type: 'card', title, text: `${title} text.` });

function diagnostics(blocks: unknown[]) {
  return normalizeSpec(page(blocks)).diagnostics;
}

const errorPaths = (blocks: unknown[]) =>
  diagnostics(blocks)
    .filter((d) => d.severity === 'error')
    .map((d) => d.path);

/** The opening tag of the first element whose class list contains `className`. */
function openingTag(html: string, className: string): string {
  const match = new RegExp(`<[a-z]+[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'u').exec(
    html,
  );
  return match?.[0] ?? '';
}

describe('grid options', () => {
  it('keeps an existing grid byte-identical and ships no layout feature', () => {
    const result = compile(page([{ type: 'grid', columns: 4, blocks: [card('A'), card('B')] }]));
    expect(openingTag(result.html, 'ak-grid')).toMatch(
      /^<div class="ak-block ak-grid" data-ak-columns="4" data-ak-id="[^"]+">$/u,
    );
    expect(result.features.filter((feature) => feature.startsWith('layout'))).toEqual([]);
    expect(result.html).not.toContain('data-ak-tracks');
    expect(result.html).not.toContain('.ak-grid[data-gap="tight"]');
  });

  it('accepts 12 columns, auto with a minimum width, gap and align', () => {
    const wide = compile(
      page([{ type: 'grid', columns: 12, gap: 'loose', align: 'start', blocks: [card('A')] }]),
    );
    expect(openingTag(wide.html, 'ak-grid')).toContain('data-ak-columns="12"');
    expect(openingTag(wide.html, 'ak-grid')).toContain('data-gap="loose"');
    expect(openingTag(wide.html, 'ak-grid')).toContain('data-align="start"');
    expect(wide.features).toContain('layout-options');
    expect(wide.html).toContain('.ak-grid[data-ak-columns="12"]{');

    const auto = compile(page([{ type: 'grid', columns: 'auto', blocks: [card('A')] }]));
    expect(openingTag(auto.html, 'ak-grid')).toContain('data-ak-columns="auto"');
    expect(openingTag(auto.html, 'ak-grid')).toContain('data-ak-min="medium"');
    expect(auto.html).toContain('minmax(min(100%,16rem),1fr)');
  });

  it('rejects out-of-range columns and warns on a stray minItemWidth', () => {
    expect(errorPaths([{ type: 'grid', columns: 13, blocks: [card('A')] }])).toEqual([
      '$.blocks[0].columns',
    ]);
    expect(errorPaths([{ type: 'grid', columns: 'fit', blocks: [card('A')] }])).toEqual([
      '$.blocks[0].columns',
    ]);
    const warnings = diagnostics([
      { type: 'grid', columns: 3, minItemWidth: 'wide', blocks: [card('A')] },
    ]).filter((d) => d.severity === 'warning');
    expect(warnings.map((d) => d.path)).toEqual(['$.blocks[0].minItemWidth']);
  });

  it('aligns stack children only when asked', () => {
    const plain = compile(page([{ type: 'stack', blocks: [card('A')] }]));
    expect(openingTag(plain.html, 'ak-stack')).not.toContain('data-align');
    expect(plain.features).not.toContain('layout-options');
    const centered = compile(page([{ type: 'stack', align: 'center', blocks: [card('A')] }]));
    expect(openingTag(centered.html, 'ak-stack')).toContain('data-align="center"');
    expect(centered.html).toContain('.ak-stack[data-align="center"] > *{align-self:center}');
  });
});

describe('grid-item', () => {
  const dashboard = page([
    {
      type: 'grid',
      columns: 3,
      blocks: [
        {
          type: 'grid-item',
          span: 8,
          tabletSpan: 12,
          mobileSpan: 6,
          rowSpan: 2,
          start: 1,
          align: 'start',
          blocks: [card('Wide')],
        },
        { type: 'grid-item', blocks: [card('Default')] },
        card('Plain'),
      ],
    },
  ]);

  it('turns its grid into 12 tracks and renders every placement attribute', () => {
    const result = compile(dashboard);
    expect(normalizeSpec(dashboard).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(openingTag(result.html, 'ak-grid')).toContain('data-ak-tracks="12"');
    const [wide, fallback] = result.html.match(/<div class="ak-block ak-grid-item"[^>]*>/gu) ?? [];
    for (const attribute of [
      'data-ak-span="8"',
      'data-ak-tablet-span="12"',
      'data-ak-mobile-span="6"',
      'data-ak-row-span="2"',
      'data-ak-start="1"',
      'data-align="start"',
    ]) {
      expect(wide).toContain(attribute);
    }
    // Without a span an item takes 12 / columns tracks.
    expect(fallback).toContain('data-ak-span="4"');
    expect(result.features).toContain('layout-tracks');
    expect(result.html).toContain('.ak-grid[data-ak-tracks]{grid-template-columns:repeat(12');
  });

  it('never uses inline styles', () => {
    expect(compile(dashboard).html).not.toMatch(/\sstyle=/u);
  });

  it('is rejected outside a grid, at its path', () => {
    const outside = { type: 'grid-item', blocks: [card('A')] };
    expect(errorPaths([outside])).toEqual(['$.blocks[0].type']);
    expect(errorPaths([{ type: 'stack', blocks: [outside] }])).toEqual([
      '$.blocks[0].blocks[0].type',
    ]);
  });

  it('rejects a span or start beyond the 12 tracks', () => {
    const inGrid = (item: Record<string, unknown>) => [
      { type: 'grid', blocks: [{ type: 'grid-item', blocks: [card('A')], ...item }] },
    ];
    expect(errorPaths(inGrid({ span: 13 }))).toEqual(['$.blocks[0].blocks[0].span']);
    expect(errorPaths(inGrid({ rowSpan: 5 }))).toEqual(['$.blocks[0].blocks[0].rowSpan']);
    expect(errorPaths(inGrid({ span: 8, start: 6 }))).toEqual(['$.blocks[0].blocks[0].start']);
    expect(errorPaths(inGrid({ span: 8, start: 5 }))).toEqual([]);
  });
});

describe('semantic layouts', () => {
  it('renders a sidebar layout in visual order for each side', () => {
    const start = compile(
      page([{ type: 'sidebar-layout', sidebar: [card('Side')], blocks: [card('Main')] }]),
    ).html;
    expect(start.indexOf('<aside class="ak-layout-side">')).toBeLessThan(
      start.indexOf('<div class="ak-layout-main">'),
    );
    const end = compile(
      page([
        { type: 'sidebar-layout', side: 'end', sidebar: [card('Side')], blocks: [card('Main')] },
      ]),
    ).html;
    expect(openingTag(end, 'ak-sidebar-layout')).toContain('data-side="end"');
    expect(end.indexOf('<div class="ak-layout-main">')).toBeLessThan(
      end.indexOf('<aside class="ak-layout-side">'),
    );
  });

  it('renders main-aside main first, with a sticky aside on screens only', () => {
    const result = compile(
      page([{ type: 'main-aside', aside: [card('Facts')], blocks: [card('Report')] }]),
    );
    expect(result.html).toMatch(
      /<div class="ak-layout-main">.*Report.*<\/div><aside class="ak-layout-side">.*Facts/su,
    );
    expect(result.features).toContain('semantic-layout');
    expect(result.html).toContain('@media screen and (min-width:1024px)');
  });

  it('renders a rail of links as navigation and any other rail as a region', () => {
    const links = compile(
      page([
        {
          type: 'rail-layout',
          label: 'Sections',
          rail: [{ type: 'link', label: 'Top', href: '#top' }],
          blocks: [card('Main')],
        },
      ]),
    ).html;
    expect(links).toContain('<nav aria-label="Sections" class="ak-rail">');
    const mixed = compile(
      page([{ type: 'rail-layout', rail: [card('Note')], blocks: [card('Main')] }]),
    ).html;
    expect(mixed).toContain('<div aria-label="Side rail" class="ak-rail" role="region">');
  });

  it('requires its side slot and bounds it', () => {
    expect(errorPaths([{ type: 'main-aside', blocks: [card('Main')] }])).toEqual([
      '$.blocks[0].aside',
    ]);
    const many = Array.from({ length: 7 }, (_, index) => card(`Aside ${index}`));
    expect(errorPaths([{ type: 'main-aside', aside: many, blocks: [card('Main')] }])).toEqual([
      '$.blocks[0].aside',
    ]);
  });

  it('ships no layout CSS on a page without these blocks', () => {
    const result = compile(page([card('Only')]));
    expect(result.html).not.toContain('.ak-sidebar-layout');
    expect(result.html).not.toContain('.ak-grid[data-ak-tracks]');
  });
});
