/**
 * Icon packs and theme icon profiles.
 *
 * A pack is a pinned set of glyphs imported at build time. A profile is the
 * theme-level choice of pack and variant; authors write a meaning, and the
 * profile decides which pack draws it. The glyph data lives in
 * `icon-data.generated.ts`, produced from the pinned `@iconify-json/*`
 * dev dependencies, so the compiler never reads a catalog at runtime.
 */

import { ICON_PACK_SOURCES } from './icon-data.generated.js';

export const ICON_PACK_IDS = ['lucide', 'phosphor', 'tabler', 'pixelarticons', 'codicons'] as const;
export type IconPackId = (typeof ICON_PACK_IDS)[number];

export const ICON_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export interface IconPackInfo {
  id: IconPackId;
  title: string;
  /** What the pack is for, in one line. */
  role: string;
  /** Variants the bundled glyphs come in; the first is the default. */
  variants: readonly string[];
  /** The npm package the glyphs were imported from, and its pinned version. */
  source: string;
  version: string;
  license: string;
  licenseUrl: string;
  author: string;
  /** Attribution the license asks for, when it does. */
  attribution?: string;
  /** Square coordinate size of a glyph that does not state its own. */
  viewBox: number;
}

const PACK_DESCRIPTIONS: Record<IconPackId, { title: string; role: string; variants: string[] }> = {
  lucide: {
    title: 'Lucide',
    role: 'Default neutral outline set for editorial and general pages.',
    variants: ['outline'],
  },
  phosphor: {
    title: 'Phosphor',
    role: 'Regular, bold and fill weights for newspaper, neobrutalism and bold themes.',
    variants: ['regular', 'bold', 'fill'],
  },
  tabler: {
    title: 'Tabler Icons',
    role: 'Wide outline coverage for technical and blueprint pages, including brand marks.',
    variants: ['outline'],
  },
  pixelarticons: {
    title: 'Pixelarticons',
    role: 'Pixel-perfect glyphs for pixel-art themes (free MIT set only).',
    variants: ['pixel'],
  },
  codicons: {
    title: 'Codicons',
    role: 'Compact technical glyphs for terminal, engineering and console themes.',
    variants: ['mono'],
  },
};

/** The attribution CC BY 4.0 asks for; MIT and ISC keep their notice in the package. */
const ATTRIBUTIONS: Partial<Record<IconPackId, string>> = {
  codicons: 'Codicons © Microsoft Corporation, licensed under CC BY 4.0.',
};

export const ICON_PACKS: Readonly<Record<IconPackId, IconPackInfo>> = Object.fromEntries(
  ICON_PACK_IDS.map((id) => {
    const source = ICON_PACK_SOURCES[id];
    const description = PACK_DESCRIPTIONS[id];
    if (source === undefined) throw new Error(`icon data is missing pack "${id}"`);
    const info: IconPackInfo = {
      id,
      title: description.title,
      role: description.role,
      variants: description.variants,
      source: source.source,
      version: source.version,
      license: source.license,
      licenseUrl: source.licenseUrl,
      author: source.author,
      viewBox: source.viewBox,
    };
    const attribution = ATTRIBUTIONS[id];
    if (attribution !== undefined) info.attribution = attribution;
    return [id, info];
  }),
) as Record<IconPackId, IconPackInfo>;

export function isIconPack(value: unknown): value is IconPackId {
  return typeof value === 'string' && (ICON_PACK_IDS as readonly string[]).includes(value);
}

/** The pack and variant a theme draws its icons with. */
export interface IconProfile {
  pack: IconPackId;
  variant: string;
}

/**
 * Theme icon profiles, a closed list like theme recipes. The first is the
 * default. A profile is typed data: it names a pack and a variant, never a
 * stylesheet or a glyph.
 */
export const ICON_PROFILES = {
  lucide: { pack: 'lucide', variant: 'outline' },
  phosphor: { pack: 'phosphor', variant: 'regular' },
  'phosphor-bold': { pack: 'phosphor', variant: 'bold' },
  'phosphor-fill': { pack: 'phosphor', variant: 'fill' },
  tabler: { pack: 'tabler', variant: 'outline' },
  pixelarticons: { pack: 'pixelarticons', variant: 'pixel' },
  codicons: { pack: 'codicons', variant: 'mono' },
} as const satisfies Record<string, IconProfile>;

export type IconProfileName = keyof typeof ICON_PROFILES;
export const ICON_PROFILE_NAMES = Object.keys(ICON_PROFILES) as IconProfileName[];
export const DEFAULT_ICON_PROFILE: IconProfileName = 'lucide';

export function isIconProfileName(value: unknown): value is IconProfileName {
  return typeof value === 'string' && Object.hasOwn(ICON_PROFILES, value);
}

/** The order other packs are tried in when the profile's pack lacks a concept. */
export const ICON_FALLBACK_ORDER: readonly IconPackId[] = [
  'lucide',
  'tabler',
  'phosphor',
  'codicons',
  'pixelarticons',
];
