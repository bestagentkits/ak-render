import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { particleParams } from '../../src/blocks/three/particles-3d.js';
import {
  CPU_PARTICLE_CAP,
  densityGain,
  drawnAt,
  FRAME_BUDGET_MS,
  FRAME_WINDOW,
  frameBaseline,
  MAX_LEVEL,
  MAX_PARTICLES,
  nextLevel,
  PARTICLE_PRESETS,
  POSTER_TIME,
  PRESET_DEFAULTS,
  particleAt,
  particleVertexShader,
  spawnParticles,
} from '../../src/blocks/three/particles-sim.js';
import { catalog } from '../../src/registry/registry.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url), 'utf8');

function spec(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Particles' },
    blocks: [{ type: 'particles-3d', id: 'p', summary: 'A seeded cloud.', ...extra }],
  };
}

function errors(input: unknown) {
  return normalizeSpec(input)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.path}: ${d.message}`);
}

function params(extra: Record<string, unknown> = {}) {
  const node = normalizeSpec(spec(extra)).ir?.nodes.find((n) => n.type === 'particles-3d');
  if (!node) throw new Error('no node');
  return particleParams(node);
}

describe('particles-3d params', () => {
  it('takes every setting from the preset when the spec names only the preset', () => {
    for (const preset of PARTICLE_PRESETS) {
      const resolved = params({ preset });
      expect(resolved).toMatchObject({ ...PRESET_DEFAULTS[preset], preset, seed: 1, speed: 1 });
    }
  });

  it('lets the spec replace shape, fields, colors, size, count and seed', () => {
    const resolved = params({
      preset: 'fountain',
      shape: 'sphere',
      fields: ['wind', 'gravity'],
      colors: ['info', 'success'],
      size: 'grow',
      count: 3000,
      seed: 42,
      speed: 0.5,
    });
    // Fields apply in their fixed order whatever order the spec lists them in.
    expect(resolved).toMatchObject({
      shape: 'sphere',
      fields: ['gravity', 'wind'],
      colors: ['info', 'success'],
      size: 'grow',
      count: 3000,
      seed: 42,
      speed: 0.5,
    });
  });

  it('rejects counts past the budget, unknown presets and repeated fields', () => {
    expect(errors(spec({ count: MAX_PARTICLES + 1 }))).toHaveLength(1);
    expect(errors(spec({ count: 10 }))).toHaveLength(1);
    expect(errors(spec({ preset: 'fireworks' }))).toHaveLength(1);
    expect(errors(spec({ fields: ['noise', 'noise'] }))).toEqual([
      expect.stringContaining('field "noise" is listed twice'),
    ]);
    expect(
      errors(spec({ colors: ['accent', 'info', 'danger', 'success', 'warning'] })),
    ).toHaveLength(1);
    expect(errors(spec({ preset: 'nebula', seed: 9, count: 500 }))).toEqual([]);
  });
});

describe('particles-3d simulation', () => {
  const galaxy = { ...PRESET_DEFAULTS.galaxy, preset: 'galaxy' as const, seed: 5, speed: 1 };

  it('repeats exactly for one seed and differs for another', () => {
    const a = spawnParticles(galaxy, 500);
    const b = spawnParticles(galaxy, 500);
    const c = spawnParticles({ ...galaxy, seed: 6 }, 500);
    expect(a.position).toEqual(b.position);
    expect(a.extra).toEqual(b.extra);
    expect(a.position).not.toEqual(c.position);
  });

  it('computes any frame directly from the clock, without stepping', () => {
    const spawn = spawnParticles(galaxy, 10);
    const first: number[] = [];
    const again: number[] = [];
    particleAt(galaxy, spawn, 3, POSTER_TIME, first);
    particleAt(galaxy, spawn, 3, 1, again);
    particleAt(galaxy, spawn, 3, POSTER_TIME, again);
    expect(again).toEqual(first);
    expect(first).toHaveLength(7);
    for (const value of first) expect(Number.isFinite(value)).toBe(true);
  });

  it('keeps the galaxy arms over minutes of motion', () => {
    // Arm strength: how unevenly the stars fill angular bins, within rings across the disc.
    const armStrength = (t: number) => {
      const spawn = spawnParticles(galaxy, 4000);
      const out: number[] = [];
      const bins = Array.from({ length: 4 }, () => new Array<number>(24).fill(0));
      for (let i = 0; i < 4000; i += 1) {
        particleAt(galaxy, spawn, i, t, out);
        const r = Math.hypot(out[0] ?? 0, out[2] ?? 0) / galaxy.radius;
        if (r < 0.2 || r >= 1) continue;
        const ring = Math.min(3, Math.floor((r - 0.2) / 0.2));
        const angle = Math.atan2(out[2] ?? 0, out[0] ?? 0) + Math.PI;
        const bin = Math.min(23, Math.floor((angle / (2 * Math.PI)) * 24));
        (bins[ring] as number[])[bin] = ((bins[ring] as number[])[bin] ?? 0) + 1;
      }
      return (
        bins.reduce((sum, ring) => {
          const mean = ring.reduce((a, b) => a + b, 0) / ring.length;
          const sd = Math.sqrt(ring.reduce((a, b) => a + (b - mean) ** 2, 0) / ring.length);
          return sum + sd / (mean || 1);
        }, 0) / bins.length
      );
    };
    expect(armStrength(600)).toBeGreaterThan(armStrength(POSTER_TIME) * 0.8);
  });

  it('fades flow particles in and out so a respawn never pops', () => {
    const fountain = {
      ...PRESET_DEFAULTS.fountain,
      preset: 'fountain' as const,
      seed: 1,
      speed: 1,
    };
    const spawn = spawnParticles(fountain, 200);
    const out: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      particleAt(fountain, spawn, i, POSTER_TIME, out);
      const [age = 0, , , alpha = 0] = out.slice(3);
      if (age < 0.01 || age > 0.99) expect(alpha).toBeLessThan(0.05);
    }
  });

  it('pulls a fountain back down under gravity', () => {
    const fountain = {
      ...PRESET_DEFAULTS.fountain,
      preset: 'fountain' as const,
      seed: 1,
      speed: 1,
    };
    const spawn = spawnParticles(fountain, 400);
    const out: number[] = [];
    let falling = 0;
    for (let i = 0; i < 400; i += 1) {
      particleAt(fountain, spawn, i, POSTER_TIME, out);
      if ((out[3] ?? 0) > 0.8 && (out[1] ?? 0) < 1) falling += 1;
    }
    expect(falling).toBeGreaterThan(20);
  });

  it('builds the vertex shader only from fixed defines', () => {
    const shader = particleVertexShader({ ...galaxy, fields: ['noise', 'swirl'] }, false);
    expect(shader).toContain('#define AK_NOISE');
    expect(shader).toContain('#define AK_SWIRL');
    expect(shader).not.toContain('#define AK_CPU');
    expect(particleVertexShader(galaxy, true)).toContain('#define AK_CPU');
  });
});

describe('particles-3d adaptive quality', () => {
  const slow = Array.from({ length: FRAME_WINDOW }, () => FRAME_BUDGET_MS + 10);
  const fast = Array.from({ length: FRAME_WINDOW }, () => 16.7);

  it('steps down only after a full window of slow frames, and never back up', () => {
    expect(nextLevel(slow.slice(1), 0)).toBe(0);
    expect(nextLevel(fast, 0)).toBe(0);
    expect(nextLevel(slow, 0)).toBe(1);
    expect(nextLevel(fast, 2)).toBe(2);
    expect(nextLevel(slow, MAX_LEVEL)).toBe(MAX_LEVEL);
  });

  it('judges frames against the display, so a 30 Hz screen at its own pace stays put', () => {
    const thirty = Array.from({ length: FRAME_WINDOW }, () => 33.4);
    const baseline = frameBaseline(Array.from({ length: FRAME_WINDOW }, () => 33.3));
    expect(nextLevel(thirty, 0, baseline)).toBe(0);
    expect(
      nextLevel(
        Array.from({ length: FRAME_WINDOW }, () => 60),
        0,
        baseline,
      ),
    ).toBe(1);
    // A baseline is a real refresh rate, so a device slow from its first frame cannot teach itself a slow pace.
    const steady40 = Array.from({ length: FRAME_WINDOW }, () => 40);
    expect(frameBaseline(steady40)).toBe(16.7);
    expect(nextLevel(steady40, 0, frameBaseline(steady40))).toBe(1);
    expect(frameBaseline(Array.from({ length: FRAME_WINDOW }, () => 8.4))).toBe(8.3);
  });

  it('gives fewer sprites more light, and a dark stage less', () => {
    expect(densityGain(1000)).toBeGreaterThan(densityGain(8000));
    expect(densityGain(8000, true)).toBeLessThan(densityGain(8000));
  });

  it('halves the drawn particles per level within the bounds', () => {
    expect(drawnAt(8000, 0)).toBe(8000);
    expect(drawnAt(8000, 1)).toBe(4000);
    expect(drawnAt(8000, MAX_LEVEL)).toBe(1000);
    expect(drawnAt(100, MAX_LEVEL)).toBe(64);
    expect(CPU_PARTICLE_CAP).toBeLessThan(MAX_PARTICLES);
  });
});

describe('particles-3d output', () => {
  it('compiles to identical bytes, with a poster of the poster-time frame', () => {
    const source = fixture('particles-3d-galaxy');
    const first = compile(source, { source: 'galaxy' }).html;
    expect(compile(source, { source: 'galaxy' }).html).toBe(first);
    expect(first).toContain('data-ak-3d="particles"');
    expect(first).toContain('class="ak-3d-poster ak-pt-poster"');
    expect((first.match(/<circle /gu) ?? []).length).toBeGreaterThan(1000);
    expect(first).toContain('Galaxy · 9,000 particles · seed 7');
  });

  it('draws a different poster for a different seed', () => {
    const poster = (seed: number) =>
      compile(JSON.stringify(spec({ preset: 'nebula', seed, count: 400 })), { source: 's' })
        .html.split('<svg class="ak-3d-poster')[1]
        ?.split('</svg>')[0];
    expect(poster(1)).toBe(poster(1));
    expect(poster(1)).not.toBe(poster(2));
  });

  it('is listed in the catalog 3d family', () => {
    const family = catalog().families.find((entry) => entry.name === '3d');
    expect(family?.types).toContain('particles-3d');
  });
});
