import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getBlockDefinition } from '../../src/registry/registry.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const ENGINEERING_TYPES = [
  'kanban',
  'roadmap',
  'test-results',
  'log-viewer',
  'api-endpoint',
  'schema-viewer',
];

const fixturePath = fileURLToPath(
  new URL('../../fixtures/pages/engineering-widgets.yaml', import.meta.url),
);

function page(blocks: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { version: 1, meta: { title: 'Engineering' }, blocks, ...extra };
}

function diagnose(blocks: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const { diagnostics } = normalizeSpec(page(blocks, extra));
  return {
    errors: diagnostics.filter((item) => item.severity === 'error'),
    warnings: diagnostics.filter((item) => item.severity === 'warning'),
  };
}

function html(blocks: Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
  return compile(page(blocks, extra)).html;
}

const COLUMNS = [
  { id: 'todo', title: 'To do' },
  { id: 'done', title: 'Done' },
];

const KANBAN = {
  type: 'kanban',
  id: 'board',
  columns: COLUMNS,
  cards: [
    { title: 'Write docs', column: 'todo', owner: 'Ana', tags: ['docs'], status: 'bug' },
    { title: 'Ship', column: 'done' },
  ],
};

const ROADMAP = {
  type: 'roadmap',
  periods: ['2026-Q3', '2026-Q4', '2027-Q1'],
  items: [
    { title: 'Plan', start: '2026-Q3', end: '2026-Q4', status: 'done' },
    { title: 'Build', start: '2027-Q1', status: 'active' },
  ],
};

const TESTS = {
  type: 'test-results',
  suites: [
    { name: 'green', cases: [{ name: 'ok', status: 'pass', duration: 1200 }] },
    {
      name: 'red',
      cases: [
        { name: 'fine', status: 'pass', duration: 10 },
        { name: 'broken', status: 'fail', duration: 20, message: 'expected <a> to be <b>' },
      ],
    },
  ],
};

const API = {
  type: 'api-endpoint',
  id: 'get-run',
  method: 'GET',
  path: '/v1/runs/{id}',
  params: [{ name: 'id', in: 'path', type: 'string', required: true }],
  request: { code: '{"a": 1}' },
  responses: [{ status: 200, description: 'The run.', code: '{"id": "r1"}' }],
};

const SCHEMA = {
  type: 'schema-viewer',
  fields: [
    { path: 'user.email', type: 'string', required: true },
    { path: 'user.name', type: 'string' },
    { path: 'id', type: 'string' },
  ],
};

function logLines(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    time: `2026-10-06T10:00:${String(index % 60).padStart(2, '0')}Z`,
    level: index % 2 === 0 ? 'info' : 'error',
    source: 'api',
    message: `line ${index}`,
  }));
}

describe('engineering widgets: catalog', () => {
  it('registers every widget under the engineering category', () => {
    for (const type of ENGINEERING_TYPES) {
      const definition = getBlockDefinition(type);
      expect(definition?.category, type).toBe('engineering');
      expect(definition?.summary.length, type).toBeLessThanOrEqual(110);
    }
    expect(getBlockDefinition('kanban')?.filterable).toBe(true);
    expect(getBlockDefinition('log-viewer')?.filterable).toBe(true);
  });

  it('validates and compiles the fixture with no warnings, byte-identically three times', () => {
    const source = readFileSync(fixturePath, 'utf8');
    const { diagnostics } = normalizeSpec(source);
    expect(diagnostics).toEqual([]);
    const hashes = new Set([1, 2, 3].map(() => compile(source).hash));
    expect(hashes.size).toBe(1);
  });
});

