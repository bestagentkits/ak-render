import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { axisScale, niceStep, niceTicks, unit } from '../../src/blocks/three/scatter-ir.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url), 'utf8');

function scatter(extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Scatter' },
    blocks: [
      {
        type: 'scatter-3d',
        id: 's',
        summary: 'Points.',
        axes: { x: { label: 'A' }, y: { label: 'B' }, z: { label: 'C' } },
        data: { x: [1, 2, 3], y: [4, 5, 6], z: [7, 8, 9], ...data },
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

/** The JSON config the runtime mounts. */
function config(html: string) {
  const raw = /data-ak-scene="([^"]*)"/u.exec(html)?.[1] ?? '{}';
  return JSON.parse(raw.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&'));
}

describe('scatter-3d scales', () => {
  it('picks 1, 2 or 5 steps', () => {
    expect(niceStep(100)).toBe(20);
    expect(niceStep(7)).toBe(1);
    expect(niceStep(0.3)).toBe(0.05);
    expect(niceStep(0)).toBe(1);
  });

  it('prints ticks at the step precision', () => {
    expect(niceTicks(0, 1)).toEqual({ ticks: [0, 0.2, 0.4, 0.6, 0.8, 1], digits: 1 });
    expect(niceTicks(-20, 100).ticks).toEqual([-20, 0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0.1, 0.35).ticks).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
  });

  it('widens the data extent to whole ticks and keeps explicit bounds exact', () => {
    const auto = axisScale([3.2, 47.9], { label: 'L' });
    expect(auto.domain).toEqual([0, 50]);
    expect(auto.ticks).toEqual([0, 10, 20, 30, 40, 50]);
    const fixed = axisScale([3.2, 47.9], { label: 'L', min: 1.25, max: 40 });
    expect(fixed.domain).toEqual([1.25, 40]);
    expect(unit(1.25, fixed)).toBe(0);
    expect(unit(40, fixed)).toBe(1);
    expect(axisScale([5, 5], {}).domain).toEqual([4, 6]);
  });
});

describe('scatter-3d contract', () => {
  it('accepts both fixtures and compiles byte-identically', () => {
    for (const name of ['scatter-3d-basic', 'scatter-3d-20k']) {
      const runs = [0, 1].map(() => compile(fixture(name), { source: name }).html);
      expect(runs[1]).toBe(runs[0]);
      expect(runs[0]).toContain('data-ak-3d="scatter"');
      expect(runs[0]).toContain('__akThree');
    }
  });

  it('renders all 20,000 points into the table, the poster and the runtime config', () => {
    const html = compile(fixture('scatter-3d-20k'), { source: '20k' }).html;
    expect(html.match(/<tr data-ak-sc-point=/gu)).toHaveLength(20000);
    const scene = config(html);
    expect(scene.count).toBe(20000);
    expect(scene.positions).toHaveLength(60000);
    expect(scene.groups).toEqual(['core', 'growth', 'legacy', 'edge']);
    // CPU load is bounded to 0..100; points beyond it are clipped, listed and not drawn.
    expect(scene.axes.y.ticks.map((t: [number, string]) => t[1])).toEqual([
      '0',
      '20',
      '40',
      '60',
      '80',
      '100',
    ]);
    expect(scene.clipped.length).toBeGreaterThan(0);
    expect(html.match(/<td>Clipped<\/td>/gu)).toHaveLength(scene.clipped.length);
    expect(html.match(/<circle /gu)).toHaveLength(20000 - scene.clipped.length);
    expect(html).toContain(`${(20000 - scene.clipped.length).toLocaleString('en-US')} of 20,000`);
  });

  it('maps values into the cube and marks the selected point from state', () => {
    const html = compile(
      scatter(
        {
          bind: 'state.p',
          axes: {
            x: { label: 'A', unit: 'ms', min: 0, max: 4 },
            y: { label: 'B' },
            z: { label: 'C' },
          },
        },
        { id: ['a', 'b', 'c'], x: [0, 2, 9] },
      ),
    ).html;
    expect(html).toBe(
      compile(
        scatter(
          {
            bind: 'state.p',
            axes: {
              x: { label: 'A', unit: 'ms', min: 0, max: 4 },
              y: { label: 'B' },
              z: { label: 'C' },
            },
          },
          { id: ['a', 'b', 'c'], x: [0, 2, 9] },
        ),
      ).html,
    );
    const scene = config(html);
    expect(scene.positions.filter((_: number, i: number) => i % 3 === 0)).toEqual([-1, 0, 3.5]);
    expect(scene.clipped).toEqual([2]);
    expect(scene.ids).toEqual(['a', 'b', 'c']);
    expect(html).toContain('A (ms)');

    const selected = compile({
      ...scatter({ bind: 'state.p' }, { id: ['a', 'b', 'c'] }),
      state: { p: 'b' },
    }).html;
    expect(selected).toContain('<tr data-ak-sc-point="b" aria-selected="true">');
    expect(selected).toContain('class="t-accent s"');
  });

  it('encodes size and sequential color with a legend', () => {
    const html = compile(
      scatter(
        {
          axes: {
            x: { label: 'A' },
            y: { label: 'B' },
            z: { label: 'C' },
            color: { label: 'Rent', unit: '$' },
          },
        },
        { size: [1, 5, 10], value: [0, 50, 100] },
      ),
    ).html;
    const scene = config(html);
    expect(scene.palette).toBe('sequential');
    expect(scene.colors).toEqual([0, 4, 7]);
    expect(scene.sizes[0]).toBeLessThan(scene.sizes[2]);
    expect(html).toContain('Rent ($)');
    expect(html).toContain('class="ak-sc-ramp"');
    expect(html).toContain('class="ak-sc-sizes"');
  });

  it('rejects mismatched columns, duplicate ids, unknown groups and inverted bounds', () => {
    expect(errors(scatter({}, { y: [1, 2] }))).toEqual([
      '$.blocks[0].data.y: column "y" has 2 values; x has 3',
    ]);
    expect(errors(scatter({}, { id: ['a', 'a', 'b'] }))).toEqual([
      '$.blocks[0].data.id[1]: point id "a" is used twice',
    ]);
    expect(errors(scatter({ groups: [{ value: 'g1' }] }, { group: ['g1', 'g2', 'g1'] }))).toEqual([
      '$.blocks[0].data.group: group "g2" is not listed in groups (1 unknown)',
    ]);
    expect(
      errors(
        scatter({
          axes: { x: { label: 'A', min: 5, max: 5 }, y: { label: 'B' }, z: { label: 'C' } },
        }),
      ),
    ).toEqual(['$.blocks[0].axes.x: min must be below max']);
  });

  it('caps a column at 20,000 points', () => {
    const big = Array.from({ length: 20001 }, (_, i) => i);
    const found = errors(scatter({}, { x: big, y: big, z: big }));
    expect(found.some((e) => e.includes('limit is 20000'))).toBe(true);
  });
});
