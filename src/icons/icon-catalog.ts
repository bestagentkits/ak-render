/**
 * The icon catalog: parsing, validation, resolution and discovery.
 *
 * An author names an icon by meaning (`gauge`) or by exact glyph
 * (`tabler:brand-github`). A meaning resolves through the theme's icon profile
 * to one pack; an exact glyph is never swapped for a different picture. All
 * lookups are pure functions of the bundled data, so the same spec and
 * compiler version always resolve the same glyph.
 */

import { foldText } from '../internal/fold-text.js';
import { GENERATED_CONCEPTS, ICON_GLYPHS } from './icon-data.generated.js';
import {
  ICON_FALLBACK_ORDER,
  ICON_PACK_IDS,
  ICON_PACKS,
  ICON_PROFILES,
  ICON_SIZES,
  type IconPackId,
  type IconProfile,
  type IconSize,
  isIconPack,
} from './icon-packs.js';

export interface IconRequest {
  /** Present for an exact glyph (`pack:name`); absent for a meaning. */
  pack?: IconPackId;
  name: string;
  size?: IconSize;
  /** Accessible name for an icon that carries meaning on its own. */
  label?: string;
}

const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const MAX_LABEL = 120;

export type ParsedIcon =
  | { ok: true; request: IconRequest }
  | { ok: false; message: string; details?: Record<string, unknown> };

/**
 * Parse an `icon` value: `gauge`, `tabler:brand-github`, or an object with
 * `name` plus optional `pack`, `size` and `label`.
 */
export function parseIconValue(value: unknown): ParsedIcon {
  if (typeof value === 'string') {
    const [first = '', second, ...rest] = value.split(':');
    const explicit = second !== undefined;
    const name = explicit ? second : first;
    if (rest.length > 0 || !IDENTIFIER.test(name) || (explicit && !IDENTIFIER.test(first))) {
      return {
        ok: false,
        message: `"${value.slice(0, 80)}" is not an icon id; use a name such as "gauge" or a pack id such as "tabler:brand-github"`,
      };
    }
    if (!explicit) return { ok: true, request: { name } };
    if (!isIconPack(first)) {
      return {
        ok: false,
        message: `unknown icon pack "${first}"`,
        details: { packs: [...ICON_PACK_IDS] },
      };
    }
    return { ok: true, request: { pack: first, name } };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'expected an icon name or an object with name, pack and size' };
  }
  const object = value as Record<string, unknown>;
  const unknown = Object.keys(object).filter(
    (key) => !['name', 'pack', 'size', 'label'].includes(key),
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `unknown icon field "${unknown[0]}"`,
      details: { allowed: ['name', 'pack', 'size', 'label'] },
    };
  }
  const name = object.name;
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
    return { ok: false, message: 'icon name must be lowercase letters, digits and dashes' };
  }
  const request: IconRequest = { name };
  if (object.pack !== undefined) {
    if (!isIconPack(object.pack)) {
      return {
        ok: false,
        message: `unknown icon pack "${String(object.pack)}"`,
        details: { packs: [...ICON_PACK_IDS] },
      };
    }
    request.pack = object.pack;
  }
  if (object.size !== undefined) {
    if (
      typeof object.size !== 'string' ||
      !(ICON_SIZES as readonly string[]).includes(object.size)
    ) {
      return {
        ok: false,
        message: 'icon size must be one of xs, sm, md, lg, xl',
        details: { allowed: [...ICON_SIZES] },
      };
    }
    request.size = object.size as IconSize;
  }
  if (object.label !== undefined) {
    if (
      typeof object.label !== 'string' ||
      object.label.length === 0 ||
      object.label.length > MAX_LABEL
    ) {
      return { ok: false, message: `icon label must be 1 to ${MAX_LABEL} characters` };
    }
    request.label = object.label;
  }
  return { ok: true, request };
}

// --- data access -----------------------------------------------------------

export interface IconConcept {
  id: string;
  keywords: readonly string[];
  /** A brand mark: it is never replaced by a generic glyph. */
  brand: boolean;
  /** The glyph each pack draws this meaning with. */
  names: Readonly<Partial<Record<IconPackId, string>>>;
}

const CONCEPTS: readonly IconConcept[] = GENERATED_CONCEPTS.map((concept) => ({
  id: concept.id,
  keywords: concept.keywords,
  brand: concept.brand,
  names: concept.names as Partial<Record<IconPackId, string>>,
}));
const CONCEPT_BY_ID = new Map(CONCEPTS.map((concept) => [concept.id, concept]));

