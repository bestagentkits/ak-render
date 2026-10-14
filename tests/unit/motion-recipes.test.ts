import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { isRenderError, type RenderError } from '../../src/errors.js';
import { blockTypes, buildPageSpecJsonSchema } from '../../src/registry/registry.js';
import { motionDiagnostics } from '../../src/render/motion.js';
import {
  MOTION_RECIPES,
  MOTION_SCALE,
  motionPresetsFor,
  motionRecipeCss,
  motionRecipeDescriptors,
} from '../../src/render/motion-recipes.js';
import { compile } from '../../src/render/render.js';
import { validate } from '../../src/spec/validate.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));

const page = (blocks: string) => `version: 1
meta:
  title: Motion recipes
blocks:
${blocks}`;

const STATS = `  - type: stats
    motion: { preset: stagger }
    items: [{ label: Revenue, value: '$120K' }, { label: Users, value: '42' }]
`;

const errorsOf = (source: string) =>
  validate(source).diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

const styleOf = (html: string) => {
  const start = html.indexOf('>', html.indexOf('<style')) + 1;
  return html.slice(start, html.indexOf('</style>', start));
};

const scriptOf = (html: string) => {
  const open = html.lastIndexOf('<script');
  if (open < 0) return '';
  const start = html.indexOf('>', open) + 1;
  return html.slice(start, html.indexOf('</script>', start));
};

describe('motion recipe registry', () => {
  it('ships at least five first-party recipes with unique ids and real targets', () => {
    expect(MOTION_RECIPES.length).toBeGreaterThanOrEqual(5);
    const ids = MOTION_RECIPES.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(blockTypes());
    for (const recipe of MOTION_RECIPES) {
      expect(recipe.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/u);
      expect(recipe.targets.length).toBeGreaterThan(0);
      for (const target of recipe.targets) expect(known.has(target)).toBe(true);
    }
  });

  it('keeps every keyframe namespaced and defined by exactly one recipe', () => {
    const owners = new Map<string, string>();
    for (const recipe of MOTION_RECIPES) {
      for (const [, name] of recipe.css.matchAll(/@keyframes ([\w-]+)/gu)) {
        expect(name).toMatch(/^ak-m-/u);
        expect(owners.has(name ?? '')).toBe(false);
        owners.set(name ?? '', recipe.id);
      }
    }
  });

  it('exports compact, serializable descriptors for discovery', () => {
    const descriptors = motionRecipeDescriptors();
    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(
      MOTION_RECIPES.map((recipe) => recipe.id),
    );
    expect(JSON.parse(JSON.stringify(descriptors))).toEqual(descriptors);
    for (const descriptor of descriptors) {
      expect(Object.keys(descriptor)).not.toContain('css');
      expect(MOTION_SCALE[descriptor.duration]).toBeGreaterThan(0);
    }
  });

  it('offers none only to block types that accept a recipe', () => {
    expect(motionPresetsFor('hero')).toContain('reveal-soft');
    expect(motionPresetsFor('hero').at(-1)).toBe('none');
    expect(motionPresetsFor('spacer')).toEqual([]);
  });

  it('passes the motion diagnostics for every recipe and the scale', () => {
    const all = motionRecipeCss(new Set([...MOTION_RECIPES.map((recipe) => recipe.id), 'none']));
    expect(motionDiagnostics(all)).toEqual([]);
  });
});

