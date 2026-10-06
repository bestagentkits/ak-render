import { describe, expect, it } from 'vitest';
import { describeMany, isRenderError, type RenderError, searchCatalog } from '../../src/index.js';
import { catalogSearchTokens } from '../../src/registry/catalog-search.js';
import { compactDescription } from '../../src/registry/describe-many.js';
import { blockTypes, describe as describeBlock } from '../../src/registry/registry.js';

const registered = new Set(blockTypes());
const has = (type: string) => registered.has(type);

function thrown(action: () => unknown): RenderError {
  try {
    action();
  } catch (error) {
    if (isRenderError(error)) return error;
    throw error;
  }
  throw new Error('expected a RenderError');
}

describe('searchCatalog', () => {
  it('scores an exact type above a type segment, and a tag or use case above a summary word', () => {
    const [kbd] = searchCatalog('kbd');
    expect(kbd).toMatchObject({ type: 'kbd', category: 'content' });
    // Exact type 3, plus "Kbd:" in the summary 1.
    expect(kbd?.score).toBe(4);

    // "diagram" is a type segment (2), a tag (2), a use-case word (2) and a summary word (1).
    expect(searchCatalog('diagram')[0]).toMatchObject({ type: 'diagram-panel', score: 7 });
  });

  it('adds up every query word and scores the category name', () => {
    const hits = searchCatalog('architecture diagram');
    expect(hits[0]?.type).toBe('diagram-panel');
    const media = new Map(searchCatalog('media', 100).map((hit) => [hit.type, hit.score]));
    const inMedia = blockTypes().filter((type) => describeBlock(type).category === 'media');
    expect(inMedia.length).toBeGreaterThan(0);
    for (const type of inMedia) expect(media.get(type) ?? 0, type).toBeGreaterThanOrEqual(2);
  });

  it('breaks score ties by type in code-unit order and never returns a zero score', () => {
    const hits = searchCatalog('media', 100);
    for (let index = 1; index < hits.length; index += 1) {
      const previous = hits[index - 1];
      const current = hits[index];
      if (previous === undefined || current === undefined) continue;
      expect(previous.score).toBeGreaterThanOrEqual(current.score);
      if (previous.score === current.score) expect(previous.type < current.type).toBe(true);
    }
    expect(hits.every((hit) => hit.score > 0)).toBe(true);
  });

  it('is deterministic and honours the hit limit', () => {
    expect(searchCatalog('table rows')).toEqual(searchCatalog('table rows'));
    expect(searchCatalog('interaction')).toHaveLength(8);
    expect(searchCatalog('interaction', 2)).toHaveLength(2);
  });

  it('matches a plural against a singular word', () => {
    // Both table blocks are a right answer to a plural query for tables.
    expect(['table', 'data-table']).toContain(searchCatalog('tables')[0]?.type);
    expect(searchCatalog('shortcuts')[0]?.type).toBe('kbd');
  });

  it('tokenizes to at most 8 distinct lowercase ASCII words without filler words', () => {
    expect(catalogSearchTokens('Sortable TABLE, sortable; with the rows')).toEqual([
      'sortable',
      'table',
      'rows',
    ]);
    expect(catalogSearchTokens('a b c d e f g h i j')).toEqual([
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
    ]);
    expect(searchCatalog('   ')).toEqual([]);
    expect(searchCatalog('the and with')).toEqual([]);
    expect(searchCatalog('zzzqqq')).toEqual([]);
  });

  it('rejects an oversized query and an out-of-range limit', () => {
    expect(thrown(() => searchCatalog('x'.repeat(201))).path).toBe('query');
    expect(searchCatalog('x'.repeat(200))).toEqual([]);
    for (const limit of [0, 1.5, 101, Number.NaN]) {
      expect(thrown(() => searchCatalog('table', limit)).path).toBe('limit');
    }
  });

  it('ranks the expected block first for common intents', () => {
    const golden: [query: string, type: string][] = [
      ['sortable table', 'data-table'],
      ['pricing', 'pricing'],
      ['logs', 'log-viewer'],
      ['kanban board', 'kanban'],
      ['compare benchmark', 'benchmark-comparison'],
      ['faq', 'accordion'],
      ['keyboard shortcut', 'kbd'],
      ['architecture diagram', 'diagram-panel'],
    ];
    for (const [query, type] of golden) {
      // A block another package adds is asserted once it is registered.
      if (!has(type)) continue;
      expect(searchCatalog(query)[0]?.type, query).toBe(type);
    }
  });

  it('finds a filter for "filter rows by status" in the top three', () => {
    const top = searchCatalog('filter rows by status', 3).map((hit) => hit.type);
    expect(top).toContain(has('filter-bar') ? 'filter-bar' : 'search');
  });
});

describe('describeMany', () => {
  it('follows the input order and drops duplicates', () => {
    const contracts = describeMany(['tabs', 'kpi', 'tabs', 'hero']);
    expect(contracts.map((contract) => contract.type)).toEqual(['tabs', 'kpi', 'hero']);
    expect(contracts[0]).toEqual(describeBlock('tabs'));
  });

  it('returns the compact one-line-per-prop form on request', () => {
    const [kpi] = describeMany(['kpi'], { compact: true });
    expect(kpi).toBeDefined();
    expect(kpi?.props).toContain('items: list<object>, required');
    expect(kpi?.props).toContain('items[].trend: string, enum up|down|flat');
    expect(kpi?.props).toContain('items[].series: list<number>');
    expect(Object.keys(kpi ?? {})).toEqual([
      'type',
      'kind',
      'version',
      'category',
      'summary',
      'props',
    ]);
    expect(JSON.stringify(kpi)).not.toContain('description');
  });

  it('keeps slots and actions in the compact form', () => {
    const [card] = describeMany(['card'], { compact: true });
    expect(card?.slots?.length).toBeGreaterThan(0);
    const withActions = blockTypes()
      .map((type) => describeBlock(type))
      .find((definition) => definition.actions.length > 0);
    expect(withActions).toBeDefined();
    if (withActions === undefined) return;
    expect(compactDescription(withActions).actions).toEqual([...withActions.actions]);
  });

  it('fails for an unknown type with up to three closest types', () => {
    const error = thrown(() => describeMany(['hero', 'diagram-chart']));
    expect(error.code).toBe('SPEC_UNKNOWN_BLOCK');
    expect(error.message).toContain('unknown block type "diagram-chart"; closest: ');
    const closest = error.details?.closest as string[];
    expect(closest.length).toBeGreaterThan(0);
    expect(closest.length).toBeLessThanOrEqual(3);
    expect(closest).toContain('diagram-panel');
  });

  it('takes 1 to 12 distinct types', () => {
    expect(thrown(() => describeMany([])).code).toBe('SPEC_VALIDATION_ERROR');
    const many = blockTypes().slice(0, 13);
    expect(thrown(() => describeMany(many)).details?.count).toBe(13);
    expect(describeMany([...many.slice(0, 12), many[0] ?? 'hero'])).toHaveLength(12);
  });
});