export interface IconGlyph {
  body: string;
  /** Square coordinate size of the glyph. */
  size: number;
}

export function glyphOf(pack: IconPackId, name: string): IconGlyph | undefined {
  const glyphs = ICON_GLYPHS[pack];
  // Own keys only: a name such as `constructor` must not reach the prototype.
  if (glyphs === undefined || !Object.hasOwn(glyphs, name)) return undefined;
  const entry = glyphs[name];
  if (entry === undefined) return undefined;
  return typeof entry === 'string'
    ? { body: entry, size: ICON_PACKS[pack].viewBox }
    : { body: entry[0], size: entry[1] };
}

/** True for a glyph that is a variant of another (`heart-bold`), not a name of its own. */
function isVariantName(pack: IconPackId, name: string): boolean {
  return pack === 'phosphor' && (name.endsWith('-bold') || name.endsWith('-fill'));
}

export function glyphNames(pack: IconPackId): string[] {
  return Object.keys(ICON_GLYPHS[pack] ?? {}).sort();
}

function variantGlyphName(pack: IconPackId, name: string, variant: string): string {
  if (pack !== 'phosphor' || variant === 'regular') return name;
  const candidate = `${name}-${variant}`;
  return glyphOf(pack, candidate) === undefined ? name : candidate;
}

// --- validation and resolution --------------------------------------------

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 4;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 4;
}

