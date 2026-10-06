import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isRenderError, type RenderError } from '../../src/errors.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const rejectedDir = fileURLToPath(new URL('../../fixtures/rejected/validation', import.meta.url));
const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));

type Row = Record<string, string | number | boolean | null>;

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `item-${String(index).padStart(2, '0')}`,
    score: (index * 37) % 100,
  }));
}

function page(block: Record<string, unknown>, datasets: Record<string, Row[]> = {}) {
  return {
    version: 1,
    meta: { title: 'Data table' },
    ...(Object.keys(datasets).length === 0 ? {} : { datasets }),
    blocks: [{ type: 'data-table', ...block }],
  };
}

/** The data table's own markup, without the page chrome or runtime. */
function section(html: string): string {
  const match = /<section[^>]*\bak-data-table\b[\s\S]*?<\/section>/u.exec(html);
  if (match === null) throw new Error('no data-table section in the output');
  return match[0];
}

function bodyCells(markup: string, column: number): string[] {
  const body = /<tbody>([\s\S]*)<\/tbody>/u.exec(markup)?.[1] ?? '';
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gu)].map((row) => {
    const cells = [...(row[1] ?? '').matchAll(/<(?:td|th)[^>]*data-sort="([^"]*)"/gu)];
    return cells[column]?.[1] ?? '';
  });
}

const RUNS: Row[] = [
  {
    model: 'atlas',
    url: 'https://example.com/atlas',
    tokens: 128_400,
    reduction: 87,
    cost: 1.5,
    released: '2026-03-04',
    status: 'pass',
    coverage: 72,
    w1: 1,
    w2: 3,
    w3: 2,
  },
  {
    model: 'beacon',
    url: 'javascript:alert(1)',
    tokens: 900,
    reduction: 40,
    cost: 0.25,
    released: '2026-01-15',
    status: 'odd',
    coverage: 30,
    w1: 4,
    w2: 2,
    w3: 5,
  },
];

const EVERY_TYPE = [
  { key: 'model', label: 'Model', type: 'link', hrefField: 'url' },
  { key: 'tokens', type: 'number', format: 'compact' },
  { key: 'reduction', type: 'percent' },
  { key: 'cost', type: 'currency', currency: 'EUR' },
  { key: 'released', type: 'date' },
  { key: 'status', type: 'badge', tones: { odd: 'warning' } },
  { key: 'coverage', type: 'progress', max: 80 },
  { key: 'w3', label: 'Trend', type: 'sparkline', fields: ['w1', 'w2', 'w3'] },
  { key: 'model', label: 'Name', type: 'text' },
];

