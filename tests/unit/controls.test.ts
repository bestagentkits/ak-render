import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';
import { parseSpec } from '../../src/spec/parse.js';
import { FILTERABLE_REGISTRY } from './support/probe-filterable-group.js';

const ROWS = [
  { model: 'Legacy', tokens: 33696, date: '2026-01-04', cached: false },
  { model: 'AK Render', tokens: 4387, date: '2026-02-11', cached: true },
  { model: 'Draft', tokens: 9100, date: '2026-03-20', cached: true },
];

function page(blocks: unknown[], extra: Record<string, unknown> = {}) {
  return { version: 1, meta: { title: 'Controls' }, ...extra, blocks };
}

/** A filter-bar over the probe rows, holding the given controls. */
function barPage(controls: unknown[], target = 'runs') {
  return page([
    { type: 'filter-bar', target, blocks: controls },
    { type: 'probe-rows', id: 'runs', data: ROWS },
    { type: 'text', id: 'note', text: 'Not filterable.' },
  ]);
}

function diagnostics(spec: unknown) {
  return normalizeSpec(spec, { registry: FILTERABLE_REGISTRY }).diagnostics;
}

function errors(spec: unknown) {
  return diagnostics(spec).filter((d) => d.severity === 'error');
}

function warnings(spec: unknown) {
  return diagnostics(spec).filter((d) => d.severity === 'warning');
}

function html(spec: unknown) {
  return compile(spec, { registry: FILTERABLE_REGISTRY }).html;
}

/** Markup of the body only, without the runtime script and stylesheet. */
function body(spec: unknown) {
  const out = html(spec);
  return out.slice(out.indexOf('<body'), out.indexOf('<script'));
}

const METRIC_SWITCHER = page(
  [
    {
      type: 'select',
      label: 'Metric',
      options: [
        { value: 'cost', label: 'Cost' },
        { value: 'latency', label: 'Latency' },
      ],
      on: { change: { action: 'set-value', path: 'state.metric' } },
    },
    { type: 'text', text: 'Cost view.', visibleWhen: { path: 'state.metric', equals: 'cost' } },
    {
      type: 'text',
      text: 'Latency view.',
      visibleWhen: { path: 'state.metric', equals: 'latency' },
    },
  ],
  { state: { metric: 'cost' } },
);

