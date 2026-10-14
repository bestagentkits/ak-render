import { describe, expect, it } from 'vitest';
import { isRenderError } from '../../src/errors.js';
import {
  describeMotion,
  MOTION_SEARCH_LIMITS,
  motionCatalog,
  searchMotions,
} from '../../src/motion/motion-catalog.js';
import { MOTION_DURATION_SCALE, MOTION_RECIPES } from '../../src/motion/recipes.js';

const COMPACT_FIELDS = ['blocks', 'example', 'id', 'purpose', 'reduced', 'triggers'];

describe('motion catalog', () => {
  it('counts every registry recipe and lists them in registry order', () => {
    const listing = motionCatalog();
    expect(listing.recipeCount).toBe(MOTION_RECIPES.length);
    expect(listing.recipes.map((entry) => entry.id)).toEqual(
      MOTION_RECIPES.map((recipe) => recipe.id),
    );
  });

  it('projects each entry from its recipe and marks lifecycle recipes as scripted', () => {
    const listing = motionCatalog();
    for (const entry of listing.recipes) {
      const recipe = MOTION_RECIPES.find((candidate) => candidate.id === entry.id);
      expect(recipe).toBeDefined();
      expect(entry.purpose).toBe(recipe?.purpose);
      expect(entry.triggers).toEqual(recipe?.triggers);
      expect(entry.script).toBe(recipe?.runtime === 'lifecycle');
    }
    expect(listing.recipes.find((entry) => entry.id === 'tabs-slide')?.script).toBe(true);
    expect(listing.recipes.find((entry) => entry.id === 'reveal-soft')?.script).toBe(false);
    expect(listing.recipes.find((entry) => entry.id === 'fade-swap')?.blocks).toBe('*');
  });

  it('never exposes compiler CSS, keyframes or runtime selectors in any description', () => {
    const outputs = [
      JSON.stringify(motionCatalog()),
      ...MOTION_RECIPES.flatMap((recipe) => [
        JSON.stringify(describeMotion(recipe.id)),
        JSON.stringify(describeMotion(recipe.id, { compact: true })),
      ]),
    ];
    for (const json of outputs) {
      expect(json).not.toContain('guarded');
      expect(json).not.toContain('@keyframes');
      expect(json).not.toContain('data-ak-motion=');
      for (const recipe of MOTION_RECIPES) {
        expect(json).not.toContain(recipe.css.guarded);
        if (recipe.css.plain !== undefined) expect(json).not.toContain(recipe.css.plain);
      }
    }
  });
});

describe('motion search', () => {
  it('ranks the tabs recipe first for an intent phrase', () => {
    const hits = searchMotions('smooth tabs');
    expect(hits[0]?.id).toBe('tabs-slide');
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it('returns the same hits in the same order for the same query', () => {
    expect(searchMotions('reveal entrance')).toEqual(searchMotions('reveal entrance'));
    expect(searchMotions('stats numbers', 3)).toEqual(searchMotions('stats numbers', 3));
  });

  it('returns no hits for words no recipe carries', () => {
    expect(searchMotions('zzqxv plorf')).toEqual([]);
    expect(searchMotions('the and of')).toEqual([]);
  });

  it('caps hits at the default count and honours an explicit limit', () => {
    expect(searchMotions('block').length).toBeLessThanOrEqual(MOTION_SEARCH_LIMITS.defaultHits);
    expect(searchMotions('block', 1).length).toBeLessThanOrEqual(1);
    for (const hit of searchMotions('motion', MOTION_SEARCH_LIMITS.maxHits)) {
      expect(MOTION_RECIPES.map((recipe) => recipe.id)).toContain(hit.id);
    }
  });

  it('accepts the limit bounds and rejects values outside them with SPEC_VALIDATION_ERROR', () => {
    expect(() => searchMotions('tabs', 1)).not.toThrow();
    expect(() => searchMotions('tabs', MOTION_SEARCH_LIMITS.maxHits)).not.toThrow();
    for (const limit of [0, MOTION_SEARCH_LIMITS.maxHits + 1, 1.5, Number.NaN]) {
      let caught: unknown;
      try {
        searchMotions('tabs', limit);
      } catch (error) {
        caught = error;
      }
      expect(isRenderError(caught), String(limit)).toBe(true);
      expect((caught as { code: string }).code).toBe('SPEC_VALIDATION_ERROR');
    }
  });
});

describe('motion describe', () => {
  it('returns only the authoring fields in compact form', () => {
    const compact = describeMotion('tabs-slide', { compact: true });
    expect(Object.keys(compact).sort()).toEqual(COMPACT_FIELDS);
  });

  it('adds the full registry fields, minus CSS, in the default form', () => {
    const full: Record<string, unknown> = { ...describeMotion('tabs-slide') };
    const compact = describeMotion('tabs-slide', { compact: true });
    expect(Object.keys(full)).toEqual(expect.arrayContaining(Object.keys(compact)));
    for (const key of ['version', 'aliases', 'phases', 'states', 'role', 'duration', 'easing']) {
      expect(full).toHaveProperty(key);
    }
    expect(full).toHaveProperty('durationMs');
    expect(full).toHaveProperty('keyframes');
    expect(full).toHaveProperty('notes');
    expect(Object.keys(full)).not.toContain('css');
  });

  it('computes durationMs from the duration step at the default theme motion duration', () => {
    for (const recipe of MOTION_RECIPES) {
      const full = describeMotion(recipe.id) as { durationMs: number; duration: string };
      expect(full.durationMs).toBe(160 * MOTION_DURATION_SCALE[recipe.duration]);
    }
  });

  it('reports the requirement only for a recipe that has one', () => {
    expect(describeMotion('fade-swap', { compact: true })).toMatchObject({
      requires: { visibleWhen: true },
    });
    expect(describeMotion('reveal-soft', { compact: true })).not.toHaveProperty('requires');
  });

  it('throws an unknown id as SPEC_VALIDATION_ERROR with suggestions and every known id', () => {
    let caught: unknown;
    try {
      describeMotion('tabs-sloe');
    } catch (error) {
      caught = error;
    }
    expect(isRenderError(caught)).toBe(true);
    const error = caught as { code: string; details: Record<string, unknown>; path: string };
    expect(error.code).toBe('SPEC_VALIDATION_ERROR');
    expect(error.path).toBe('id');
    expect(error.details['id']).toBe('tabs-sloe');
    expect(error.details['suggestions']).toContain('tabs-slide');
    expect(error.details['known']).toEqual(MOTION_RECIPES.map((recipe) => recipe.id));
  });

  it('hands out a copy of the example, so editing it leaves the registry untouched', () => {
    const before = JSON.stringify(describeMotion('reveal-soft', { compact: true }).example);
    const handed = describeMotion('reveal-soft', { compact: true }).example;
    handed['type'] = 'mutated';
    delete handed['motion'];
    expect(JSON.stringify(describeMotion('reveal-soft', { compact: true }).example)).toBe(before);
  });
});
