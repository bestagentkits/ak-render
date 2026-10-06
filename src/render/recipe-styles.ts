/**
 * Recipe stylesheets: the CSS each theme recipe maps to.
 *
 * Recipe CSS is token-driven like every feature sheet and is emitted only for
 * the recipes a page selects, and within a recipe only for the features the
 * page uses. A recipe left at its default value emits nothing: the default look
 * is the base and feature sheets themselves.
 *
 * Every rule is scoped by the `data-r-<surface>` attribute the document writes
 * on `<html>`, which also lifts it over the base and feature rules it restyles
 * without `!important`. Selectors rely only on stable root classes:
 * `.ak-card`, `.ak-surface`, `.ak-stats`/`.ak-stat`, `.ak-section-head`,
 * `.ak-hero`, `.ak-table-wrap`, `.ak-media`, `.ak-gallery`, `.ak-callout`, and
 * the feature roots `.ak-chart`, `.ak-kpi-card` and `.ak-data-table`.
 */

import type { RuntimeFeature } from '../registry/roster.js';
import { nonDefaultRecipes, type ThemeRecipeSurface } from '../theme/recipes.js';

export interface RecipeSheet {
  /** Emit only when the page uses this feature; absent means always. */
  feature?: RuntimeFeature;
  css: string;
}

/** The scope every rule of one recipe hangs from. */
const at = (surface: ThemeRecipeSurface, value: string): string =>
  `html[data-r-${surface}="${value}"]`;

/** `calc()` over the spacing unit, matching the base sheet's rhythm. */
const unit = (factor: number): string => `calc(var(--ak-space-unit) * ${factor})`;

/** Split a selector list on its top-level commas, leaving `:is(a,b)` whole. */
function selectorList(selectors: string): string[] {
  const list: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selectors.length; index += 1) {
    const char = selectors[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      list.push(selectors.slice(start, index).trim());
      start = index + 1;
    }
  }
  list.push(selectors.slice(start).trim());
  return list;
}

/** Prefix each selector of a rule with the recipe scope. */
function scoped(scope: string, selectors: string, body: string): string {
  const list = selectorList(selectors)
    .map((selector) => `${scope} ${selector}`)
    .join(',');
  return `${list}{${body}}`;
}

const SECTION_BREAK = '.ak-main > .ak-block + .ak-block:is(.ak-section,:has(> .ak-section-head))';
const SECTION_HEAD = '.ak-main > .ak-section > .ak-section-head';

/** Ledger rows: zebra striping, lining tabular figures and a strong header rule. */
function ledgerTable(scope: string, root: string): string {
  return [
    scoped(
      scope,
      `${root} tbody tr:nth-child(even)`,
      'background:color-mix(in srgb,var(--ak-color-text) 4%,transparent)',
    ),
    scoped(scope, `${root} tbody tr:hover`, 'background:var(--ak-tint)'),
    scoped(scope, `${root} :is(th,td)`, 'font-variant-numeric:tabular-nums lining-nums'),
    scoped(
      scope,
      `${root} thead th`,
      'border-bottom:calc(var(--ak-border-width) * 2) solid color-mix(in srgb,var(--ak-color-text) 70%,var(--ak-color-border))',
    ),
  ].join('\n');
}

/** Minimal rows: no vertical rules, a quiet header and compact cells. */
function minimalTable(scope: string, root: string): string {
  return [
    scoped(
      scope,
      `${root} :is(th,td)`,
      'border-left:0;border-right:0;padding-top:.5em;padding-bottom:.5em',
    ),
    scoped(
      scope,
      `${root} thead th`,
      'background:transparent;border-bottom-color:color-mix(in srgb,var(--ak-color-text) 30%,var(--ak-color-border))',
    ),
  ].join('\n');
}

const CARDS_FLAT = at('cards', 'flat');
const CARDS_OUTLINED = at('cards', 'outlined');
const SECTIONS_DIVIDED = at('sections', 'divided');
const SECTIONS_PLAIN = at('sections', 'plain');
const TABLES_LEDGER = at('tables', 'ledger');
const TABLES_MINIMAL = at('tables', 'minimal');
const CHARTS_MINIMAL = at('charts', 'minimal');
const HERO_COMPACT = at('hero', 'compact');
const METRICS_HEADLINE = at('metrics', 'headline');
const MEDIA_FRAMED = at('media', 'framed');
const CALLOUTS_OUTLINED = at('callouts', 'outlined');