describe('motion in the Page Spec', () => {
  it('adds a typed, closed motion property to compatible blocks in the JSON schema', () => {
    const schema = buildPageSpecJsonSchema() as {
      $defs: Record<string, { properties?: Record<string, unknown> }>;
    };
    const blocks = Object.values(schema.$defs).filter(
      (definition) => definition.properties?.type !== undefined,
    );
    const hero = blocks.find(
      (definition) =>
        (definition.properties?.type as { const?: string } | undefined)?.const === 'hero',
    );
    const spacer = blocks.find(
      (definition) =>
        (definition.properties?.type as { const?: string } | undefined)?.const === 'spacer',
    );
    expect(hero?.properties?.motion).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['preset'],
      properties: { preset: { enum: motionPresetsFor('hero') } },
      description: expect.any(String),
    });
    expect(spacer?.properties?.motion).toBeUndefined();
  });

  it('accepts a known preset and keeps specs without motion unchanged', () => {
    expect(errorsOf(page(STATS))).toEqual([]);
    const plain = page(`  - type: stats
    items: [{ label: Revenue, value: '$120K' }]
`);
    expect(errorsOf(plain)).toEqual([]);
    const html = compile(plain).html;
    expect(html).not.toMatch(/<[a-z]+[^>]* data-ak-motion=/u);
    expect(styleOf(html)).not.toContain('data-ak-motion');
    expect(html).not.toContain('ak-m-');
    expect(html).not.toContain('--ak-motion-micro');
  });

  it.each([
    [
      'an unknown preset',
      `  - type: hero
    title: Hi
    motion: { preset: confetti }
`,
      '$.blocks[0].motion.preset',
    ],
    [
      'a preset the block does not accept',
      `  - type: hero
    title: Hi
    motion: { preset: dialog-rise }
`,
      '$.blocks[0].motion.preset',
    ],
    [
      'a missing preset',
      `  - type: hero
    title: Hi
    motion: {}
`,
      '$.blocks[0].motion.preset',
    ],
    [
      'a raw duration override',
      `  - type: hero
    title: Hi
    motion: { preset: reveal-soft, duration: 9000 }
`,
      '$.blocks[0].motion.duration',
    ],
    [
      'raw CSS',
      `  - type: hero
    title: Hi
    motion: { preset: reveal-soft, css: 'animation: spin 1s' }
`,
      '$.blocks[0].motion.css',
    ],
    [
      'a non-object value',
      `  - type: hero
    title: Hi
    motion: reveal-soft
`,
      '$.blocks[0].motion',
    ],
    [
      'motion on a block that accepts none',
      `  - type: spacer
    motion: { preset: reveal-soft }
`,
      '$.blocks[0].motion',
    ],
  ])('rejects %s at its JSON path', (_label, blocks, path) => {
    const errors = errorsOf(page(blocks));
    expect(errors.map((error) => error.path)).toContain(path);
  });

  it('lists the accepted presets with every motion error', () => {
    const errors = errorsOf(
      page(`  - type: hero
    title: Hi
    motion: { preset: reveal-soft, duration: 9000 }
  - type: hero
    title: Hi
    motion: reveal-soft
`),
    );
    const motionErrors = errors.filter((diagnostic) => diagnostic.path?.includes('.motion'));
    expect(motionErrors).toHaveLength(2);
    for (const error of motionErrors) {
      expect(error.details?.known).toEqual(motionPresetsFor('hero'));
    }
  });

  it('warns when crossfade on a content block has no visibleWhen to reveal it', () => {
    const warnings = (source: string) =>
      validate(source).diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
    expect(
      warnings(
        page(`  - type: callout
    title: Static
    text: Never changes.
    motion: { preset: crossfade }
`),
      ).map((diagnostic) => diagnostic.path),
    ).toContain('$.blocks[0].motion.preset');
    const tabs = page(`  - type: tabs
    motion: { preset: crossfade }
    items: [{ title: A, text: a }, { title: B, text: b }]
`);
    expect(warnings(tabs).map((diagnostic) => diagnostic.path)).not.toContain(
      '$.blocks[0].motion.preset',
    );
  });

  it('reports the accepted presets with an unknown one', () => {
    try {
      compile(
        page(`  - type: stats
    motion: { preset: tab-indicator }
    items: [{ label: A, value: '1' }]
`),
      );
      expect.unreachable();
    } catch (error) {
      expect(isRenderError(error)).toBe(true);
      expect((error as RenderError).path).toBe('$.blocks[0].motion.preset');
      expect(JSON.stringify((error as RenderError).details)).toContain('number-tick');
    }
  });
});

