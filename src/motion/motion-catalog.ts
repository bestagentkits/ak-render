/**
 * Motion discovery: the recipe registry as an agent reads it.
 *
 * Every answer is projected from `MOTION_RECIPES`, never from a hand-kept copy,
 * so a recipe cannot be documented one way and validated another. Three depths
 * keep tokens proportional to need:
 *
 * - `motionCatalog()`: one line per recipe (id, blocks, trigger, purpose);
 * - `searchMotions(query)`: the recipes that match an intent phrase, ranked;
 * - `describeMotion(id)`: the full descriptor, or with `compact` just what an
 *   author needs to write the field.
 *
 * Search is plain word overlap with no fuzzy matching or randomness, so the same
 * query always returns the same hits. The compiler-authored CSS never leaves
 * this module: an agent names a recipe, it does not read or copy its rules.
 */

import { RenderError } from '../errors.js';
import { catalogSearchTokens, sameWord, words } from '../registry/catalog-search.js';
import {
  getMotionRecipe,
  MOTION_DURATION_SCALE,
  MOTION_RECIPES,
  type MotionDuration,
  type MotionEasing,
  type MotionPhase,
  type MotionRecipe,
  type MotionRole,
  type MotionRuntime,
  type MotionState,
  type MotionTrigger,
} from './recipes.js';

/** The theme's default `motion-duration`, which the scale multiplies. */
export const DEFAULT_MOTION_DURATION_MS = 160;

/** One recipe in the compact listing. */
export interface MotionCatalogEntry {
  id: string;
  /** Block types, or `'*'` for every block but the page. */
  blocks: readonly string[] | '*';
  triggers: readonly MotionTrigger[];
  /** True when the recipe adds script beyond the shared arrival observer. */
  script: boolean;
  purpose: string;
}

export interface MotionCatalog {
  recipeCount: number;
  recipes: MotionCatalogEntry[];
  /** How a recipe is named in a block. */
  usage: string;
}

export interface MotionSearchHit {
  id: string;
  purpose: string;
  score: number;
}

/** What an author needs to write the field, and nothing else. */
export interface CompactMotionDescription {
  id: string;
  purpose: string;
  blocks: readonly string[] | '*';
  triggers: readonly MotionTrigger[];
  reduced: string;
  requires?: { visibleWhen?: true };
  example: Record<string, unknown>;
}

/** The full descriptor: every registry field except the compiler's CSS. */
export interface MotionDescription extends CompactMotionDescription {
  version: number;
  aliases: readonly string[];
  phases: readonly MotionPhase[];
  states: readonly MotionState[];
  role: MotionRole;
  duration: MotionDuration;
  /** The duration at the default theme `motion-duration`. */
  durationMs: number;
  easing: MotionEasing;
  properties: readonly string[];
  runtime: MotionRuntime;
  keyframes: readonly string[];
  notes: string;
}

/** Input bounds, matching the block catalog search. */
export const MOTION_SEARCH_LIMITS = { defaultHits: 5, maxHits: 20 } as const;

const USAGE = 'motion: <id> on a block, or motion: { preset: <id> }';

function entryOf(recipe: MotionRecipe): MotionCatalogEntry {
  return {
    id: recipe.id,
    blocks: recipe.targets === '*' ? '*' : [...recipe.targets],
    triggers: [...recipe.triggers],
    script: recipe.runtime === 'lifecycle',
    purpose: recipe.purpose,
  };
}

/** Every recipe, one short entry each, in registry order. */
export function motionCatalog(): MotionCatalog {
  return { recipeCount: MOTION_RECIPES.length, recipes: MOTION_RECIPES.map(entryOf), usage: USAGE };
}

/** Points one query token earns per field it matches. */
const WEIGHTS = { id: 3, alias: 2, target: 2, trigger: 1, purpose: 1 } as const;

