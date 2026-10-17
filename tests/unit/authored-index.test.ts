import { describe, expect, it } from 'vitest';
import { normalizeSpec } from '../../src/spec/normalize.js';

// Validation drops an invalid list item ('oops' below). Every diagnostic about
// a later item must still name the index the author wrote.
function diagnosticsFor(block: Record<string, unknown>, extra: Record<string, unknown>[] = []) {
  const result = normalizeSpec({ version: 1, meta: { title: 'X' }, blocks: [block, ...extra] });
  return result.diagnostics.map(({ severity, path, message }) => ({ severity, path, message }));
}

describe('authored list indexes in diagnostics', () => {
  it('reports a chart series length warning at the authored series', () => {
    const found = diagnosticsFor({
      type: 'chart',
      kind: 'bar',
      labels: ['a', 'b'],
      series: ['oops', { label: 'ok', values: [1, 2] }, { label: 'short', values: [1] }],
    });
    expect(found).toContainEqual(
      expect.objectContaining({ severity: 'warning', path: '$.blocks[0].series[2]' }),
    );
    expect(found.filter((item) => item.path === '$.blocks[0].series[1]')).toEqual([]);
  });

  it('reports a duplicate decision option at the authored duplicate', () => {
    const found = diagnosticsFor(
      { type: 'decision', question: 'Q?', options: ['oops', { label: 'L' }, { label: 'L' }] },
      [{ type: 'feedback' }],
    );
    expect(found).toContainEqual(
      expect.objectContaining({ path: '$.blocks[0].options[2].label', severity: 'error' }),
    );
  });

  it('reports an unknown kanban card column at the authored card', () => {
    const found = diagnosticsFor({
      type: 'kanban',
      columns: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
      cards: ['oops', { title: 'One', column: 'a' }, { title: 'Two', column: 'zzz' }],
    });
    expect(found).toContainEqual(
      expect.objectContaining({ path: '$.blocks[0].cards[2].column', severity: 'error' }),
    );
    expect(found.filter((item) => item.path === '$.blocks[0].cards[1].column')).toEqual([]);
  });

  it('matches nested blocks to the authored item when checking item content', () => {
    const found = diagnosticsFor({
      type: 'bento',
      items: ['oops', { blocks: [{ type: 'text', text: 'Inside' }] }, { title: 'T' }],
    });
    // Only the dropped item is an error; the item with blocks has content.
    expect(found.filter((item) => item.severity === 'error')).toEqual([
      expect.objectContaining({ path: '$.blocks[0].items[0]' }),
    ]);
  });

  it('reports a calendar event date at the authored event', () => {
    const found = diagnosticsFor({
      type: 'calendar',
      month: '2026-10',
      events: ['oops', { date: '2026-10-02', title: 'A' }, { date: '2026-11-02', title: 'B' }],
    });
    expect(found).toContainEqual(
      expect.objectContaining({ path: '$.blocks[0].events[2].date', severity: 'error' }),
    );
  });

  it('reports a feature-matrix row width at the authored row', () => {
    const found = diagnosticsFor({
      type: 'feature-matrix',
      plans: ['Free', 'Pro'],
      rows: ['oops', { feature: 'A', values: [true, true] }, { feature: 'B', values: [true] }],
    });
    expect(found).toContainEqual(
      expect.objectContaining({ path: '$.blocks[0].rows[2].values', severity: 'error' }),
    );
  });

  it('adds no feature-matrix width error when a plan or value was dropped', () => {
    const found = diagnosticsFor({
      type: 'feature-matrix',
      plans: ['Free', 5],
      rows: [
        { feature: 'A', values: [true, true] },
        { feature: 'B', values: [true, {}] },
      ],
    });
    expect(found.map((item) => item.path)).toEqual([
      '$.blocks[0].plans[1]',
      '$.blocks[0].rows[1].values[1]',
    ]);
  });

  it('still reports a feature-matrix width error after a dropped value in another row', () => {
    const found = diagnosticsFor({
      type: 'feature-matrix',
      plans: ['Free', 'Pro'],
      rows: [
        { feature: 'A', values: [true, {}] },
        { feature: 'B', values: [true] },
      ],
    });
    expect(found.map((item) => item.path)).toEqual([
      '$.blocks[0].rows[0].values[1]',
      '$.blocks[0].rows[1].values',
    ]);
  });

  it('reports a second highlighted pricing plan at the authored plan', () => {
    const plan = (name: string) => ({ name, price: 1, highlight: true });
    const found = diagnosticsFor({ type: 'pricing', plans: ['oops', plan('A'), plan('B')] });
    expect(found).toContainEqual(
      expect.objectContaining({ path: '$.blocks[0].plans[2].highlight', severity: 'error' }),
    );
  });

  it('reports a blocked remote asset at the authored item', () => {
    const found = diagnosticsFor({
      type: 'testimonial',
      items: ['oops', { quote: 'Q', name: 'N', logo: 'https://example.com/logo.png' }],
    });
    expect(found).toContainEqual(expect.objectContaining({ path: '$.blocks[0].items[1].logo' }));
    expect(found.filter((item) => item.path === '$.blocks[0].items[0].logo')).toEqual([]);
  });

  it('keeps authored indexes for nested lists inside a kept item', () => {
    const found = diagnosticsFor({
      type: 'table',
      columns: ['a'],
      rows: [['x'], 'oops', ['y', 'extra']],
    });
    expect(found).toContainEqual(
      expect.objectContaining({ severity: 'warning', path: '$.blocks[0].rows[2]' }),
    );
  });
});
