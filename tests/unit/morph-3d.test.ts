import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { FLOOR_Y } from '../../src/blocks/three/morph-3d.js';
import {
  buildMorph,
  CLOSED_SHAPES,
  ease,
  LIVE_DETAIL,
  MorphTimeline,
  morphGrid,
  POSTER_DETAIL,
  RING_SHAPES,
  shapePositions,
  signedVolume,
  topologyBreak,
} from '../../src/blocks/three/morph-sim.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const FIXTURE = readFileSync(
  new URL('../../fixtures/3d/morph-3d-shapes.yaml', import.meta.url),
  'utf8',
);
/** Compiling inlines the 700 kB 3D runtime; Windows CI runners need far more than the 5 s default. */
const SLOW = 30_000;

function spec(block: Record<string, unknown>, state: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Morph' },
    state,
    blocks: [{ type: 'morph-3d', id: 'm', summary: 'A morph.', ...block }],
  };
}

const three = [
  { id: 'a', shape: 'sphere' },
  { id: 'b', shape: 'cube', tone: 'info' },
  { id: 'c', shape: 'star', tone: 'warning' },
];

function errors(input: unknown) {
  return normalizeSpec(input)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.path}: ${d.message}`);
}

interface MorphConfig {
  objects: { id: string }[];
  morph: {
    targets: { id: string; shape: string; tone: string }[];
    topology: string;
    initial: number;
    easing: string;
    duration: number;
    hold: number;
    mode: string;
    bind?: string;
  };
}

function sceneOf(html: string): MorphConfig {
  const match = /data-ak-scene="([^"]*)"/u.exec(html);
  const raw = (match?.[1] ?? '{}')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  return JSON.parse(raw);
}

describe('morph-3d contract', () => {
  it(
    'compiles the fixture byte-identically three times with the 3D runtime',
    () => {
      const runs = [0, 1, 2].map(() => compile(FIXTURE, { source: 'morph' }).html);
      expect(runs[1]).toBe(runs[0]);
      expect(runs[2]).toBe(runs[0]);
      expect(runs[0]).toContain('data-ak-3d="morph"');
      expect(runs[0]).toContain('__akThree');
    },
    SLOW,
  );

  it(
    'renders three targets as buttons with drawings, a poster and the timeline settings',
    () => {
      const html = compile(FIXTURE, { source: 'morph' }).html;
      expect(html.match(/data-ak-morph-target="/gu)?.length).toBe(3);
      expect(html.match(/class="ak-mo-glyph"/gu)?.length).toBe(3);
      expect(html.match(/<svg class="ak-3d-poster ak-mo-poster"/gu)?.length).toBe(1);
      expect(html).toContain('<span class="ak-mo-meta">Sphere → Cube → Star</span>');
      const { morph, objects } = sceneOf(html);
      expect(morph.targets.map((t) => t.shape)).toEqual(['sphere', 'cube', 'star']);
      expect(morph).toMatchObject({
        topology: 'closed',
        initial: 0,
        easing: 'spring',
        duration: 1400,
        mode: 'loop',
        bind: 'state.shape',
      });
      expect(morph.hold).toBeGreaterThanOrEqual(1400);
      expect(objects).toEqual([{ id: 'morph', shape: 'sphere', size: -FLOOR_Y * 2 }]);
    },
    SLOW,
  );

  it(
    'starts on the target the bound state names, in the poster and the first frame',
    () => {
      const doc = parse(FIXTURE) as { state: Record<string, unknown> };
      const html = compile({ ...doc, state: { shape: 'star' } } as never).html;
      expect(sceneOf(html).morph.initial).toBe(2);
      expect(html).toContain('data-ak-morph-current="star"');
      expect(html).toMatch(/data-ak-morph-target="star" aria-pressed="true"/u);
      expect(html).toMatch(
        /<g id="ak-mo-faces-morph" class="ak-3d-mark ak-mo-surface" data-tone="warning">/u,
      );
      // An unknown value falls back to the first target.
      const fallback = compile({ ...doc, state: { shape: 'nope' } } as never).html;
      expect(sceneOf(fallback).morph.initial).toBe(0);
    },
    SLOW,
  );

  it('rejects a ring among closed targets with an explicit invalid-topology error', () => {
    const found = errors(
      spec({
        targets: [
          { id: 'a', shape: 'sphere' },
          { id: 'b', shape: 'cube' },
          { id: 'c', shape: 'torus' },
        ],
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('$.blocks[0].targets[2].shape');
    expect(found[0]).toContain('invalid topology');
    expect(found[0]).toContain('"torus" is a ring (genus 1)');
    expect(() =>
      compile(
        spec({
          targets: [
            { id: 'a', shape: 'knot' },
            { id: 'b', shape: 'gem' },
          ],
        }),
      ),
    ).toThrow(/invalid topology/u);
    // The same three targets as rings are fine.
    expect(
      errors(
        spec({
          targets: RING_SHAPES.map((shape) => ({ id: shape, shape })),
        }),
      ),
    ).toEqual([]);
  });

  it('rejects duplicate target ids, too few targets and unknown shapes', () => {
    expect(
      errors(
        spec({
          targets: [
            { id: 'a', shape: 'sphere' },
            { id: 'a', shape: 'cube' },
          ],
        }),
      ),
    ).toEqual(['$.blocks[0].targets[1].id: target id "a" is used twice']);
    expect(errors(spec({ targets: [{ id: 'a', shape: 'sphere' }] })).length).toBeGreaterThan(0);
    expect(
      errors(
        spec({
          targets: [
            { id: 'a', shape: 'sphere' },
            { id: 'b', shape: 'teapot' },
          ],
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(errors(spec({ targets: three }))).toEqual([]);
  });
});

describe('morph-3d geometry', () => {
  it('samples every target of one topology on the same grid, outward and in frame', () => {
    for (const [shapes, topology] of [
      [CLOSED_SHAPES, 'closed'],
      [RING_SHAPES, 'ring'],
    ] as const) {
      const grid = morphGrid(topology, LIVE_DETAIL);
      for (const shape of shapes) {
        const positions = shapePositions(shape, grid);
        expect(positions.length).toBe(grid.vertexCount * 3);
        expect(signedVolume(positions, grid.quads), shape).toBeGreaterThan(0);
        let radius = 0;
        let low = 0;
        for (let i = 0; i < positions.length; i += 3) {
          const [x, y, z] = [positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0];
          expect(Number.isFinite(x + y + z)).toBe(true);
          radius = Math.max(radius, Math.hypot(x, y, z));
          low = Math.min(low, y);
        }
        expect(radius, shape).toBeLessThanOrEqual(1.3);
        expect(low, shape).toBeGreaterThanOrEqual(FLOOR_Y);
      }
    }
  });

  it('welds the closed grid into one seamless surface (Euler characteristic 2)', () => {
    const grid = morphGrid('closed', POSTER_DETAIL);
    const edges = new Set<string>();
    for (let q = 0; q < grid.quads.length; q += 4)
      for (let k = 0; k < 4; k += 1) {
        const a = grid.quads[q + k] as number;
        const b = grid.quads[q + ((k + 1) % 4)] as number;
        edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
      }
    const faces = grid.quads.length / 4;
    expect(grid.vertexCount - edges.size + faces).toBe(2);
    const ring = morphGrid('ring', POSTER_DETAIL);
    const ringEdges = new Set<string>();
    for (let q = 0; q < ring.quads.length; q += 4)
      for (let k = 0; k < 4; k += 1) {
        const a = ring.quads[q + k] as number;
        const b = ring.quads[q + ((k + 1) % 4)] as number;
        ringEdges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
      }
    // A torus has Euler characteristic 0.
    expect(ring.vertexCount - ringEdges.size + ring.quads.length / 4).toBe(0);
  });

  it('builds three targets with one vertex count and refuses mixed topologies', () => {
    const built = buildMorph(['sphere', 'cube', 'star'], LIVE_DETAIL);
    expect(built.targets).toHaveLength(3);
    expect(new Set(built.targets.map((t) => t.length)).size).toBe(1);
    expect(topologyBreak(['sphere', 'cube', 'star'])).toBe(-1);
    expect(topologyBreak(['torus', 'knot', 'sphere'])).toBe(2);
    expect(() => buildMorph(['sphere', 'torus'], LIVE_DETAIL)).toThrow(/different topology/u);
  });
});

describe('morph-3d timeline', () => {
  const sum = (w: readonly number[]) => w.reduce((s, v) => s + v, 0);

  it('eases from 0 to 1 on every curve, and the spring overshoots', () => {
    for (const name of ['smooth', 'spring', 'snap', 'linear']) {
      expect(ease(name, 0)).toBe(0);
      expect(ease(name, 1)).toBe(1);
    }
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => ease('spring', i / 50)));
    expect(peak).toBeGreaterThan(1.1);
  });

  it('plays 100 looping transitions across three targets, landing exactly on each', () => {
    const timeline = new MorphTimeline(3, 0, {
      duration: 400,
      hold: 200,
      easing: 'spring',
      mode: 'loop',
    });
    const landings: number[] = [];
    let landed = 0;
    for (let now = 0; landed < 100; now += 16) {
      timeline.step(now);
      expect(sum(timeline.weights)).toBeCloseTo(1, 9);
      if (timeline.landed > landed) {
        landed = timeline.landed;
        landings.push(timeline.target);
        expect(timeline.weights).toEqual([0, 1, 2].map((i) => (i === timeline.target ? 1 : 0)));
      }
      expect(now).toBeLessThan(200_000);
    }
    expect(landings).toHaveLength(100);
    expect(landings.slice(0, 6)).toEqual([1, 2, 0, 1, 2, 0]);
    expect(timeline.playing).toBe(true);
  });

  it('turns smoothly when 100 choices arrive mid-morph, and lands on the last', () => {
    const timeline = new MorphTimeline(3, 0, {
      duration: 500,
      hold: 0,
      easing: 'smooth',
      mode: 'manual',
    });
    let now = 0;
    for (let i = 1; i <= 100; i += 1) {
      timeline.step(now);
      const before = [...timeline.weights];
      timeline.goTo(i % 3);
      // The new morph starts from the blend on screen: no jump on the frame it begins.
      timeline.step(now);
      timeline.weights.forEach((w, k) => {
        expect(w).toBeCloseTo(before[k] ?? 0, 9);
      });
      expect(sum(timeline.weights)).toBeCloseTo(1, 9);
      now += 120;
    }
    while (timeline.step(now)) now += 16;
    expect(timeline.target).toBe(100 % 3);
    expect(timeline.weights).toEqual([0, 1, 0]);
  });

  it('plays once through to the last target and stops; manual never moves by itself', () => {
    const once = new MorphTimeline(3, 0, {
      duration: 100,
      hold: 100,
      easing: 'linear',
      mode: 'once',
    });
    let now = 0;
    while (once.step(now) && now < 10_000) now += 10;
    expect(once.target).toBe(2);
    expect(once.landed).toBe(2);
    expect(once.playing).toBe(false);
    const manual = new MorphTimeline(3, 1, {
      duration: 100,
      hold: 100,
      easing: 'linear',
      mode: 'manual',
    });
    expect(manual.step(5_000)).toBe(false);
    expect(manual.target).toBe(1);
    expect(manual.goTo(1)).toBe(false);
    expect(manual.goTo(7)).toBe(false);
  });
});
