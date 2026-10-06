/**
 * Intent search over the block catalog.
 *
 * An agent that knows what it wants ("sortable table", "pricing") should not
 * have to load the whole catalog to find the block for it. `searchCatalog`
 * ranks block types by plain word overlap with the type name, tags, use cases,
 * category and summary. There is no fuzzy matching, locale or randomness, so
 * the same query against the same roster always returns the same hits.
 */

import { RenderError } from '../errors.js';
import type { BlockCategory } from './block-module.js';
import { BLOCK_DEFINITIONS } from './registry.js';
import type { BlockDefinition } from './roster.js';

export interface CatalogSearchHit {
  type: string;
  category: BlockCategory;
  summary: string;
  score: number;
}

/** Input bounds: a query is a short phrase, not a document. */
export const CATALOG_SEARCH_LIMITS = {
  maxQueryLength: 200,
  maxTokens: 8,
  defaultHits: 8,
  maxHits: 100,
} as const;

/** Points one query token earns per field it matches; fields add up. */
const WEIGHTS = {
  type: 3,
  typeSegment: 2,
  tag: 2,
  useCase: 2,
  category: 2,
  summary: 1,
} as const;

/**
 * Filler words that appear in most summaries ("and", "with") and would only
 * add ties. They are dropped from the query, never from the index.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/** Lowercase ASCII words; anything else separates words. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word !== '');
}

/**
 * Two words match when they are equal or differ only by a plural `s`/`es`, so
 * "logs" finds `log-viewer` and "tables" finds `table`.
 */
function sameWord(a: string, b: string): boolean {
  return a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
}

interface SearchIndexEntry {
  definition: BlockDefinition;
  typeSegments: string[];
  tagWords: string[];
  useCaseWords: string[];
  summaryWords: string[];
}

function indexEntry(definition: BlockDefinition): SearchIndexEntry {
  return {
    definition,
    typeSegments: words(definition.type),
    // A whole tag and each of its kebab segments both count as the tag.
    tagWords: definition.tags.flatMap((tag) => [tag, ...words(tag)]),
    useCaseWords: definition.useCases.flatMap(words),
    summaryWords: words(definition.summary),
  };
}

/** Built once: the default registry is static for the life of the process. */
const SEARCH_INDEX: readonly SearchIndexEntry[] = BLOCK_DEFINITIONS.map(indexEntry);

function tokenScore(token: string, entry: SearchIndexEntry): number {
  const has = (list: readonly string[]) => list.some((word) => sameWord(token, word));
  let score = 0;
  if (sameWord(token, entry.definition.type)) score += WEIGHTS.type;
  else if (has(entry.typeSegments)) score += WEIGHTS.typeSegment;
  if (has(entry.tagWords)) score += WEIGHTS.tag;
  if (has(entry.useCaseWords)) score += WEIGHTS.useCase;
  if (sameWord(token, entry.definition.category)) score += WEIGHTS.category;
  if (has(entry.summaryWords)) score += WEIGHTS.summary;
  return score;
}

/** The distinct query words that are scored, in query order, stop words removed. */
export function catalogSearchTokens(query: string): string[] {
  if (query.length > CATALOG_SEARCH_LIMITS.maxQueryLength) {
    throw new RenderError(
      'SPEC_VALIDATION_ERROR',
      `search query is longer than ${CATALOG_SEARCH_LIMITS.maxQueryLength} characters`,
      { path: 'query', details: { length: query.length } },
    );
  }
  const tokens = words(query).filter((word) => !STOP_WORDS.has(word));
  return [...new Set(tokens)].slice(0, CATALOG_SEARCH_LIMITS.maxTokens);
}

/**
 * Rank block types against a short intent phrase. Sorted by score, highest
 * first, then by type in code-unit order; blocks that match no word are left
 * out, so an empty result means nothing matched.
 */
export function searchCatalog(
  query: string,
  limit: number = CATALOG_SEARCH_LIMITS.defaultHits,
): CatalogSearchHit[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > CATALOG_SEARCH_LIMITS.maxHits) {
    throw new RenderError(
      'SPEC_VALIDATION_ERROR',
      `search limit must be an integer from 1 to ${CATALOG_SEARCH_LIMITS.maxHits}`,
      { path: 'limit', details: { limit } },
    );
  }
  const tokens = catalogSearchTokens(query);
  if (tokens.length === 0) return [];

  const hits: CatalogSearchHit[] = [];
  for (const entry of SEARCH_INDEX) {
    let score = 0;
    for (const token of tokens) score += tokenScore(token, entry);
    if (score === 0) continue;
    const { type, category, summary } = entry.definition;
    hits.push({ type, category, summary, score });
  }
  hits.sort((a, b) => b.score - a.score || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return hits.slice(0, limit);
}