describe('engineering widgets: rendering', () => {
  it('renders every widget from a minimal spec', () => {
    const LOG = { type: 'log-viewer', lines: logLines(3) };
    const output = html([KANBAN, ROADMAP, TESTS, LOG, API, SCHEMA]);
    for (const marker of [
      'ak-kanban-cols',
      'ak-roadmap-grid',
      'ak-tests-summary',
      'ak-log-lines',
      'ak-api-head',
      'ak-schema-row',
    ]) {
      expect(output).toContain(marker);
    }
    expect(diagnose([KANBAN, ROADMAP, TESTS, LOG, API, SCHEMA]).errors).toEqual([]);
  });

  it('emits a widget stylesheet only when the page uses that widget', () => {
    const output = html([SCHEMA]);
    expect(output).toContain('.ak-schema-row{');
    expect(output).not.toContain('.ak-kanban-cols{');
    expect(output).not.toContain('.ak-roadmap-grid{');
  });

  it('marks kanban cards and log lines with the filter row contract', () => {
    const output = html([KANBAN, { type: 'log-viewer', lines: logLines(2) }]);
    const cards = output.match(/<li[^>]*class="ak-kanban-card"[^>]*>/gu) ?? [];
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toContain('data-ak-filter-item');
      expect(card).toContain('data-ak-row="');
    }
    expect(cards[0]).toContain('&quot;tags&quot;:&quot;docs&quot;');
    const lines = output.match(/<li[^>]*class="ak-log-line"[^>]*>/gu) ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('&quot;level&quot;:&quot;error&quot;');
  });

  it('makes the kanban strip a labelled, focusable region of lists', () => {
    const output = html([KANBAN]);
    expect(output).toMatch(
      /<div[^>]*aria-label="Board"[^>]*class="ak-kanban"[^>]*role="region"[^>]*tabindex="0"/u,
    );
    expect(output).toContain('<ul class="ak-kanban-cols">');
    expect(output).toContain('<ul class="ak-kanban-cards" aria-label="To do">');
  });

  it('builds kanban cards from bound rows through the field map', () => {
    const output = html(
      [
        {
          type: 'kanban',
          columns: COLUMNS,
          dataRef: 'tickets',
          fields: { title: 'summary', column: 'state' },
        },
      ],
      {
        datasets: {
          tickets: [
            { summary: 'Bound card', state: 'todo', owner: 'Kim' },
            { summary: 'Another', state: 'done', owner: null },
          ],
        },
      },
    );
    expect(output).toContain('Bound card');
    expect(output).toContain('<span class="ak-kanban-owner">Kim</span>');
    expect(output).toContain('&quot;summary&quot;:&quot;Bound card&quot;');
  });

  it('places roadmap items with index attributes and no inline style', () => {
    const output = html([ROADMAP]);
    expect(output).toContain('data-ak-cols="3"');
    expect(output).toMatch(/data-ak-end="2"[^>]*data-ak-start="1"/u);
    expect(output).toMatch(/data-ak-end="3"[^>]*data-ak-start="3"/u);
    const main = output.slice(output.indexOf('<main'), output.indexOf('</main>'));
    expect(main).not.toMatch(/\sstyle=/u);
    // The phone and print agenda groups items by their start period.
    expect(output).toContain('<h3 class="ak-roadmap-period">2026-Q3</h3>');
    expect(output).toContain('until 2026-Q4');
  });

  it('computes the test summary and lists failures first, open', () => {
    const output = html([TESTS]);
    expect(output).toContain('1 of 3 tests failed');
    expect(output).toContain('<dt>Duration</dt><dd>1.2 s</dd>');
    const red = output.indexOf('ak-tests-suite-name">red');
    const green = output.indexOf('ak-tests-suite-name">green');
    expect(red).toBeGreaterThan(-1);
    expect(red).toBeLessThan(green);
    expect(output).toMatch(/<details class="ak-tests-suite" data-status="fail" open>/u);
    expect(output).toMatch(/<details class="ak-tests-suite" data-status="pass">/u);
    expect(output.indexOf('broken')).toBeLessThan(output.indexOf('>fine<'));
    expect(output).toContain('expected &lt;a&gt; to be &lt;b&gt;');
  });

  it('adds the core search to a log longer than 20 lines only', () => {
    expect(html([{ type: 'log-viewer', lines: logLines(20) }])).not.toContain('data-ak-search="');
    const long = html([{ type: 'log-viewer', id: 'log', lines: logLines(21) }]);
    expect(long).toContain('data-ak-search="log"');
    expect(long).toContain('<label for="ak-log-search-log">Search lines</label>');
  });

  it('shows clock times and states a shared date once', () => {
    const output = html([{ type: 'log-viewer', lines: logLines(2) }]);
    expect(output).toContain('<time datetime="2026-10-06">2026-10-06</time>');
    expect(output).toContain(
      '<time class="ak-log-time" datetime="2026-10-06T10:00:00Z">10:00:00</time>',
    );
  });

  it('highlights path parameters and gives every copy target a unique id', () => {
    const output = html([API]);
    expect(output).toContain('/v1/runs/<span class="ak-api-param">{id}</span>');
    expect(output).toContain('data-ak-id="get-run.path"');
    expect(output).toContain('data-ak-id="get-run.request"');
    expect(output).toContain('data-ak-id="get-run.response-0"');
    expect(output).toContain('<th scope="row"><code>id</code>');
    expect(output).toContain('<th scope="col">Name</th>');
  });

  it('builds the schema tree with implicit parents in authored order', () => {
    const output = html([SCHEMA]);
    expect(output).toMatch(
      /<summary class="ak-schema-row"><span class="ak-schema-name">user<\/span><span class="ak-schema-type" data-implicit>object<\/span>/u,
    );
    expect(output.indexOf('>email<')).toBeLessThan(output.indexOf('>name<'));
    expect(output.indexOf('>user<')).toBeLessThan(output.indexOf('>id<'));
    expect(output).toContain('<details open>');
  });
});

