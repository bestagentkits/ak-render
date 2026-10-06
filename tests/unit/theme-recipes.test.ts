import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRenderError, type RenderError } from '../../src/index.js';
import { RECIPE_CSS, recipeCss } from '../../src/render/recipe-styles.js';
import { compile } from '../../src/render/render.js';
import { loadTheme, themePresetNames } from '../../src/theme/load-theme.js';
import { THEME_RECIPE_SPECS, THEME_RECIPE_SURFACES } from '../../src/theme/recipes.js';
import { builtinThemeCatalog, parsePresetDocument } from '../../src/theme/theme-catalog.js';

const DIALECTS = readFileSync(
  new URL('../../fixtures/pages/theme-dialects.yaml', import.meta.url),
  'utf8',
);

/** A page that uses every surface a recipe restyles. */
function page(theme: string): string {
  return `version: 1
meta:
  title: Recipe page
${theme}
blocks:
  - type: hero
    title: Recipe page
    description: Every recipe surface on one page.
  - type: section
    title: Numbers
    blocks:
      - type: stats
        items:
          - label: Rows
            value: '42'
      - type: table
        columns: [Name, Count]
        rows:
          - [alpha, '1']
          - [beta, '2']
  - type: callout
    tone: info
    title: Note
    text: A note.
  - type: card
    title: A card
    text: Card text.
`;
}

const CHART_BLOCK = `  - type: chart
    kind: bar
    title: Counts
    labels: [a, b]
    series:
      - label: Count
        values: [1, 2]
`;

function captureError(run: () => unknown): RenderError {
  try {
    run();
  } catch (error) {
    if (isRenderError(error)) return error;
    throw error;
  }
  throw new Error('expected a RenderError');
}

function htmlTag(html: string): string {
  return html.match(/<html[^>]*>/u)?.[0] ?? '';
}

describe('recipe resolution', () => {
  it('fills every surface with its default when nothing selects a recipe', () => {
    const theme = loadTheme('editorial');
    expect(theme.recipes).toEqual(
      Object.fromEntries(
        THEME_RECIPE_SURFACES.map((surface) => [surface, THEME_RECIPE_SPECS[surface][0]]),
      ),
    );
  });

  it('layers the spec over the preset, over its extends chain, over the defaults', () => {
    const catalog = builtinThemeCatalog();
    catalog.entries.alpha = parsePresetDocument({
      name: 'alpha',
      extends: 'data-console',
      recipes: { tables: 'minimal', callouts: 'outlined' },
    });
    catalog.entries.beta = parsePresetDocument({
      name: 'beta',
      extends: 'alpha',
      recipes: { cards: 'outlined', callouts: 'tinted' },
    });
    const theme = loadTheme({ preset: 'beta', recipes: { cards: 'flat' } }, { catalog });
    expect(theme.recipes).toEqual({
      cards: 'flat', // spec over beta's outlined and data-console's flat
      sections: 'divided', // data-console
      tables: 'minimal', // alpha over data-console's ledger
      charts: 'minimal', // data-console
      hero: 'compact', // data-console
      metrics: 'default', // default
      media: 'default', // default
      callouts: 'tinted', // beta over alpha
    });
  });

  it('gives each new preset its documented recipes', () => {
    expect(loadTheme('data-console').recipes).toMatchObject({
      hero: 'compact',
      tables: 'ledger',
      charts: 'minimal',
      cards: 'flat',
      sections: 'divided',
    });
    expect(loadTheme('data-console').density).toBe('compact');
    expect(loadTheme('executive-report').recipes).toMatchObject({
      metrics: 'headline',
      charts: 'minimal',
      sections: 'divided',
      cards: 'outlined',
    });
    expect(loadTheme('product-studio').recipes).toMatchObject({ media: 'framed', cards: 'raised' });
    expect(loadTheme('research-notebook').recipes).toMatchObject({
      callouts: 'outlined',
      tables: 'ledger',
      hero: 'compact',
      cards: 'flat',
    });
  });
});

describe('recipe validation', () => {
  it('rejects an unknown recipe value in the spec with the allowed list', () => {
    const error = captureError(() =>
      compile(page('theme:\n  preset: editorial\n  recipes:\n    tables: spreadsheet')),
    );
    expect(error.code).toBe('SPEC_VALIDATION_ERROR');
    expect(error.path).toBe('$.theme.recipes.tables');
    expect(error.details?.allowed).toEqual(['default', 'ledger', 'minimal']);
  });

  it('rejects an unknown surface and CSS text posing as a value', () => {
    const unknown = captureError(() => compile(page('theme:\n  recipes:\n    buttons: flat')));
    expect(unknown.path).toBe('$.theme.recipes.buttons');
    expect(unknown.details?.allowed).toEqual([...THEME_RECIPE_SURFACES]);
    const css = captureError(() =>
      compile(page('theme:\n  recipes:\n    cards: "flat;background:red"')),
    );
    expect(css.path).toBe('$.theme.recipes.cards');
  });

  it('rejects an invalid recipe in a preset file at its own path', () => {
    const error = captureError(() =>
      parsePresetDocument(
        { name: 'team', extends: 'editorial', recipes: { hero: 'huge' } },
        { file: 'team.yaml' },
      ),
    );
    expect(error.code).toBe('SPEC_VALIDATION_ERROR');
    expect(error.path).toBe('team.yaml#recipes.hero');
    expect(error.details?.allowed).toEqual(['default', 'compact']);
  });

  it('rejects a recipes field that is not a map', () => {
    const error = captureError(() =>
      parsePresetDocument({ name: 'team', recipes: 'flat' }, { file: 'team.yaml' }),
    );
    expect(error.path).toBe('team.yaml#recipes');
  });
});

