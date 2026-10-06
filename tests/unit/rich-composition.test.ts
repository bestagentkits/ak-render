import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';
import { validate } from '../../src/spec/validate.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');

/** The `<section>` element that opens with `marker`, including nested sections. */
function sectionFragment(html: string, marker: string): string {
  const start = html.lastIndexOf('<section', html.indexOf(marker));
  if (start < 0 || html.indexOf(marker) < 0) throw new Error(`no section for ${marker}`);
  const tag = /<section\b|<\/section>/gu;
  tag.lastIndex = start;
  let depth = 0;
  for (let match = tag.exec(html); match !== null; match = tag.exec(html)) {
    depth += match[0] === '</section>' ? -1 : 1;
    if (depth === 0) return html.slice(start, match.index + match[0].length);
  }
  throw new Error(`unbalanced section for ${marker}`);
}

function spec(blocks: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 1, meta: { title: 'Rich composition' }, blocks, ...extra };
}

function errors(input: unknown) {
  return normalizeSpec(input).diagnostics.filter((item) => item.severity === 'error');
}

const CHART = {
  type: 'chart',
  kind: 'line',
  title: 'Latency',
  labels: ['a', 'b', 'c'],
  series: [{ label: 'p50', values: [3, 2, 1] }],
};
const TABLE = { type: 'table', columns: ['Suite', 'Tests'], rows: [['Unit', '412']] };

describe('rich composition: text-only items render as before', () => {
  // The committed gallery pages were compiled before items could nest
  // blocks. A text-only item must keep exactly that markup.
  const cases: [fixture: string, gallery: string, marker: string][] = [
    ['interactive', 'interactive', 'data-ak-id="mode-tabs"'],
    ['interactive', 'interactive', 'data-ak-id="steps-carousel"'],
    ['interactive', 'interactive', 'data-ak-id="faq"'],
    ['showcase', 'showcase', 'class="ak-block ak-bento-block"'],
  ];
  for (const [fixture, gallery, marker] of cases) {
    it(`${fixture}: ${marker}`, () => {
      const source = read(`fixtures/pages/${fixture}.yaml`);
      const { html } = compile(source, { source: `${fixture}.yaml` });
      expect(sectionFragment(html, marker)).toBe(
        sectionFragment(read(`docs/gallery/${gallery}.html`), marker),
      );
    });
  }
});