describe('engineering widgets: checks', () => {
  it('reports a kanban card in an unknown column at its path', () => {
    const { errors } = diagnose([{ ...KANBAN, cards: [{ title: 'Lost', column: 'doing' }] }]);
    expect(errors.map((item) => item.path)).toContain('$.blocks[0].cards[0].column');
  });

  it('requires cards or a data binding, but not both', () => {
    const neither = diagnose([{ type: 'kanban', columns: COLUMNS }]);
    expect(neither.errors.map((item) => item.path)).toContain('$.blocks[0].cards');
    const both = diagnose([{ ...KANBAN, data: [{ title: 'x', column: 'todo' }] }]);
    expect(both.errors.map((item) => item.path)).toContain('$.blocks[0].cards');
    // An unresolvable dataRef is reported once, at the binding, not again as missing cards.
    const unknown = diagnose([{ type: 'kanban', columns: COLUMNS, dataRef: 'nope' }]);
    expect(unknown.errors.map((item) => item.path)).toEqual(['$.blocks[0].dataRef']);
  });

  it('reports unmapped fields and unknown columns in bound kanban rows', () => {
    const missing = diagnose([
      { type: 'kanban', columns: COLUMNS, data: [{ name: 'x', column: 'todo' }] },
    ]);
    expect(missing.errors.map((item) => item.path)).toContain('$.blocks[0].fields.title');
    const column = diagnose([
      { type: 'kanban', columns: COLUMNS, data: [{ title: 'x', column: 'later' }] },
    ]);
    expect(column.errors.map((item) => item.path)).toContain('$.blocks[0].data');
  });

  it('reports roadmap periods that are unknown, reversed or out of lane', () => {
    const { errors } = diagnose([
      {
        type: 'roadmap',
        periods: ['A', 'B', 'C'],
        lanes: [{ id: 'core', title: 'Core' }],
        items: [
          { title: 'Unknown', lane: 'core', start: 'Z' },
          { title: 'Reversed', lane: 'core', start: 'C', end: 'A' },
          { title: 'No lane', start: 'A' },
          { title: 'Bad lane', lane: 'ops', start: 'A' },
        ],
      },
    ]);
    expect(errors.map((item) => item.path)).toEqual(
      expect.arrayContaining([
        '$.blocks[0].items[0].start',
        '$.blocks[0].items[1].end',
        '$.blocks[0].items[2].lane',
        '$.blocks[0].items[3].lane',
      ]),
    );
  });

  it('bounds test cases to 200 across all suites', () => {
    const cases = Array.from({ length: 101 }, (_, index) => ({
      name: `c${index}`,
      status: 'pass',
    }));
    const { errors } = diagnose([
      {
        type: 'test-results',
        suites: [
          { name: 'a', cases },
          { name: 'b', cases },
        ],
      },
    ]);
    expect(errors).toEqual([
      expect.objectContaining({ code: 'SPEC_BOUNDS_ERROR', path: '$.blocks[0].suites' }),
    ]);
  });

  it('reports a duplicate schema path and an empty segment', () => {
    const { errors } = diagnose([
      {
        type: 'schema-viewer',
        fields: [
          { path: 'a.b', type: 'string' },
          { path: 'a.b', type: 'number' },
          { path: 'a..c', type: 'string' },
        ],
      },
    ]);
    expect(errors.map((item) => item.path)).toEqual([
      '$.blocks[0].fields[1].path',
      '$.blocks[0].fields[2].path',
    ]);
  });

  it('warns when the api path and its path parameters disagree', () => {
    const { warnings } = diagnose([
      { ...API, params: [{ name: 'run', in: 'path', type: 'string' }] },
    ]);
    expect(warnings.map((item) => item.path)).toEqual(['$.blocks[0].path', '$.blocks[0].params']);
  });

  it('warns about a bound log level outside the known levels', () => {
    const { warnings, errors } = diagnose([
      { type: 'log-viewer', data: [{ level: 'trace', message: 'x' }] },
    ]);
    expect(errors).toEqual([]);
    expect(warnings.map((item) => item.path)).toEqual(['$.blocks[0].data']);
  });
});
