/**
 * Page recipes: complete starter Page Specs for common page kinds.
 *
 * A recipe is static data. The YAML sources live in `src/recipes/page-recipes`
 * and are embedded by `scripts/generate-recipes-module.mjs`, so reading one
 * never touches the filesystem or the network. Every recipe validates with no
 * errors and no warnings, which a unit test enforces.
 */

import { RenderError } from '../errors.js';
import { PAGE_RECIPES } from './recipes.generated.js';

export interface PageRecipe {
  /** Stable kebab-case name, e.g. `dashboard`. */
  name: string;
  /** One line on what the page shows. */
  summary: string;
  /** Situations the recipe fits. */
  useCases: string[];
  /** Every block type the spec uses, nested ones included, sorted. */
  blocks: string[];
  /** The starter Page Spec as YAML text. */
  spec: string;
}

/** A recipe listing entry: everything but the spec text. */
export type PageRecipeSummary = Omit<PageRecipe, 'spec'>;

function copy(recipe: PageRecipe): PageRecipe {
  return { ...recipe, useCases: [...recipe.useCases], blocks: [...recipe.blocks] };
}

/** Every recipe without its spec, sorted by name. */
export function recipes(): PageRecipeSummary[] {
  return PAGE_RECIPES.map(({ spec: _spec, ...entry }) => ({
    ...entry,
    useCases: [...entry.useCases],
    blocks: [...entry.blocks],
  })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The recipe called `name`. An unknown name throws and lists the allowed names. */
export function recipe(name: string): PageRecipe {
  const found = PAGE_RECIPES.find((entry) => entry.name === name);
  if (found !== undefined) return copy(found);
  const allowed = recipes().map((entry) => entry.name);
  throw new RenderError(
    'SPEC_VALIDATION_ERROR',
    `unknown recipe "${name}"; expected one of: ${allowed.join(', ')}`,
    { path: 'name', details: { name, allowed } },
  );
}
