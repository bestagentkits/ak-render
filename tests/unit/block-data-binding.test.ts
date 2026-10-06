import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';
import { PROBE_REGISTRY } from './support/probe-block-group.js';

const SALES = [
  { region: 'north', month: 'Jan', revenue: 120 },
  { region: 'south', month: 'Jan', revenue: 80 },
  { region: 'north', month: 'Feb', revenue: 140 },
];

function page(block: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Data' },
    datasets: { sales: SALES },
    blocks: [{ type: 'probe-list', ...block }],
    ...extra,
  };
}

function run(spec: unknown) {
  const result = normalizeSpec(spec, { registry: PROBE_REGISTRY });
  return {
    ...result,
    errors: result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
  };
}

describe('block data binding', () => {
  it('materializes a dataRef with its transform once, at normalize time', () => {
    const { ir, errors } = run(
      page({
        dataRef: 'sales',
        transform: {
          groupBy: { field: 'region', aggregate: 'sum', value: 'revenue', as: 'total' },
          sort: { by: 'total', direction: 'desc' },
        },
      }),
    );
    expect(errors).toEqual([]);
    expect(ir.datasets.sales).toHaveLength(3);
    const node = ir.nodes.find((candidate) => candidate.type === 'probe-list');
    expect(node?.data).toEqual({
      source: 'sales',
      fields: ['region', 'total'],
      rows: [
        { region: 'north', total: 260 },
        { region: 'south', total: 80 },
      ],
    });
    expect(node?.props).not.toHaveProperty('dataRef');
    expect(node?.props).not.toHaveProperty('transform');
  });

  it('renders inline data through the module renderer', () => {
    const html = compile(page({ data: [{ name: 'a', n: 1234.5 }] }), {
      registry: PROBE_REGISTRY,
    }).html;
    expect(html).toContain('<li>name=a n=1234.5</li>');
  });

  it('reports an unknown dataset with the known names', () => {
    const [error] = run(page({ dataRef: 'missing' })).errors;
    expect(error?.path).toBe('$.blocks[0].dataRef');
    expect(error?.details).toMatchObject({ dataRef: 'missing', known: ['sales'] });
  });

  it('reports a required binding that is absent', () => {
    const [error] = run(page({})).errors;
    expect(error?.path).toBe('$.blocks[0].dataRef');
    expect(error?.details).toEqual({ known: ['sales'] });
  });

  it('rejects dataRef and data together', () => {
    const [error] = run(page({ dataRef: 'sales', data: [{ a: 1 }] })).errors;
    expect(error?.path).toBe('$.blocks[0].dataRef');
  });

  it('reports unknown transform fields with the fields that exist', () => {
    const [error] = run(
      page({ dataRef: 'sales', transform: { filter: [{ field: 'country', equals: 'x' }] } }),
    ).errors;
    expect(error?.path).toBe('$.blocks[0].transform.filter[0].field');
    expect(error?.details).toEqual({ field: 'country', allowed: ['region', 'month', 'revenue'] });
  });

  it('runs the module check against the materialized fields', () => {
    const [error] = run(page({ dataRef: 'sales', labelField: 'name' })).errors;
    expect(error?.path).toBe('$.blocks[0].labelField');
    expect(error?.details).toEqual({ allowed: ['region', 'month', 'revenue'] });
  });

  it('treats data keys on a block without data as unknown props', () => {
    const { diagnostics } = normalizeSpec({
      version: 1,
      meta: { title: 'Data' },
      blocks: [{ type: 'text', text: 'a', dataRef: 'sales' }],
    });
    const paths = diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.path);
    expect(paths).toContain('$.blocks[0].dataRef');
  });

  it('reports invalid datasets at their JSON path', () => {
    const { errors } = run(page({ data: [{ a: 1 }] }, { datasets: { sales: [{ n: { x: 1 } }] } }));
    expect(errors.map((error) => error.path)).toContain('$.datasets.sales[0].n');
  });
});

describe('theme recipes', () => {
  it('stores valid recipes in surface order', () => {
    const { ir, errors } = run(
      page({ data: [{ a: 1 }] }, { theme: { recipes: { tables: 'ledger', cards: 'flat' } } }),
    );
    expect(errors).toEqual([]);
    expect(Object.entries(ir.theme.recipes ?? {})).toEqual([
      ['cards', 'flat'],
      ['tables', 'ledger'],
    ]);
  });

  it('reports an unknown surface or value with the allowed list', () => {
    const { errors } = run(
      page({ data: [{ a: 1 }] }, { theme: { recipes: { cards: 'glass', buttons: 'x' } } }),
    );
    expect(errors.map((error) => error.path).sort()).toEqual([
      '$.theme.recipes.buttons',
      '$.theme.recipes.cards',
    ]);
    expect(errors.every((error) => Array.isArray(error.details?.allowed))).toBe(true);
  });
});