describe('rich composition: nested blocks', () => {
  it('compiles the tabs example (a chart and a table in panels) with zero warnings', () => {
    const result = compile(
      spec([
        {
          type: 'tabs',
          items: [
            { id: 'overview', title: 'Overview', blocks: [CHART] },
            { id: 'details', title: 'Details', blocks: [TABLE] },
          ],
        },
      ]),
    );
    expect(result.warnings).toEqual([]);
    expect(result.features).toEqual(expect.arrayContaining(['tabs', 'chart']));
    const tabs = result.ir.nodes.find((node) => node.type === 'tabs');
    expect(Object.keys(tabs?.slots ?? {})).toEqual(['items[0].blocks', 'items[1].blocks']);
    expect(result.html).toMatch(
      /<div class="ak-nested">(?:<!--[^>]*-->)?<div class="ak-block"[^>]*><figure class="ak-chart"/u,
    );
    expect(result.html).toContain('ak-table');
  });

  it('keeps nested paths and ids stable across runs', () => {
    const input = spec([
      {
        type: 'tabs',
        id: 'tabs',
        items: [
          { title: 'A', text: 'Alpha.' },
          { title: 'B', blocks: [{ type: 'text', text: 'Nested.' }] },
        ],
      },
    ]);
    const runs = [1, 2, 3].map(() => normalizeSpec(input).ir.nodes);
    const nested = runs[0]?.find((node) => node.parentId === 'tabs');
    expect(nested?.path).toBe('$.blocks[0].items[1].blocks[0]');
    expect(runs[1]?.map((node) => node.id)).toEqual(runs[0]?.map((node) => node.id));
    expect(runs[2]?.map((node) => node.id)).toEqual(runs[0]?.map((node) => node.id));
    expect(compile(input).hash).toBe(compile(input).hash);
  });

  it('ships every panel visible, each with its title, and no static hidden', () => {
    const { html } = compile(
      spec([
        {
          type: 'tabs',
          id: 't',
          items: [
            { title: 'One', blocks: [{ type: 'text', text: 'First.' }] },
            { title: 'Two', text: 'Second.' },
          ],
        },
      ]),
    );
    const panels = html.match(/<div role="tabpanel"[^>]*>/gu) ?? [];
    expect(panels).toHaveLength(2);
    for (const panel of panels) expect(panel).not.toMatch(/\shidden/u);
    expect(html).toContain('<p class="ak-tab-panel-title">One</p><div class="ak-nested">');
    expect(html).toContain('<p class="ak-tab-panel-title">Two</p>Second.</div>');
  });

  it('adds a nested chart to the page features', () => {
    for (const block of [
      { type: 'accordion', items: [{ title: 'A', blocks: [CHART] }] },
      { type: 'carousel', ariaLabel: 'Slides', items: [{ title: 'A', blocks: [CHART] }] },
      { type: 'bento', items: [{ title: 'A', blocks: [CHART] }] },
    ]) {
      expect(compile(spec([block])).features, block.type).toContain('chart');
    }
  });

  it('gates a nested remote image under the default network policy', () => {
    const remote = 'https://images.example.com/shot.png';
    const input = spec([
      {
        type: 'accordion',
        items: [{ title: 'Shot', blocks: [{ type: 'image', src: remote, alt: 'Shot' }] }],
      },
    ]);
    const { html } = compile(input);
    expect(html).not.toContain(`<img src="${remote}"`);
    expect(html).toContain('Remote image not loaded: the page denies network access.');
    const allowed = compile({ ...input, policy: { network: { allow: ['images'] } } });
    expect(allowed.html).toContain(`<img src="${remote}"`);
  });

  it('renders item text before the nested blocks and keeps a text-only item bare', () => {
    const { html } = compile(
      spec([
        {
          type: 'accordion',
          items: [
            { title: 'Both', text: 'Lead.', blocks: [{ type: 'text', text: 'Body.' }] },
            { title: 'Blocks only', blocks: [{ type: 'text', text: 'Only.' }] },
            { title: 'Text only', text: 'Plain.' },
          ],
        },
      ]),
    );
    expect(html).toMatch(/<summary>Both<\/summary><p>Lead\.<\/p><div class="ak-nested">/u);
    expect(html).toMatch(/<summary>Blocks only<\/summary><div class="ak-nested">/u);
    expect(html).toMatch(/<summary>Text only<\/summary><p>Plain\.<\/p><\/details>/u);
  });

  it('renders a bento tile without a title when it holds blocks', () => {
    const { html } = compile(
      spec([{ type: 'bento', items: [{ blocks: [{ type: 'quote', text: 'Deterministic.' }] }] }]),
    );
    expect(html).toMatch(/<div class="ak-tile-body"><div class="ak-nested">/u);
    expect(html).not.toContain('<p class="ak-tile-title"');
  });

  it('validates the rich fixture with zero diagnostics', () => {
    const source = read('fixtures/pages/rich-composition.yaml');
    expect(validate(source, { source: 'rich-composition.yaml' }).diagnostics).toEqual([]);
    const { warnings, features } = compile(source, { source: 'rich-composition.yaml' });
    expect(warnings).toEqual([]);
    expect(features).toEqual(
      expect.arrayContaining(['tabs', 'accordion', 'carousel', 'bento', 'chart']),
    );
  });
});