describe('motion emission', () => {
  it('marks the block root and emits each used recipe once', () => {
    const html = compile(page(`${STATS}${STATS}`)).html;
    expect(html.match(/<section[^>]*data-ak-motion="stagger"/gu)).toHaveLength(2);
    const css = styleOf(html);
    expect(css.match(/@keyframes ak-m-item-in\b/gu)).toHaveLength(1);
    expect(css.match(/--ak-motion-micro:/gu)).toHaveLength(1);
    expect(css).not.toContain('ak-m-reveal');
    expect(motionDiagnostics(css)).toEqual([]);
  });

  it('emits no runtime for a page whose recipes need none', () => {
    const html = compile(
      page(`  - type: callout
    title: Static
    text: Nothing moves here.
`),
      { themeToggle: false },
    ).html;
    expect(scriptOf(html)).toBe('');
    const accordion = compile(
      page(`  - type: accordion
    motion: { preset: accordion-expand }
    items: [{ title: A, text: a }]
`),
      { themeToggle: false },
    ).html;
    expect(styleOf(accordion)).toContain('interpolate-size');
    for (const part of [
      'wireMotionEnter',
      'wireTabIndicators',
      'wireCrossfade',
      'wireDialogMotion',
    ]) {
      expect(accordion).not.toContain(part);
    }
  });

  it('adds only the runtime parts a page uses', () => {
    const reveal = compile(
      page(`  - type: hero
    title: Hi
    motion: { preset: reveal-soft }
`),
      { themeToggle: false },
    ).html;
    const script = scriptOf(reveal);
    expect(script).toContain('wireMotionEnter();');
    expect(script).not.toContain('wireTabIndicators');
    expect(script).not.toContain('wireDialogMotion');

    const dialog = compile(
      page(`  - type: dialog
    id: d
    title: D
    motion: { preset: dialog-rise }
`),
    ).html;
    expect(scriptOf(dialog)).toContain('wireDialogMotion();');
    expect(scriptOf(dialog)).not.toContain('wireMotionEnter');
  });

  it('turns built-in motion off with preset none', () => {
    const html = compile(
      page(`  - type: kpi
    motion: { preset: none }
    items: [{ label: A, value: '12' }]
`),
    ).html;
    expect(html).toMatch(/<section[^>]*data-ak-motion="none"/u);
    const css = styleOf(html);
    expect(css).toContain('[data-ak-motion="none"]::before');
    expect(css).toContain('[data-ak-motion="none"]::backdrop');
    // The scroll shades are spared, and only for boxes this page styles.
    expect(css).toContain(',.ak-table-wrap)');
    // A nested block with its own preset keeps it, along with its contents.
    expect(css).toContain(
      '[data-ak-motion="none"] *:not([data-ak-motion="none"] [data-ak-motion]:not([data-ak-motion="none"]),[data-ak-motion="none"] [data-ak-motion]:not([data-ak-motion="none"]) *',
    );
    expect(css).not.toContain('ak-diagram-rendered');
    expect(motionDiagnostics(css)).toEqual([]);
  });

  it('is deterministic', () => {
    const source = page(`${STATS}  - type: tabs
    motion: { preset: tab-indicator }
    items: [{ title: A, text: a }, { title: B, text: b }]
`);
    expect(compile(source).html).toBe(compile(source).html);
  });

  it('obeys the theme policy: the guard never matches under reduced or none', () => {
    for (const policy of ['reduced', 'none']) {
      const css = styleOf(
        compile(page(STATS), {
          theme: { preset: 'editorial', tokens: { 'motion-policy': policy } },
        }).html,
      );
      expect(css).not.toMatch(/@media \(prefers-reduced-motion:no-preference\)\{/u);
      expect(motionDiagnostics(css)).toEqual([]);
    }
  });

  it('lands on the root of every target block found in the fixtures', () => {
    const covered = new Set<string>();
    for (const file of readdirSync(pagesDir).filter((name) => name.endsWith('.yaml'))) {
      const spec = parse(readFileSync(`${pagesDir}/${file}`, 'utf8')) as Record<string, unknown>;
      let marked = 0;
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
          for (const item of value) visit(item);
          return;
        }
        if (value === null || typeof value !== 'object') return;
        const node = value as Record<string, unknown>;
        if (typeof node.type === 'string') {
          const preset = motionPresetsFor(node.type)[0];
          if (node.motion !== undefined) marked += 1;
          else if (preset !== undefined) {
            node.motion = { preset };
            covered.add(node.type);
            marked += 1;
          }
        }
        for (const child of Object.values(node)) visit(child);
      };
      visit(spec.blocks);
      const html = compile(spec, { source: file }).html;
      const body = html.slice(html.indexOf('<body'));
      expect(body.match(/ data-ak-motion="/gu)?.length ?? 0, file).toBe(marked);
    }
    const targets = new Set(MOTION_RECIPES.flatMap((recipe) => recipe.targets));
    expect([...targets].filter((type) => !covered.has(type))).toEqual([]);
  });
});
