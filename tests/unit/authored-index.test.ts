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

// A dropped item is counted where the author wrote it: its own error explains
// it, so a count check must not add a second, spurious diagnostic.
describe('authored list lengths in count checks', () => {
  it('does not add feature-matrix row warnings after a dropped plan', () => {
    const found = diagnosticsFor({
      type: 'feature-matrix',
      plans: ['Free', 5],
      rows: [{ feature: 'A', values: [true, true] }],
    });
    expect(found).toEqual([
      expect.objectContaining({ path: '$.blocks[0].plans[1]', severity: 'error' }),
    ]);
  });

  it('does not add a feature-matrix row warning after a dropped value', () => {
    const found = diagnosticsFor({
      type: 'feature-matrix',
      plans: ['Free', 'Pro'],
      rows: [
        { feature: 'A', values: [true, 7] },
        { feature: 'B', values: [true] },
      ],
    });
    expect(found).toEqual([
      expect.objectContaining({ path: '$.blocks[0].rows[0].values[1]', severity: 'error' }),
      expect.objectContaining({
        path: '$.blocks[0].rows[1].values',
        message: 'expected 2 values, one per plan, found 1',
      }),
    ]);
  });

  it('still reports a feature-matrix row the author wrote too long when a value is dropped', () => {
    const found = diagnosticsFor({
      type: 'feature-matrix',
      plans: ['Free', 'Pro', 'Team'],
      rows: [{ feature: 'A', values: [true, false, 7, true] }],
    });
    expect(found).toContainEqual(
      expect.objectContaining({ message: 'expected 3 values, one per plan, found 4' }),
    );
  });

  it('does not count a feature-matrix list rejected outright', () => {
    const found = diagnosticsFor({
      type: 'feature-matrix',
      plans: ['A', 'B', 'C', 'D', 'E', 'F'],
      rows: [{ feature: 'A', values: [true, true] }],
    });
    expect(found).toEqual([expect.objectContaining({ path: '$.blocks[0].plans' })]);
  });

  it('does not add a chart series warning after a dropped label or value', () => {
    const found = diagnosticsFor({
      type: 'chart',
      kind: 'bar',
      labels: ['a', 5, 'c'],
      series: [
        { label: 's', values: [1, 2, 3] },
        { label: 't', values: [1, 'x', 3] },
      ],
    });
    expect(found.filter((item) => item.severity === 'warning')).toEqual([]);
  });

  it('counts a chart series after a binding pass rebuilt the list', () => {
    const found = diagnosticsFor({
      type: 'chart',
      kind: 'bar',
      labels: ['a', 'b'],
      series: ['oops', { values: [1, 2, 3] }],
    });
    expect(found).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        path: '$.blocks[0].series[1]',
        message: 'series "1" has 3 values for 2 labels',
      }),
    );
  });

  it('does not count a feature-matrix row whose values list is rejected or missing', () => {
    const found = diagnosticsFor({
      type: 'feature-matrix',
      plans: ['Free', 'Pro'],
      rows: [
        { feature: 'A', values: [] },
        { feature: 'B', values: 'yes' },
      ],
    });
    expect(found.filter((item) => item.message.includes('one per plan'))).toEqual([]);
    expect(found).toContainEqual(expect.objectContaining({ path: '$.blocks[0].rows[0].values' }));
    expect(found).toContainEqual(expect.objectContaining({ path: '$.blocks[0].rows[1].values' }));
  });

  it('does not count an absent item that drops without an error', () => {
    const found = diagnosticsFor({
      type: 'feature-matrix',
      plans: ['Free', undefined, 'Pro'],
      rows: [{ feature: 'A', values: [true, true] }],
    });
    expect(found).toEqual([]);
  });

  it('counts the authored table columns in the row-width check', () => {
    const spurious = diagnosticsFor({
      type: 'table',
      columns: ['A', 5, 'C'],
      rows: [['x', 'y', 'z']],
    });
    expect(spurious.filter((item) => item.severity === 'warning')).toEqual([]);
    const missed = diagnosticsFor({ type: 'table', columns: ['A', 5, 'C'], rows: [['x', 'y']] });
    expect(missed).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        path: '$.blocks[0].rows[0]',
        message: 'row has 2 cells but the table declares 3 columns',
      }),
    );
  });
});