describe('state binding', () => {
  it('rejects a bind to an undeclared state key at its path', () => {
    const found = errors(
      page([{ type: 'select', label: 'Model', bind: 'state.model', options: [{ value: 'a' }] }], {
        state: { metric: 'cost' },
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: 'SPEC_VALIDATION_ERROR',
      path: '$.blocks[0].bind',
      details: { known: ['metric'] },
    });
  });

  it('rejects a bind that is not a one-key state path', () => {
    const at = (bind: string) =>
      errors(page([{ type: 'switch', label: 'On', bind }], { state: { on: false } })).map((d) => [
        d.code,
        d.path,
      ]);
    for (const bind of ['state.on.deep', 'on', 'state.__proto__', 'window.on']) {
      expect(at(bind)).toEqual([['POLICY_VIOLATION', '$.blocks[0].bind']]);
    }
  });

  it('starts from the bound state value and warns when the authored value differs', () => {
    const spec = page(
      [
        {
          type: 'select',
          label: 'Metric',
          bind: 'state.metric',
          value: 'cost',
          options: [{ value: 'cost' }, { value: 'latency' }],
        },
        { type: 'switch', label: 'Details', bind: 'state.show-details' },
      ],
      { state: { metric: 'latency', 'show-details': true } },
    );
    expect(warnings(spec).map((d) => d.path)).toEqual(['$.blocks[0].value']);
    const markup = body(spec);
    expect(markup).toContain('<option selected value="latency">latency</option>');
    expect(markup).toMatch(/<input[^>]* checked[^>]* role="switch"/u);
    expect(markup).toContain('data-ak-bind="state.metric" data-ak-bind-target="state"');
  });

  it('warns when the bound state holds another type than the control writes', () => {
    const found = warnings(
      page([{ type: 'checkbox', label: 'On', bind: 'state.on' }], { state: { on: 'yes' } }),
    );
    expect(found.map((d) => d.path)).toEqual(['$.blocks[0].bind']);
  });

  it('compiles the metric switcher with zero diagnostics', () => {
    expect(diagnostics(METRIC_SWITCHER)).toEqual([]);
    const result = compile(METRIC_SWITCHER);
    expect(result.features).toContain('controls');
    expect(result.html).toContain('function wireControls()');
    expect(result.html).toContain('wireControls();');
    expect(result.html).not.toContain('wireFilterBars');
  });
});

describe('control checks', () => {
  it('rejects duplicate or empty option values and a value outside the options', () => {
    const found = errors(
      page([
        {
          type: 'radio-group',
          label: 'Tier',
          value: 'gold',
          options: [{ value: 'free' }, { value: 'free' }, { value: '' }],
        },
      ]),
    );
    expect(found.map((d) => d.path)).toEqual([
      '$.blocks[0].options[1].value',
      '$.blocks[0].options[2].value',
      '$.blocks[0].value',
    ]);
  });

  it('needs exactly one source of options', () => {
    expect(errors(page([{ type: 'select', label: 'X' }])).map((d) => d.path)).toEqual([
      '$.blocks[0]',
    ]);
  });

  it('caps a radio group at 8 options', () => {
    const options = Array.from({ length: 9 }, (_, index) => ({ value: `o${index}` }));
    expect(errors(page([{ type: 'radio-group', label: 'X', options }]))[0]?.path).toBe(
      '$.blocks[0].options',
    );
  });

  it('rejects number bounds out of order and a value outside them', () => {
    expect(
      errors(page([{ type: 'number-input', label: 'N', min: 5, max: 1 }])).map((d) => d.path),
    ).toEqual(['$.blocks[0].min']);
    expect(
      errors(page([{ type: 'number-input', label: 'N', min: 0, max: 10, value: 11 }])).map(
        (d) => d.path,
      ),
    ).toEqual(['$.blocks[0].value']);
  });

  it('accepts only a real ISO calendar date', () => {
    const at = (value: string) =>
      errors(page([{ type: 'date-input', label: 'From', value }])).map((d) => d.path);
    expect(at('2026-02-28')).toEqual([]);
    expect(at('2026-02-30')).toEqual(['$.blocks[0].value']);
    expect(at('02/03/2026')).toEqual(['$.blocks[0].value']);
  });

  it('bounds text input length at 200', () => {
    expect(
      errors(page([{ type: 'text-input', label: 'Q', maxLength: 201 }])).map((d) => d.path),
    ).toEqual(['$.blocks[0].maxLength']);
  });

  it('warns that field and match do nothing outside a filter-bar', () => {
    const found = warnings(
      page([{ type: 'text-input', label: 'Q', field: 'model', match: 'contains' }]),
    );
    expect(found.map((d) => d.path)).toEqual(['$.blocks[0].field', '$.blocks[0].match']);
  });

  it('rejects a match operator the control does not offer', () => {
    expect(
      errors(
        barPage([
          { type: 'select', label: 'M', field: 'model', match: 'min', options: [{ value: 'a' }] },
        ]),
      )[0]?.path,
    ).toBe('$.blocks[0].blocks[0].match');
    expect(
      errors(barPage([{ type: 'text-input', label: 'Q', field: 'model', match: 'max' }]))[0]?.path,
    ).toBe('$.blocks[0].blocks[0].match');
  });
});

describe('filter-bar checks', () => {
  it('rejects an unknown or non-filterable target with the filterable ids', () => {
    for (const target of ['missing', 'note']) {
      const found = errors(barPage([{ type: 'text-input', label: 'Q', field: 'model' }], target));
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        code: 'SPEC_VALIDATION_ERROR',
        path: '$.blocks[0].target',
        details: { allowed: ['runs'] },
      });
    }
  });

  it('rejects a block the bar does not accept, such as a chart', () => {
    const found = errors(
      barPage([
        { type: 'chart', kind: 'bar', labels: ['a'], series: [{ label: 's', values: [1] }] },
      ]),
    );
    expect(found[0]).toMatchObject({ path: '$.blocks[0].blocks[0].type' });
    expect(found[0]?.details?.allowed).toContain('select');
  });

  it('accepts 1 to 8 controls', () => {
    const control = { type: 'checkbox', label: 'Cached', field: 'cached' };
    expect(errors(barPage(Array.from({ length: 9 }, () => control)))[0]?.path).toBe(
      '$.blocks[0].blocks',
    );
    expect(errors(barPage([]))[0]?.path).toBe('$.blocks[0].blocks');
  });

  it('needs a field on each control and checks it against the target fields', () => {
    expect(errors(barPage([{ type: 'text-input', label: 'Q' }]))[0]?.path).toBe(
      '$.blocks[0].blocks[0]',
    );
    const unknown = errors(barPage([{ type: 'text-input', label: 'Q', field: 'nope' }]));
    expect(unknown[0]).toMatchObject({
      path: '$.blocks[0].blocks[0].field',
      details: { allowed: ['model', 'tokens', 'date', 'cached'] },
    });
  });

  it('keeps a search inside the bar on the bar target', () => {
    const found = errors(
      barPage([
        {
          type: 'search',
          label: 'Search',
          on: { filter: { action: 'filter', target: 'note' } },
        },
      ]),
    );
    expect(found.map((d) => d.path)).toEqual(['$.blocks[0].blocks[0].on']);
    expect(errors(barPage([{ type: 'search', label: 'Search' }]))).toEqual([]);
  });

  it('derives options from the target, sorted, behind an All choice', () => {
    const spec = barPage([
      { type: 'select', label: 'Model', field: 'model', optionsFrom: 'model' },
      { type: 'radio-group', label: 'Tokens', field: 'tokens', optionsFrom: 'tokens' },
    ]);
    expect(diagnostics(spec)).toEqual([]);
    const markup = body(spec);
    expect(markup).toContain(
      '<option selected value="">All</option><option value="AK Render">AK Render</option><option value="Draft">Draft</option><option value="Legacy">Legacy</option>',
    );
    const radios = [...markup.matchAll(/type="radio" value="([^"]*)"/gu)].map((m) => m[1]);
    expect(radios).toEqual(['', '4387', '9100', '33696']);
  });

  it('rejects optionsFrom outside a bar and an unknown optionsFrom field', () => {
    expect(
      errors(page([{ type: 'select', label: 'M', optionsFrom: 'model' }])).map((d) => d.path),
    ).toEqual(['$.blocks[0].optionsFrom']);
    expect(
      errors(barPage([{ type: 'select', label: 'M', field: 'model', optionsFrom: 'x' }]))[0],
    ).toMatchObject({ path: '$.blocks[0].blocks[0].optionsFrom' });
  });

  it('rejects the shipped bad-target fixture at the target path', () => {
    const source = readFileSync('fixtures/rejected/validation/filter-bar-bad-target.yaml', 'utf8');
    const found = normalizeSpec(parseSpec(source)).diagnostics.filter(
      (d) => d.severity === 'error',
    );
    expect(found.map((d) => [d.code, d.path])).toEqual([
      ['SPEC_VALIDATION_ERROR', '$.blocks[1].target'],
    ]);
  });
});