describe('recipe output', () => {
  it('keeps a page with only default recipes byte-identical', () => {
    const plain = compile(page('theme:\n  preset: editorial'));
    const defaults = compile(
      page(
        `theme:\n  preset: editorial\n  recipes:\n${THEME_RECIPE_SURFACES.map(
          (surface) => `    ${surface}: ${THEME_RECIPE_SPECS[surface][0]}`,
        ).join('\n')}`,
      ),
    );
    expect(defaults.html).toBe(plain.html);
    expect(plain.html).not.toContain('data-r-');
  });

  it('carries a preset recipes into the CSS and the root attributes', () => {
    const { html } = compile(page('theme:\n  preset: data-console'));
    expect(htmlTag(html)).toBe(
      '<html lang="en" data-density="compact" data-r-cards="flat" data-r-sections="divided" data-r-tables="ledger" data-r-charts="minimal" data-r-hero="compact">',
    );
    expect(html).toContain('html[data-r-tables="ledger"] .ak-table-wrap tbody tr:nth-child(even)');
    expect(html).toContain('html[data-r-hero="compact"] .ak-hero');
  });

  it('applies the preset that the theme option names over the spec theme', () => {
    const { html, theme } = compile(page('theme:\n  preset: editorial'), {
      theme: 'research-notebook',
    });
    expect(theme.recipes.callouts).toBe('outlined');
    expect(htmlTag(html)).toContain('data-r-callouts="outlined"');
    expect(html).toContain('html[data-r-callouts="outlined"] .ak-callout');
  });

  it('lets a spec override return a surface to its default', () => {
    const result = compile(DIALECTS, { source: 'theme-dialects.yaml' });
    expect(result.theme.recipes.cards).toBe('raised');
    expect(htmlTag(result.html)).not.toContain('data-r-cards');
    expect(result.html).not.toContain('html[data-r-cards=');
    expect(htmlTag(result.html)).toContain('data-r-tables="ledger"');
  });

  it('emits a feature recipe sheet only when the page uses the feature', () => {
    const without = compile(page('theme:\n  preset: data-console'));
    expect(without.html).not.toContain('html[data-r-charts="minimal"]');
    const withChart = compile(`${page('theme:\n  preset: data-console')}${CHART_BLOCK}`);
    expect(withChart.html).toContain('html[data-r-charts="minimal"] .ak-chart .ak-chart-grid');
    expect(recipeCss({ tables: 'ledger' }, new Set())).not.toContain('.ak-data-table');
    expect(recipeCss({ tables: 'ledger' }, new Set(['data-table']))).toContain(
      'html[data-r-tables="ledger"] .ak-data-table tbody',
    );
  });

  it('emits nothing for default values and unknown choices', () => {
    expect(recipeCss(undefined, new Set())).toBe('');
    expect(recipeCss({ cards: 'raised', callouts: 'tinted' }, new Set())).toBe('');
    expect(recipeCss({ cards: 'glass' }, new Set())).toBe('');
  });

  it('compiles deterministically', () => {
    const first = compile(DIALECTS);
    const second = compile(DIALECTS);
    expect(second.hash).toBe(first.hash);
    expect(second.html).toBe(first.html);
  });

  it('compiles and verifies every non-default recipe under every preset', () => {
    // Two passes cover every value: the first and the last non-default of each surface.
    const passes = [1, -1].map((pick) =>
      THEME_RECIPE_SURFACES.map(
        (surface) => [surface, THEME_RECIPE_SPECS[surface].at(pick) ?? ''] as const,
      ),
    );
    for (const preset of themePresetNames()) {
      for (const pass of passes) {
        const recipes = pass.map(([surface, choice]) => `    ${surface}: ${choice}`).join('\n');
        const { html } = compile(
          `${page(`theme:\n  preset: ${preset}\n  recipes:\n${recipes}`)}${CHART_BLOCK}`,
        );
        for (const [surface, choice] of pass) {
          expect(htmlTag(html), `${preset} ${surface}`).toContain(`data-r-${surface}="${choice}"`);
        }
      }
    }
  }, 30_000);
});

describe('recipe stylesheets', () => {
  const entries = Object.entries(RECIPE_CSS).flatMap(([surface, values]) =>
    Object.entries(values).map(([choice, sheets]) => ({ surface, choice, sheets })),
  );

  it('cover exactly the non-default value of every surface', () => {
    const covered = entries.map(({ surface, choice }) => `${surface}:${choice}`).sort();
    const expected = THEME_RECIPE_SURFACES.flatMap((surface) =>
      THEME_RECIPE_SPECS[surface].slice(1).map((choice) => `${surface}:${choice}`),
    ).sort();
    expect(covered).toEqual(expected);
  });

  it('are token-driven and scoped to their own recipe', () => {
    for (const { surface, choice, sheets } of entries) {
      for (const sheet of sheets) {
        expect(sheet.css, `${surface}:${choice}`).not.toMatch(
          /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|url\(/iu,
        );
        const rules = sheet.css
          .replace(/@media[^{]*\{/gu, '')
          .split('}')
          .filter((rule) => rule.trim() !== '');
        for (const rule of rules) {
          // Collapse parenthesised groups so only top-level commas split the list.
          let selectors = rule.slice(0, rule.indexOf('{'));
          while (/\([^()]*\)/u.test(selectors)) selectors = selectors.replace(/\([^()]*\)/gu, '');
          for (const selector of selectors.split(',')) {
            expect(selector.trim(), `${surface}:${choice}`).toMatch(
              new RegExp(`^html\\[data-r-${surface}="${choice}"\\] `, 'u'),
            );
          }
        }
      }
    }
  });
});
