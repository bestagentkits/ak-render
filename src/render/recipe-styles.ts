/**
 * Recipe stylesheets: the CSS each theme recipe maps to.
 *
 * Recipe CSS is token-driven like every feature sheet and is emitted only for
 * the recipes a page selects, and within a recipe only for the features the
 * page uses. A recipe left at its default value emits nothing: the default look
 * is the base and feature sheets themselves.
 */

import type { RuntimeFeature } from '../registry/roster.js';
import { THEME_RECIPE_SURFACES } from '../theme/recipes.js';

export interface RecipeSheet {
  /** Emit only when the page uses this feature; absent means always. */
  feature?: RuntimeFeature;
  css: string;
}

/** Surface → recipe value → sheets. */
export const RECIPE_CSS: Readonly<
  Record<string, Readonly<Record<string, readonly RecipeSheet[]>>>
> = {};

/** The recipe CSS for a page, in fixed surface order; '' when nothing applies. */
export function recipeCss(
  recipes: Readonly<Record<string, string>> | undefined,
  features: ReadonlySet<RuntimeFeature>,
): string {
  if (recipes === undefined) return '';
  const sheets: string[] = [];
  for (const surface of THEME_RECIPE_SURFACES) {
    const choice = recipes[surface];
    if (choice === undefined) continue;
    for (const sheet of RECIPE_CSS[surface]?.[choice] ?? []) {
      if (sheet.feature === undefined || features.has(sheet.feature)) sheets.push(sheet.css);
    }
  }
  return sheets.join('\n');
}
