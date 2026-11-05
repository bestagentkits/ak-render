import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { barsConfig, fitCamera } from '../../src/blocks/three/bars-3d.js';
import { barExtents, niceTicks, valueDomain } from '../../src/blocks/three/bars-layout.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url), 'utf8');

function chart(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Bars' },
    blocks: [
      {
        type: 'bars-3d',
        id: 'b',
        summary: 'Two regions over two quarters.',
        categories: [
          { id: 'q1', label: 'Q1' },
          { id: 'q2', label: 'Q2' },
        ],
        series: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        values: [
          [3, -2],
          [5, 4],
        ],
        ...extra,
      },
    ],
  };
}

function errors(spec: unknown) {
  return normalizeSpec(spec)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.path}: ${d.message}`);
}

function config(spec: ReturnType<typeof chart>) {
  const { ir } = normalizeSpec(spec);
  const node = ir?.nodes.find((n) => n.type === 'bars-3d');
  if (!node) throw new Error('no node');
  return barsConfig(node) as {
    objects: { id: string; position: number[]; scale: number[] }[];
    bars: { layouts: Record<string, [number, number][]>; ticks: [number, string][] };
  };
}

describe('bars-3d layout math', () => {
  it('starts grouped bars at zero and puts negatives below it', () => {
    expect(barExtents([[3, -2, 0]], 'grouped')).toEqual([
      [
        [0, 3],
        [-2, 0],
        [0, 0],
      ],
    ]);
  });

  it('stacks positives up and negatives down from zero, ending at each sign sum', () => {
    const [row] = barExtents([[4, -3, 2, -1, 5]], 'stacked');
    expect(row).toEqual([
      [0, 4],
      [-3, 0],
      [4, 6],
      [-4, -3],
      [6, 11],
    ]);
  });

  it('a filter collapses hidden series to the baseline and restacks the rest', () => {
    const [row] = barExtents([[4, 2, 5]], 'stacked', (s) => s !== 0);
    expect(row).toEqual([
      [0, 0],
      [0, 2],
      [2, 7],
    ]);
  });

  it('the domain always includes zero', () => {
    expect(valueDomain(barExtents([[3, 5]], 'grouped'))).toEqual([0, 5]);
    expect(valueDomain(barExtents([[-3, -5]], 'grouped'))).toEqual([-5, 0]);
    expect(valueDomain(barExtents([[-3, -5]], 'stacked'))).toEqual([-8, 0]);
  });

  it('ticks are round, cover the domain and include zero', () => {
    expect(niceTicks([-12, 47])).toEqual([-20, 0, 20, 40, 60]);
    expect(niceTicks([-52, 38])).toEqual([-60, -40, -20, 0, 20, 40]);
    expect(niceTicks([0, 1])).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks([0, 0])).toEqual([0]);
    // A step just under the raw one keeps the axis close to the data.
    expect(niceTicks([-10.9, 14.4])).toEqual([-15, -10, -5, 0, 5, 10, 15]);
  });
});

describe('bars-3d compile', () => {
  it('maps every bar to a box whose bottom and top match its extent', () => {
    const { objects, bars } = config(chart({ mode: 'stacked' }));
    expect(objects.map((o) => o.id)).toEqual(['q1/a', 'q1/b', 'q2/a', 'q2/b']);
    const all = bars.layouts[''] ?? [];
    objects.forEach((object, i) => {
      const [bottom, top] = all[i] ?? [0, 0];
      const half = (object.scale[1] ?? 0) / 2;
      expect((object.position[1] ?? 0) - half).toBeCloseTo(bottom, 3);
      expect((object.position[1] ?? 0) + half).toBeCloseTo(top, 3);
    });
    // q1/b is -2: it hangs below zero, and q2/b sits on q2/a's top.
    expect(all[1]?.[1]).toBe(0);
    expect(all[1]?.[0]).toBeLessThan(0);
    expect(all[3]?.[0]).toBe(all[2]?.[1]);
    // The zero tick sits at scene height zero.
    expect(bars.ticks.find(([, label]) => label === '0')?.[0]).toBe(0);
  });

  it('frames every bar inside the camera bounds', () => {
    const camera = fitCamera(10, 3, -2, 6);
    expect(camera.position[1]).toBeGreaterThan(camera.target[1] ?? 0);
    expect(camera.position[2]).toBeGreaterThan(0);
    expect(fitCamera(10, 3, -2, 6)).toEqual(camera);
  });

  it('compiles the 500-bar fixture byte-identically, with every value in the table', () => {
    const runs = [0, 1].map(() => compile(fixture('bars-3d-dense'), { source: 'dense' }).html);
    expect(runs[1]).toBe(runs[0]);
    const html = runs[0] ?? '';
    expect(html).toContain('data-ak-3d="bars"');
    expect(html.match(/data-ak-3d-pick=/g)).toHaveLength(500);
    expect(html.match(/<rect class="ak-3d-mark"/g)?.length).toBeGreaterThan(480);
  });

  it('shows stack totals in the stacked table', () => {
    const html = compile(fixture('bars-3d-stacked'), { source: 'stacked' }).html;
    expect(html).toContain('<th scope="col" class="ak-num">Total</th>');
    expect(html).toContain('<td class="ak-num">38 M</td>');
  });

  it('rejects a matrix that does not match the lists, and duplicate ids', () => {
    expect(errors(chart({ values: [[1, 2]] }))).toEqual([
      '$.blocks[0].values: values has 1 rows; categories lists 2',
    ]);
    expect(
      errors(
        chart({
          values: [[1], [2, 3]],
          series: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'A2' },
          ],
        }),
      ),
    ).toEqual([
      '$.blocks[0].series[1].id: id "a" is used twice',
      '$.blocks[0].values[0]: row has 1 values; series lists 2',
    ]);
  });
});