describe('control markup', () => {
  const ALL = barPage([
    { type: 'select', label: 'Model', field: 'model', optionsFrom: 'model', hint: 'Pick one.' },
    { type: 'radio-group', label: 'Era', field: 'date', options: [{ value: '2026-01-04' }] },
    { type: 'checkbox', label: 'Cached', field: 'cached' },
    { type: 'switch', label: 'Cached only', field: 'cached' },
    { type: 'text-input', label: 'Name', field: 'model', placeholder: 'Search' },
    { type: 'number-input', label: 'Min tokens', field: 'tokens', min: 0 },
    { type: 'date-input', label: 'From', field: 'date', match: 'min' },
    { type: 'search', label: 'Anything' },
  ]);

  it('associates every label with its input', () => {
    const markup = body(ALL);
    const fors = [...markup.matchAll(/<label for="([^"]+)"/gu)].map((m) => m[1]);
    expect(fors.length).toBeGreaterThanOrEqual(8);
    for (const id of fors)
      expect(markup).toMatch(new RegExp(`<(input|select)[^>]* id="${id}"`, 'u'));
    expect(markup).toContain('<legend>Era</legend>');
    expect(markup).toContain('aria-describedby="');
  });

  it('renders disabled inputs with one no-script note per bar and a count of all rows', () => {
    const markup = body(ALL);
    const controls = [...markup.matchAll(/<(input|select)\b[^>]*>/gu)].map((m) => m[0]);
    const own = controls.filter((tag) => !tag.includes('type="search"'));
    expect(own.length).toBeGreaterThan(0);
    for (const tag of own) expect(tag).toContain(' disabled');
    expect(markup.match(/data-ak-requires-js/gu)).toHaveLength(1);
    expect(markup).toContain('<p class="ak-filter-count" data-ak-filter-count>3 items</p>');
    expect(markup).toContain('data-ak-filter-reset>Reset</button>');
    expect(markup).toMatch(
      /data-ak-control="date-input" data-ak-field="date" [^>]*data-ak-match="min"/u,
    );
    expect(markup).toMatch(
      /data-ak-control="switch" data-ak-field="cached" [^>]*data-ak-match="truthy"/u,
    );
  });

  it('gives a standalone control its own no-script note', () => {
    const markup = body(page([{ type: 'text-input', label: 'Name' }]));
    expect(markup).toContain('<p class="ak-control-note" data-ak-requires-js>');
  });

  it('emits both features, their scripts and the live region for a bar', () => {
    const result = compile(ALL, { registry: FILTERABLE_REGISTRY });
    expect(result.features).toEqual(expect.arrayContaining(['controls', 'filter-bar', 'filter']));
    expect(result.html).toContain('.ak-filter-bar{');
    expect(result.html).toContain('wireControls();\nwireFilterBars();');
    expect(result.html).toContain('data-ak-live');
    expect(result.warnings).toEqual([]);
  });

  it('escapes authored text', () => {
    const markup = body(
      page([
        { type: 'select', label: '<b>x</b>', options: [{ value: '"><script>', label: '<i>' }] },
      ]),
    );
    expect(markup).not.toContain('<b>x</b>');
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;i&gt;');
  });

  it('compiles deterministically', () => {
    const hashes = [1, 2, 3].map(() => compile(ALL, { registry: FILTERABLE_REGISTRY }).hash);
    expect(new Set(hashes).size).toBe(1);
  });
});