interface MotionIndexEntry {
  recipe: MotionRecipe;
  idWords: string[];
  aliasWords: string[];
  targetWords: string[];
  triggerWords: string[];
  purposeWords: string[];
}

const INDEX: readonly MotionIndexEntry[] = MOTION_RECIPES.map((recipe) => ({
  recipe,
  idWords: words(recipe.id),
  aliasWords: recipe.aliases.flatMap(words),
  targetWords: recipe.targets === '*' ? ['any', 'block'] : recipe.targets.flatMap(words),
  triggerWords: recipe.triggers.flatMap(words),
  purposeWords: words(recipe.purpose),
}));

function tokenScore(token: string, entry: MotionIndexEntry): number {
  const has = (list: readonly string[]) => list.some((word) => sameWord(token, word));
  let score = 0;
  if (has(entry.idWords)) score += WEIGHTS.id;
  if (has(entry.aliasWords)) score += WEIGHTS.alias;
  if (has(entry.targetWords)) score += WEIGHTS.target;
  if (has(entry.triggerWords)) score += WEIGHTS.trigger;
  if (has(entry.purposeWords)) score += WEIGHTS.purpose;
  return score;
}

/**
 * Rank recipes against a short intent phrase such as "smooth tabs". Sorted by
 * score, then id; recipes that match no word are left out.
 */
export function searchMotions(
  query: string,
  limit: number = MOTION_SEARCH_LIMITS.defaultHits,
): MotionSearchHit[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > MOTION_SEARCH_LIMITS.maxHits) {
    throw new RenderError(
      'SPEC_VALIDATION_ERROR',
      `search limit must be an integer from 1 to ${MOTION_SEARCH_LIMITS.maxHits}`,
      { path: 'limit', details: { limit } },
    );
  }
  const tokens = catalogSearchTokens(query);
  const hits: MotionSearchHit[] = [];
  for (const entry of INDEX) {
    let score = 0;
    for (const token of tokens) score += tokenScore(token, entry);
    if (score > 0) hits.push({ id: entry.recipe.id, purpose: entry.recipe.purpose, score });
  }
  hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hits.slice(0, limit);
}

function compactOf(recipe: MotionRecipe): CompactMotionDescription {
  return {
    id: recipe.id,
    purpose: recipe.purpose,
    blocks: recipe.targets === '*' ? '*' : [...recipe.targets],
    triggers: [...recipe.triggers],
    reduced: recipe.reduced,
    ...(recipe.requires === undefined ? {} : { requires: { ...recipe.requires } }),
    example: structuredClone(recipe.example) as Record<string, unknown>,
  };
}

/**
 * One recipe's descriptor. An unknown id is a `SPEC_VALIDATION_ERROR` whose
 * details list every id, ranked by how well it matches the unknown one.
 */
export function describeMotion(
  id: string,
  options: { compact?: boolean } = {},
): MotionDescription | CompactMotionDescription {
  const recipe = getMotionRecipe(id);
  if (recipe === undefined) {
    const suggestions = searchMotions(id.replace(/-/gu, ' '), MOTION_SEARCH_LIMITS.maxHits).map(
      (hit) => hit.id,
    );
    throw new RenderError('SPEC_VALIDATION_ERROR', `unknown motion recipe "${id}"`, {
      path: 'id',
      details: { id, suggestions, known: MOTION_RECIPES.map((entry) => entry.id) },
    });
  }
  const compact = compactOf(recipe);
  if (options.compact === true) return compact;
  return {
    ...compact,
    version: recipe.version,
    aliases: [...recipe.aliases],
    phases: [...recipe.phases],
    states: [...recipe.states],
    role: recipe.role,
    duration: recipe.duration,
    durationMs: DEFAULT_MOTION_DURATION_MS * MOTION_DURATION_SCALE[recipe.duration],
    easing: recipe.easing,
    properties: [...recipe.properties],
    runtime: recipe.runtime,
    keyframes: [...recipe.keyframes],
    notes: recipe.notes,
  };
}