describe('data-table', () => {
  it('compiles the issue example with zero warnings', () => {
    const result = compile(
      page(
        {
          dataRef: 'performance',
          columns: [
            { key: 'model', label: 'Model', type: 'text' },
            { key: 'tokens', label: 'Tokens', type: 'number', format: 'compact' },
            { key: 'reduction', label: 'Saving', type: 'percentage' },
            { key: 'status', label: 'Status', type: 'badge' },
          ],
        },
        {
          performance: [
            { model: 'atlas', tokens: 12_000, reduction: 87, status: 'pass' },
            { model: 'beacon', tokens: 900, reduction: 40, status: 'fail' },
          ],
        },
      ),
    );
    expect(result.warnings).toEqual([]);
    expect(result.features).toContain('data-table');
    const markup = section(result.html);
    expect(markup).toContain('>12k</td>');
    expect(markup).toContain('>87%</td>');
    expect(markup).toContain('<span class="ak-badge" data-tone="success">pass</span>');
    expect(markup).toContain('<span class="ak-badge" data-tone="danger">fail</span>');
  });

  it('renders every column type', () => {
    const result = compile(page({ data: RUNS, columns: EVERY_TYPE }));
    const markup = section(result.html);
    // link: a safe URL becomes a link, an unsafe one stays text
    expect(markup).toContain(
      '<a href="https://example.com/atlas" rel="noreferrer noopener">atlas</a>',
    );
    expect(markup).not.toMatch(/href="javascript/iu);
    expect(markup).toMatch(/scope="row">beacon<\/th>/u);
    // number, percent, currency, date
    expect(markup).toContain('>128.4k</td>');
    expect(markup).toContain('>87%</td>');
    expect(markup).toContain('>€1.50</td>');
    expect(markup).toContain('>Mar 4, 2026</td>');
    // badge: authored tone, then the shared tones
    expect(markup).toContain('<span class="ak-badge" data-tone="warning">odd</span>');
    expect(markup).toContain('<span class="ak-badge" data-tone="success">pass</span>');
    // progress: a native meter plus the value as text
    expect(markup).toContain(
      '<meter aria-hidden="true" max="80" min="0" value="72"></meter><span>72</span>',
    );
    // sparkline: an inline SVG plus the values for assistive technology
    expect(markup).toMatch(/<svg class="ak-dt-spark"[^>]*aria-hidden="true"/u);
    expect(markup).toContain('<span class="ak-sr">1, 3, 2</span>');
    // numeric types align to the end
    expect(markup).toMatch(/<th class="ak-num" scope="col">tokens<\/th>/u);
    // the unsafe link is reported, not dropped silently
    expect(result.warnings).toEqual([
      expect.objectContaining({
        path: '$.blocks[0].columns[0].hrefField',
        severity: 'warning',
        message: expect.stringContaining('javascript:alert(1)'),
      }),
    ]);
  });

  it('reports an unknown column key with the allowed fields', () => {
    const { diagnostics } = normalizeSpec(
      page({ dataRef: 'runs', columns: [{ key: 'model' }, { key: 'latency' }] }, { runs: RUNS }),
    );
    const error = diagnostics.find((item) => item.severity === 'error');
    expect(error).toMatchObject({
      code: 'SPEC_VALIDATION_ERROR',
      path: '$.blocks[0].columns[1].key',
      details: { field: 'latency', allowed: Object.keys(RUNS[0] ?? {}) },
    });
  });

  it('reports unknown hrefField and sparkline fields, and a sparkline without fields', () => {
    const { diagnostics } = normalizeSpec(
      page({
        data: RUNS,
        columns: [
          { key: 'model', type: 'link', hrefField: 'href' },
          { key: 'w1', type: 'sparkline', fields: ['w1', 'w9'] },
          { key: 'w2', type: 'sparkline' },
        ],
      }),
    );
    const errors = diagnostics.filter((item) => item.severity === 'error').map((item) => item.path);
    expect(errors).toEqual([
      '$.blocks[0].columns[0].hrefField',
      '$.blocks[0].columns[1].fields[1]',
      '$.blocks[0].columns[2].fields',
    ]);
  });

  it('warns when a type-only prop sits on another column type', () => {
    const { diagnostics } = normalizeSpec(
      page({ data: RUNS, columns: [{ key: 'model', tones: { pass: 'success' } }] }),
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', path: '$.blocks[0].columns[0].tones' }),
    ]);
  });

  it('rejects the unknown-field fixture at the column path', () => {
    const source = readFileSync(`${rejectedDir}/data-table-unknown-field.yaml`, 'utf8');
    try {
      compile(source);
      throw new Error('expected a rejection');
    } catch (error) {
      expect(isRenderError(error)).toBe(true);
      expect((error as RenderError).code).toBe('SPEC_VALIDATION_ERROR');
      expect((error as RenderError).path).toBe('$.blocks[0].columns[1].key');
    }
  });

  it('renders rows in the order dataRef plus transform produce', () => {
    const markup = section(
      compile(
        page(
          {
            dataRef: 'scores',
            transform: { sort: { by: 'score', direction: 'desc' }, limit: 4 },
            columns: [{ key: 'name' }, { key: 'score', type: 'number' }],
          },
          { scores: rows(9) },
        ),
      ).html,
    );
    expect(bodyCells(markup, 1)).toEqual(['96', '85', '74', '59']);
    // The rows arrive sorted by score, so the header says so.
    expect(markup).toContain('<th aria-sort="descending" class="ak-num" scope="col">score</th>');
  });

  it('derives columns from the data when none are authored', () => {
    const markup = section(compile(page({ data: rows(3) })).html);
    // Derived names arrive in ascending order, which the header states.
    expect(markup).toContain('<th aria-sort="ascending" scope="col">name</th>');
    expect(markup).toContain('<th class="ak-num" scope="col">score</th>');
  });

  it('shows search past 10 rows and sticks the header past 12', () => {
    const ten = section(compile(page({ data: rows(10) })).html);
    expect(ten).not.toContain('data-ak-dt-search');
    const eleven = section(compile(page({ data: rows(11) })).html);
    expect(eleven).toContain('data-ak-dt-search');
    expect(eleven).toContain('>11 rows</p>');
    expect(eleven).not.toContain('data-ak-sticky');
    expect(section(compile(page({ data: rows(13) })).html)).toContain('data-ak-sticky');
  });

  it('marks header scope and every row for filtering', () => {
    const markup = section(compile(page({ data: rows(3) })).html);
    expect(markup.match(/scope="col"/gu)).toHaveLength(2);
    expect(markup).toMatch(/<th aria-sort="ascending" scope="col">name<\/th>/u);
    expect(markup.match(/scope="row"/gu)).toHaveLength(3);
    expect(markup).toContain(
      'data-ak-filter-item data-ak-row="{&quot;name&quot;:&quot;item-00&quot;,&quot;score&quot;:0}"',
    );
  });

  it('escapes row values', () => {
    const markup = section(
      compile(page({ data: [{ name: '<script>alert(1)</script>', note: '"quoted"' }] })).html,
    );
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('emits identical bytes for the same spec', () => {
    const source = readFileSync(`${pagesDir}/data-tables.yaml`, 'utf8');
    const outputs = [compile(source), compile(source), compile(source)].map(
      (result) => result.hash,
    );
    expect(new Set(outputs).size).toBe(1);
  });

  it('compiles the fixture with zero warnings and the runtime it needs', () => {
    const result = compile(readFileSync(`${pagesDir}/data-tables.yaml`, 'utf8'));
    expect(result.warnings).toEqual([]);
    expect(result.html).toContain('wireDataTables();');
    expect(result.html).toContain('data-ak-live');
  });
});