/** Up to `limit` candidates close to `name`, best first: prefix, substring, then small edits. */
export function suggestNames(name: string, candidates: readonly string[], limit = 5): string[] {
  const scored: { candidate: string; score: number }[] = [];
  for (const candidate of candidates) {
    let score = 0;
    if (candidate.startsWith(name) || name.startsWith(candidate)) score = 3;
    else if (candidate.includes(name) || name.includes(candidate)) score = 2;
    else if (editDistance(name, candidate) <= 2) score = 1;
    if (score > 0) scored.push({ candidate, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || byCodeUnit(a.candidate, b.candidate))
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

export interface IconProblem {
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Check that a parsed request names something the catalog has. An unknown exact
 * glyph or meaning is reported with close names and the discovery tools; no
 * raw SVG is ever accepted in its place.
 */
export function checkIconRequest(request: IconRequest): IconProblem | undefined {
  if (request.pack !== undefined) {
    if (glyphOf(request.pack, request.name) !== undefined) return undefined;
    const pool = glyphNames(request.pack).filter(
      (name) => !isVariantName(request.pack as IconPackId, name),
    );
    return {
      message: `icon "${request.pack}:${request.name}" is not bundled; search icons for the pack's available names`,
      details: {
        pack: request.pack,
        suggestions: suggestNames(request.name, pool).map((name) => `${request.pack}:${name}`),
        hint: 'Use the search-icons tool or `ak-render icons search <query>`.',
      },
    };
  }
  if (CONCEPT_BY_ID.has(request.name)) return undefined;
  return {
    message: `unknown icon "${request.name}"; use a semantic name or an explicit pack:name id`,
    details: {
      suggestions: suggestNames(
        request.name,
        CONCEPTS.map((concept) => concept.id),
      ),
      hint: 'Use the search-icons tool or `ak-render icons search <query>`.',
    },
  };
}

export interface ResolvedIcon {
  pack: IconPackId;
  /** The exact glyph name, including a variant suffix. */
  glyph: string;
  variant: string;
  body: string;
  size: number;
  /** The id a `<use>` reference points at. */
  symbolId: string;
  /** Set when the profile's pack had no glyph and another pack drew the meaning. */
  fallbackFrom?: IconPackId;
}

function resolved(pack: IconPackId, glyph: string, variant: string): ResolvedIcon | undefined {
  const found = glyphOf(pack, glyph);
  if (found === undefined) return undefined;
  return {
    pack,
    glyph,
    variant,
    body: found.body,
    size: found.size,
    symbolId: `aki-${pack}-${glyph}`,
  };
}

/** The variant a pack's glyphs use when the profile does not pick the pack. */
function defaultVariant(pack: IconPackId): string {
  return ICON_PACKS[pack].variants[0] ?? 'outline';
}

/**
 * Resolve a request against a theme profile.
 *
 * Precedence is explicit pack and name, then the profile's pack for a meaning,
 * then the fixed fallback order. The fallback only ever picks the same meaning
 * in another pack, so a brand mark or a status icon is never swapped for an
 * unrelated glyph.
 */
export function resolveIcon(request: IconRequest, profile: IconProfile): ResolvedIcon | undefined {
  if (request.pack !== undefined) {
    const variant = request.pack === profile.pack ? profile.variant : defaultVariant(request.pack);
    const base = request.name;
    const glyph = isVariantName(request.pack, base)
      ? base
      : variantGlyphName(request.pack, base, variant);
    return resolved(request.pack, glyph, variant);
  }
  const concept = CONCEPT_BY_ID.get(request.name);
  if (concept === undefined) return undefined;
  const order = [profile.pack, ...ICON_FALLBACK_ORDER.filter((pack) => pack !== profile.pack)];
  for (const pack of order) {
    const name = concept.names[pack];
    if (name === undefined) continue;
    const variant = pack === profile.pack ? profile.variant : defaultVariant(pack);
    const found = resolved(pack, variantGlyphName(pack, name, variant), variant);
    if (found === undefined) continue;
    if (pack !== profile.pack) found.fallbackFrom = profile.pack;
    return found;
  }
  return undefined;
}

export function profileOf(name: string): IconProfile {
  return Object.hasOwn(ICON_PROFILES, name)
    ? ICON_PROFILES[name as keyof typeof ICON_PROFILES]
    : ICON_PROFILES.lucide;
}

// --- discovery -------------------------------------------------------------

export interface IconHit {
  /** The id to write in a spec: a meaning, or `pack:name` for an exact glyph. */
  icon: string;
  kind: 'semantic' | 'explicit';
  /** Packs that can draw it. */
  packs: IconPackId[];
  brand?: boolean;
}

export const SEARCH_MAX_QUERY_LENGTH = 200;
const SEARCH_MAX_TOKENS = 8;
export const SEARCH_DEFAULT_LIMIT = 8;
export const SEARCH_MAX_LIMIT = 20;

const CONCEPT_GLYPHS: ReadonlySet<string> = new Set(
  CONCEPTS.flatMap((concept) =>
    Object.entries(concept.names).map(([pack, name]) => `${pack}:${name}`),
  ),
);

/** Code-unit order: the same on every runtime and locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Query words, distinct and bounded, so a long query costs a fixed amount. */
function tokens(text: string): string[] {
  const words = foldText(text.slice(0, SEARCH_MAX_QUERY_LENGTH))
    .split(/[^a-z0-9]+/u)
    .filter((token) => token !== '');
  return [...new Set(words)].slice(0, SEARCH_MAX_TOKENS);
}

function conceptScore(concept: IconConcept, query: string, queryTokens: readonly string[]): number {
  if (concept.id === query) return 100;
  const idTokens = concept.id.split('-');
  let score = 0;
  if (concept.id.startsWith(query)) score = Math.max(score, 60);
  else if (concept.id.includes(query)) score = Math.max(score, 40);
  for (const token of queryTokens) {
    if (idTokens.includes(token)) score += 30;
    else if (concept.keywords.includes(token)) score += 25;
    else if (idTokens.some((part) => part.startsWith(token))) score += 12;
    else if (concept.keywords.some((keyword) => keyword.startsWith(token) && token.length >= 3))
      score += 8;
  }
  return score;
}

/**
 * Search icons by meaning, English or Vietnamese. Returns at most `limit`
 * short hits; never glyph markup.
 */
export function searchIcons(
  query: string,
  options: { pack?: IconPackId; limit?: number } = {},
): IconHit[] {
  const normalized = foldText(query).trim().replace(/\s+/gu, '-');
  const queryTokens = tokens(query);
  if (normalized === '' || queryTokens.length === 0) return [];
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? SEARCH_DEFAULT_LIMIT), 1),
    SEARCH_MAX_LIMIT,
  );
  const hits: { hit: IconHit; score: number }[] = [];

  for (const concept of CONCEPTS) {
    const packs = ICON_PACK_IDS.filter((pack) => concept.names[pack] !== undefined);
    if (options.pack !== undefined && !packs.includes(options.pack)) continue;
    const score = conceptScore(concept, normalized, queryTokens);
    if (score === 0) continue;
    const hit: IconHit = { icon: concept.id, kind: 'semantic', packs };
    if (concept.brand) hit.brand = true;
    hits.push({ hit, score });
  }
  for (const pack of ICON_PACK_IDS) {
    if (options.pack !== undefined && options.pack !== pack) continue;
    for (const name of glyphNames(pack)) {
      if (isVariantName(pack, name) || CONCEPT_GLYPHS.has(`${pack}:${name}`)) continue;
      const parts = name.split('-');
      let score = 0;
      if (name === normalized) score = 90;
      else if (name.startsWith(normalized)) score = 45;
      else if (queryTokens.every((token) => parts.includes(token))) score = 35;
      else if (name.includes(normalized)) score = 25;
      if (score > 0)
        hits.push({ hit: { icon: `${pack}:${name}`, kind: 'explicit', packs: [pack] }, score });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || byCodeUnit(a.hit.icon, b.hit.icon))
    .slice(0, limit)
    .map((entry) => entry.hit);
}

export interface IconDescription {
  icon: string;
  kind: 'semantic' | 'explicit';
  brand: boolean;
  keywords: readonly string[];
  /** For each pack that can draw it: the glyph, its variants and its license. */
  packs: {
    pack: IconPackId;
    glyph: string;
    variants: string[];
    license: string;
    version: string;
  }[];
  /** The packs tried, in order, for a meaning whose profile pack lacks it. */
  fallbackOrder: IconPackId[];
  examples: string[];
}

function describeGlyph(pack: IconPackId, glyph: string): IconDescription['packs'][number] {
  const variants = ICON_PACKS[pack].variants.filter(
    (variant) =>
      variantGlyphName(pack, glyph, variant) !== glyph || variant === ICON_PACKS[pack].variants[0],
  );
  return {
    pack,
    glyph,
    variants,
    license: ICON_PACKS[pack].license,
    version: ICON_PACKS[pack].version,
  };
}

/** Describe one icon id: where it resolves, in which variants, under which license. */
export function describeIcon(id: string): IconDescription | IconProblem {
  const parsed = parseIconValue(id);
  if (!parsed.ok)
    return {
      message: parsed.message,
      ...(parsed.details === undefined ? {} : { details: parsed.details }),
    };
  const problem = checkIconRequest(parsed.request);
  if (problem !== undefined) return problem;
  const { request } = parsed;
  if (request.pack !== undefined) {
    return {
      icon: `${request.pack}:${request.name}`,
      kind: 'explicit',
      brand: false,
      keywords: [],
      packs: [describeGlyph(request.pack, request.name)],
      fallbackOrder: [],
      examples: [`icon: ${request.pack}:${request.name}`],
    };
  }
  const concept = CONCEPT_BY_ID.get(request.name) as IconConcept;
  return {
    icon: concept.id,
    kind: 'semantic',
    brand: concept.brand,
    keywords: concept.keywords,
    packs: ICON_PACK_IDS.flatMap((pack) => {
      const name = concept.names[pack];
      return name === undefined ? [] : [describeGlyph(pack, name)];
    }),
    fallbackOrder: [...ICON_FALLBACK_ORDER],
    examples: [`icon: ${concept.id}`, `icon: { name: ${concept.id}, size: lg }`],
  };
}

export function isIconProblem(value: IconDescription | IconProblem): value is IconProblem {
  return 'message' in value;
}

export interface IconPackSummary {
  pack: IconPackId;
  title: string;
  role: string;
  variants: readonly string[];
  glyphs: number;
  license: string;
  version: string;
  source: string;
  attribution?: string;
  /** Theme profiles that draw with this pack. */
  profiles: string[];
}

export function iconPackSummaries(): IconPackSummary[] {
  return ICON_PACK_IDS.map((pack) => {
    const info = ICON_PACKS[pack];
    const summary: IconPackSummary = {
      pack,
      title: info.title,
      role: info.role,
      variants: info.variants,
      glyphs: glyphNames(pack).filter((name) => !isVariantName(pack, name)).length,
      license: info.license,
      version: info.version,
      source: info.source,
      profiles: Object.entries(ICON_PROFILES)
        .filter(([, profile]) => profile.pack === pack)
        .map(([name]) => name),
    };
    if (info.attribution !== undefined) summary.attribution = info.attribution;
    return summary;
  });
}

export function iconConcepts(): readonly IconConcept[] {
  return CONCEPTS;
}