describe('rich composition: diagnostics', () => {
  const cases: [type: string, block: Record<string, unknown>, message: RegExp][] = [
    [
      'tabs',
      { type: 'tabs', items: [{ title: 'A', text: 'x' }, { title: 'B' }] },
      /a tab needs text or blocks/u,
    ],
    ['accordion', { type: 'accordion', items: [{ title: 'A' }] }, /accordion section needs/u],
    [
      'carousel',
      { type: 'carousel', ariaLabel: 'Slides', items: [{ title: 'A' }] },
      /carousel slide needs/u,
    ],
    ['bento', { type: 'bento', items: [{ text: 'No title.' }] }, /bento tile needs a title/u],
  ];
  for (const [type, block, message] of cases) {
    it(`reports a ${type} item with neither content nor blocks at the item path`, () => {
      const found = errors(spec([block]));
      const index = type === 'tabs' ? 1 : 0;
      expect(found).toEqual([
        expect.objectContaining({
          code: 'SPEC_VALIDATION_ERROR',
          path: `$.blocks[0].items[${index}]`,
          message: expect.stringMatching(message),
        }),
      ]);
    });
  }

  it('keeps an explicitly empty text valid, as it was when text was required', () => {
    expect(errors(spec([{ type: 'accordion', items: [{ title: 'A', text: '' }] }]))).toEqual([]);
  });

  it('rejects page-level blocks inside an item at the child type path', () => {
    for (const type of ['section', 'hero']) {
      const child =
        type === 'section'
          ? { type, blocks: [{ type: 'text', text: 'x' }] }
          : { type, title: 'Nested hero' };
      const found = errors(
        spec([
          {
            type: 'tabs',
            items: [
              { title: 'A', text: 'x' },
              { title: 'B', blocks: [child] },
            ],
          },
        ]),
      );
      expect(found).toEqual([
        expect.objectContaining({
          code: 'SPEC_VALIDATION_ERROR',
          path: '$.blocks[0].items[1].blocks[0].type',
          details: expect.objectContaining({ type }),
        }),
      ]);
    }
  });

  it('allows tabs nested inside tabs', () => {
    const inner = {
      type: 'tabs',
      items: [
        { title: 'X', text: 'x' },
        { title: 'Y', text: 'y' },
      ],
    };
    expect(
      errors(
        spec([
          {
            type: 'tabs',
            items: [
              { title: 'A', blocks: [inner] },
              { title: 'B', text: 'b' },
            ],
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('bounds the nested list per item', () => {
    const many = Array.from({ length: 13 }, (_, index) => ({ type: 'text', text: `t${index}` }));
    const found = errors(spec([{ type: 'accordion', items: [{ title: 'A', blocks: many }] }]));
    expect(found).toEqual([
      expect.objectContaining({ code: 'SPEC_BOUNDS_ERROR', path: '$.blocks[0].items[0].blocks' }),
    ]);
    const tiles = Array.from({ length: 7 }, (_, index) => ({ type: 'text', text: `t${index}` }));
    expect(errors(spec([{ type: 'bento', items: [{ blocks: tiles }] }]))).toEqual([
      expect.objectContaining({ code: 'SPEC_BOUNDS_ERROR', path: '$.blocks[0].items[0].blocks' }),
    ]);
  });
});

describe('rich composition: runtime and styles', () => {
  it('passes the tab id as the select event value and fires nothing on load', () => {
    const { html } = compile(
      spec(
        [
          {
            type: 'tabs',
            on: { select: { action: 'set-value', path: 'state.view' } },
            items: [
              { id: 'tab-a', title: 'A', text: 'a' },
              { id: 'tab-b', title: 'B', text: 'b' },
            ],
          },
        ],
        { state: { view: 'tab-a' } },
      ),
    );
    expect(html).toContain("value: tabs[index].getAttribute('data-ak-tab-id')");
    expect(html).toContain('activateTab(container, 0, false, null, false);');
  });

  it('prints closed accordion sections open', () => {
    const { html } = compile(spec([{ type: 'accordion', items: [{ title: 'A', text: 'a' }] }]));
    expect(html).toContain(
      '.ak-accordion>details::details-content{content-visibility:visible;display:block}',
    );
  });
});