/** Surface → recipe value → sheets. Default values have no entry. */
export const RECIPE_CSS: Readonly<
  Record<string, Readonly<Record<string, readonly RecipeSheet[]>>>
> = {
  cards: {
    // Surface only: a tonal fill carries the card, with no border or shadow.
    flat: [
      {
        css: scoped(
          CARDS_FLAT,
          '.ak-card,.ak-surface,.ak-stats',
          'background:var(--ak-color-surface-raised);border-color:transparent;box-shadow:none',
        ),
      },
      {
        feature: 'kpi',
        css: scoped(
          CARDS_FLAT,
          '.ak-kpi-card',
          'background:var(--ak-color-surface-raised);border-color:transparent;box-shadow:none',
        ),
      },
    ],
    // A firm hairline on the plain surface, no shadow.
    outlined: [
      {
        css: scoped(
          CARDS_OUTLINED,
          '.ak-card,.ak-surface,.ak-stats',
          'background:var(--ak-color-surface);border-color:color-mix(in srgb,var(--ak-color-text) 22%,var(--ak-color-border));box-shadow:none',
        ),
      },
      {
        feature: 'kpi',
        css: scoped(
          CARDS_OUTLINED,
          '.ak-kpi-card',
          'background:var(--ak-color-surface);border-color:color-mix(in srgb,var(--ak-color-text) 22%,var(--ak-color-border));box-shadow:none',
        ),
      },
    ],
  },
  sections: {
    // A heavier full-width rule and a larger break between sections.
    divided: [
      {
        css: [
          scoped(
            SECTIONS_DIVIDED,
            SECTION_HEAD,
            `padding-top:${unit(3)};border-top:calc(var(--ak-border-width) * 2) solid color-mix(in srgb,var(--ak-color-text) 24%,var(--ak-color-border))`,
          ),
          scoped(
            SECTIONS_DIVIDED,
            `${SECTION_HEAD}::before`,
            'top:calc(var(--ak-border-width) * -2)',
          ),
          scoped(SECTIONS_DIVIDED, SECTION_BREAK, 'margin-top:calc(var(--ak-gap) * 3.25)'),
          `@media (max-width:768px){${scoped(SECTIONS_DIVIDED, SECTION_BREAK, 'margin-top:calc(var(--ak-gap) * 2.5)')}}`,
        ].join('\n'),
      },
    ],
    // No rule and no accent tab; whitespace alone separates sections.
    plain: [
      {
        css: [
          scoped(SECTIONS_PLAIN, SECTION_HEAD, 'border-top:0;padding-top:0'),
          scoped(SECTIONS_PLAIN, `${SECTION_HEAD}::before`, 'content:none'),
        ].join('\n'),
      },
    ],
  },
  tables: {
    ledger: [
      { css: ledgerTable(TABLES_LEDGER, '.ak-table-wrap') },
      { feature: 'data-table', css: ledgerTable(TABLES_LEDGER, '.ak-data-table') },
    ],
    minimal: [
      {
        css: [
          scoped(
            TABLES_MINIMAL,
            '.ak-table-wrap',
            'background:transparent;border-color:transparent;border-radius:0;box-shadow:none',
          ),
          minimalTable(TABLES_MINIMAL, '.ak-table-wrap'),
        ].join('\n'),
      },
      { feature: 'data-table', css: minimalTable(TABLES_MINIMAL, '.ak-data-table') },
    ],
  },
  charts: {
    // Only the baseline stays; labels drop weight, never contrast.
    minimal: [
      {
        feature: 'chart',
        css: [
          scoped(CHARTS_MINIMAL, '.ak-chart .ak-chart-grid', 'display:none'),
          scoped(
            CHARTS_MINIMAL,
            '.ak-chart .ak-chart-axis',
            'stroke:color-mix(in srgb,var(--ak-color-text) 45%,var(--ak-color-border))',
          ),
          scoped(
            CHARTS_MINIMAL,
            '.ak-chart .ak-chart-label',
            'font-size:10px;font-weight:400;letter-spacing:.02em',
          ),
        ].join('\n'),
      },
    ],
  },
  hero: {
    // Left-aligned, tighter, and one step down the display scale.
    compact: [
      {
        css: [
          scoped(
            HERO_COMPACT,
            '.ak-hero',
            `gap:${unit(1.5)};padding:${unit(3)} 0 ${unit(2)};align-items:flex-start;text-align:left`,
          ),
          scoped(
            HERO_COMPACT,
            '.ak-hero h1',
            'max-width:24ch;font-size:calc(var(--ak-font-size-base) * 2.4);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),4));line-height:1.05;letter-spacing:-.03em',
          ),
          scoped(
            HERO_COMPACT,
            '.ak-hero p:not(.ak-eyebrow)',
            'font-size:calc(var(--ak-font-size-base) * 1.1)',
          ),
          scoped(
            HERO_COMPACT,
            '.ak-hero[data-align="center"]::before',
            'right:0;left:auto;translate:none',
          ),
          `@media (max-width:768px){${scoped(HERO_COMPACT, '.ak-hero h1', 'font-size:calc(var(--ak-font-size-base) * 2);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),3))')}}`,
        ].join('\n'),
      },
    ],
  },
  metrics: {
    // The number leads: a larger value under its label.
    headline: [
      {
        css: [
          scoped(METRICS_HEADLINE, '.ak-stat', `padding:${unit(3)} ${unit(3)} ${unit(3.5)}`),
          scoped(
            METRICS_HEADLINE,
            '.ak-stat dd',
            'margin-top:.35em;font-size:calc(var(--ak-font-size-base) * 3);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),4.6))',
          ),
          `@media (max-width:480px){${scoped(METRICS_HEADLINE, '.ak-stat dd', 'font-size:calc(var(--ak-font-size-base) * 2.2)')}}`,
        ].join('\n'),
      },
      {
        feature: 'kpi',
        css: [
          scoped(METRICS_HEADLINE, '.ak-kpi-card .ak-kpi-label', 'order:-1'),
          scoped(
            METRICS_HEADLINE,
            '.ak-kpi-card .ak-kpi-value',
            'font-size:calc(var(--ak-font-size-base) * 3.2);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),5.2))',
          ),
        ].join('\n'),
      },
    ],
  },
  media: {
    // An inset frame: padding on the surface, the caption inside the frame.
    framed: [
      {
        css: [
          scoped(
            MEDIA_FRAMED,
            '.ak-media,.ak-gallery figure',
            `margin:0;padding:${unit(1.5)};background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);box-shadow:var(--ak-elevation-card)`,
          ),
          scoped(
            MEDIA_FRAMED,
            '.ak-media img,.ak-media video,.ak-gallery figure img',
            'border:0;box-shadow:none;border-radius:var(--ak-radius-medium)',
          ),
          scoped(
            MEDIA_FRAMED,
            '.ak-media figcaption,.ak-gallery figcaption',
            `padding:0 ${unit(0.5)} ${unit(0.25)}`,
          ),
        ].join('\n'),
      },
    ],
  },
  callouts: {
    // A tone outline on the page instead of a tinted fill; the glyph stays.
    outlined: [
      {
        css: [
          scoped(
            CALLOUTS_OUTLINED,
            '.ak-callout',
            'background:transparent;border-color:color-mix(in srgb,var(--ak-tone) 60%,var(--ak-color-border))',
          ),
          scoped(
            CALLOUTS_OUTLINED,
            '.ak-callout::before',
            'background:transparent;color:var(--ak-tone);border:calc(var(--ak-border-width) * 1.5) solid var(--ak-tone);box-shadow:none',
          ),
        ].join('\n'),
      },
    ],
  },
};

/** The recipe CSS for a page, in fixed surface order; '' when nothing applies. */
export function recipeCss(
  recipes: Readonly<Record<string, string>> | undefined,
  features: ReadonlySet<RuntimeFeature>,
): string {
  const sheets: string[] = [];
  for (const [surface, choice] of nonDefaultRecipes(recipes)) {
    for (const sheet of RECIPE_CSS[surface]?.[choice] ?? []) {
      if (sheet.feature === undefined || features.has(sheet.feature)) sheets.push(sheet.css);
    }
  }
  return sheets.join('\n');
}
