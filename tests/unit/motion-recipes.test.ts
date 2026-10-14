import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getMotionRecipe,
  MOTION_KEYFRAMES,
  MOTION_KEYFRAMES_NAMES,
  MOTION_RECIPES,
  motionPresetsFor,
  motionRecipeCss,
  specificMotionPresetsFor,
} from '../../src/motion/recipes.js';
import { describeMany } from '../../src/registry/describe-many.js';
import { blockTypes, buildPageSpecJsonSchema } from '../../src/registry/registry.js';
import { MOTION_ALLOWED, motionDiagnostics } from '../../src/render/motion.js';
import { compile } from '../../src/render/render.js';
import { buildRuntime } from '../../src/render/runtime.js';
import { validate } from '../../src/spec/validate.js';

const fixture = readFileSync(
  fileURLToPath(new URL('../../fixtures/pages/motion-recipes.yaml', import.meta.url)),
  'utf8',
);

const page = (block: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  version: 1,
  meta: { title: 'Motion' },
  ...extra,
  blocks: [block],
});

const errors = (spec: unknown) =>
  validate(spec).diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

describe('motion recipe registry', () => {
  it('has unique kebab-case ids and complete descriptors', () => {
    const ids = MOTION_RECIPES.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const recipe of MOTION_RECIPES) {
      expect(recipe.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/u);
      expect(recipe.version).toBeGreaterThanOrEqual(1);
      expect(recipe.purpose).not.toBe('');
      expect(recipe.reduced).not.toBe('');
      expect(recipe.triggers.length).toBeGreaterThan(0);
      for (const name of recipe.keyframes) expect(MOTION_KEYFRAMES[name]).toBeDefined();
    }
  });

  it('targets only real block types, never the page', () => {
    const types = new Set(blockTypes());
    for (const recipe of MOTION_RECIPES) {
      if (recipe.targets === '*') continue;
      for (const target of recipe.targets) expect(types.has(target)).toBe(true);
    }
    expect(motionPresetsFor('page')).toEqual([]);
  });

  it('looks up recipes by own id only', () => {
    expect(getMotionRecipe('dialog-pop')?.id).toBe('dialog-pop');
    expect(getMotionRecipe('constructor')).toBeUndefined();
    expect(getMotionRecipe('__proto__')).toBeUndefined();
  });

  it('compiles every example into a page that passes the motion checks', () => {
    for (const recipe of MOTION_RECIPES) {
      const extra = recipe.requires?.visibleWhen === true ? { state: { plan: 'annual' } } : {};
      const result = compile(page(recipe.example, extra));
      expect(result.html).toContain(`data-ak-motion="${recipe.id}"`);
    }
  });

  it('emits nothing for a page that uses no recipe', () => {
    expect(motionRecipeCss(new Set())).toBe('');
    const html = compile(page({ type: 'card', title: 'Plain' })).html;
    expect(html).not.toContain('data-ak-motion');
    expect(html).not.toContain('ak-m-');
  });

  it('puts every animating rule behind the motion guard and passes the diagnostics', () => {
    const css = motionRecipeCss(new Set(MOTION_RECIPES.map((recipe) => recipe.id)));
    expect(motionDiagnostics(css)).toEqual([]);
    const outside = css.replace(
      new RegExp(`@media ${escapeRegExp(MOTION_ALLOWED)}\\{.*\\}`, 'su'),
      '',
    );
    expect(outside).not.toMatch(/animation:|transition:/u);
  });

  it('emits each keyframes once, only for the recipes in use', () => {
    const css = motionRecipeCss(new Set(['reveal-soft', 'stagger']));
    expect(css.match(/@keyframes ak-m-rise\b/gu)).toHaveLength(1);
    expect(css).not.toContain('ak-m-pop-in');
    for (const name of MOTION_KEYFRAMES_NAMES) expect(name.startsWith('ak-m-')).toBe(true);
  });

  it('derives every scale step from the theme duration', () => {
    const css = motionRecipeCss(new Set(['reveal-soft']));
    for (const step of ['micro', 'fast', 'normal', 'relaxed', 'emphasis']) {
      expect(css).toMatch(
        new RegExp(`--ak-motion-${step}:(?:calc\\()?var\\(--ak-motion-duration\\)`, 'u'),
      );
    }
  });
});

