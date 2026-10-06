/**
 * Theme recipes: a named presentation choice per surface (`cards: flat`,
 * `tables: ledger`). A recipe is typed data like a token: the author picks a
 * value from a closed list and the compiler owns the CSS it maps to, so a
 * recipe can never carry a stylesheet.
 */

import { type DiagnosticBag, pathKey } from '../diagnostics.js';
import { isPlainObject } from '../json.js';

/** Surfaces and their recipe values; the first value of each list is the default. */
export const THEME_RECIPE_SPECS = {
  cards: ['raised', 'flat', 'outlined'],
  sections: ['ruled', 'divided', 'plain'],
  tables: ['default', 'ledger', 'minimal'],
  charts: ['default', 'minimal'],
  hero: ['default', 'compact'],
  metrics: ['default', 'headline'],
  media: ['default', 'framed'],
  callouts: ['tinted', 'outlined'],
} as const satisfies Record<string, readonly string[]>;

export type ThemeRecipeSurface = keyof typeof THEME_RECIPE_SPECS;

export const THEME_RECIPE_SURFACES = Object.keys(THEME_RECIPE_SPECS) as ThemeRecipeSurface[];

function isSurface(key: string): key is ThemeRecipeSurface {
  return Object.hasOwn(THEME_RECIPE_SPECS, key);
}

/**
 * Validate `theme.recipes`. Returns the valid entries in surface order; every
 * unknown surface or value is reported with the allowed list.
 */
export function validateThemeRecipes(
  value: unknown,
  path: string,
  bag: DiagnosticBag,
): Record<string, string> {
  const recipes: Record<string, string> = {};
  if (!isPlainObject(value)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path,
      message: 'expected a map of surface to recipe',
    });
    return recipes;
  }
  for (const [surface, choice] of Object.entries(value)) {
    const at = pathKey(path, surface);
    if (!isSurface(surface)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: at,
        message: `unknown recipe surface "${surface}"`,
        details: { allowed: [...THEME_RECIPE_SURFACES] },
      });
      continue;
    }
    const allowed: readonly string[] = THEME_RECIPE_SPECS[surface];
    if (typeof choice !== 'string' || !allowed.includes(choice)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: at,
        message: `"${String(choice)}" is not a ${surface} recipe`,
        details: { allowed: [...allowed] },
      });
    }
  }
  for (const surface of THEME_RECIPE_SURFACES) {
    const choice = value[surface];
    if (
      typeof choice === 'string' &&
      (THEME_RECIPE_SPECS[surface] as readonly string[]).includes(choice)
    ) {
      recipes[surface] = choice;
    }
  }
  return recipes;
}

/** JSON Schema for `theme.recipes`. */
export const THEME_RECIPES_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  description: 'A presentation choice per surface; the first value of each list is the default.',
  additionalProperties: false,
  properties: Object.fromEntries(
    THEME_RECIPE_SURFACES.map((surface) => [surface, { enum: [...THEME_RECIPE_SPECS[surface]] }]),
  ),
};

/** A complete recipe choice: every surface mapped to one of its values. */
export type ThemeRecipes = Record<ThemeRecipeSurface, string>;

/** The default recipe for every surface. */
export function defaultRecipes(): ThemeRecipes {
  return Object.fromEntries(
    THEME_RECIPE_SURFACES.map((surface) => [surface, THEME_RECIPE_SPECS[surface][0]]),
  ) as ThemeRecipes;
}

/**
 * The surfaces whose recipe differs from the default, in surface order. Only
 * these reach the emitted page, so a page that keeps every default renders the
 * same bytes as before recipes existed.
 */
export function nonDefaultRecipes(
  recipes: Readonly<Record<string, string>> | undefined,
): [ThemeRecipeSurface, string][] {
  if (recipes === undefined) return [];
  const chosen: [ThemeRecipeSurface, string][] = [];
  for (const surface of THEME_RECIPE_SURFACES) {
    const choice = recipes[surface];
    if (choice !== undefined && choice !== THEME_RECIPE_SPECS[surface][0]) {
      chosen.push([surface, choice]);
    }
  }
  return chosen;
}