describe('motion field validation', () => {
  it('accepts a recipe name or a preset object', () => {
    expect(errors(page({ type: 'card', title: 'A', motion: 'reveal-soft' }))).toEqual([]);
    expect(errors(page({ type: 'card', title: 'A', motion: { preset: 'reveal-soft' } }))).toEqual(
      [],
    );
  });

  it('rejects an unknown recipe and lists the compatible ones', () => {
    const [error] = errors(
      page({ type: 'tabs', items: [{ title: 'A' }, { title: 'B' }], motion: 'spin' }),
    );
    expect(error?.path).toBe('$.blocks[0].motion');
    expect(error?.message).toContain('tabs-slide');
  });

  it('rejects a recipe on a block it does not target', () => {
    const [error] = errors(page({ type: 'card', title: 'A', motion: { preset: 'dialog-pop' } }));
    expect(error?.path).toBe('$.blocks[0].motion.preset');
    expect(error?.message).toContain('does not apply to "card"');
  });

  it('refuses raw CSS, keyframes, timings or scripts', () => {
    const [error] = errors(
      page({
        type: 'card',
        title: 'A',
        motion: { preset: 'reveal-soft', css: 'animation: spin 1s', duration: '2s' },
      }),
    );
    expect(error?.path).toBe('$.blocks[0].motion.css');
    expect(
      errors(page({ type: 'card', title: 'A', motion: { keyframes: 'x' } })).map((e) => e.path),
    ).toEqual(['$.blocks[0].motion.keyframes', '$.blocks[0].motion.preset']);
  });

  it('rejects a motion value of the wrong type', () => {
    const [error] = errors(page({ type: 'card', title: 'A', motion: 3 }));
    expect(error?.path).toBe('$.blocks[0].motion');
  });

  it('requires visibleWhen for a state-change swap', () => {
    const [error] = errors(page({ type: 'card', title: 'A', motion: 'fade-swap' }));
    expect(error?.message).toContain('needs visibleWhen');
    expect(
      errors(
        page(
          {
            type: 'card',
            title: 'A',
            visibleWhen: { path: 'state.on', truthy: true },
            motion: 'fade-swap',
          },
          { state: { on: true } },
        ),
      ),
    ).toEqual([]);
  });
});

describe('motion in contracts and runtime', () => {
  it('describes the motion field in the JSON Schema of each compatible block', () => {
    const defs = buildPageSpecJsonSchema().$defs as Record<
      string,
      { properties: Record<string, unknown> }
    >;
    expect(JSON.stringify(defs['block-tabs']?.properties.motion)).toContain('tabs-slide');
    expect(defs['block-page']?.properties.motion).toBeUndefined();
  });

  it('lists type-specific recipes in compact descriptions', () => {
    const [tabs, divider] = describeMany(['tabs', 'divider'], { compact: true }) as {
      motion?: string[];
    }[];
    expect(tabs?.motion).toEqual(['tabs-slide']);
    expect(divider?.motion).toBeUndefined();
    expect(specificMotionPresetsFor('stats')).toEqual(['stagger', 'figure-roll']);
  });

  it('emits the lifecycle runtime only for recipes that need it', () => {
    const base = { features: new Set(['dialog', 'motion']), state: {}, hasBindings: false };
    const plain = buildRuntime({ ...base, motion: new Set(['reveal-soft']) });
    expect(plain).not.toContain('motionSettle');
    const exit = buildRuntime({ ...base, motion: new Set(['dialog-pop']) });
    expect(exit).toContain('motionSettle');
    expect(exit).toContain("addEventListener('cancel'");
    expect(buildRuntime({ ...base, motion: new Set() })).not.toContain('data-ak-leaving');
  });

  it('compiles the motion fixture deterministically', () => {
    const first = compile(fixture, { source: 'motion-recipes.yaml' });
    const second = compile(fixture, { source: 'motion-recipes.yaml' });
    expect(first.hash).toBe(second.hash);
    expect(first.features).toContain('motion');
    for (const recipe of MOTION_RECIPES)
      expect(first.html).toContain(`data-ak-motion="${recipe.id}"`);
  });

  it('keeps recipes off under a still theme policy', () => {
    const html = compile(fixture, {
      theme: { preset: 'editorial', tokens: { 'motion-policy': 'none' } },
    }).html;
    expect(html).toContain(`${MOTION_ALLOWED} and (prefers-reduced-motion:reduce)`);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
