/**
 * Embedded display faces.
 *
 * A theme opts into a bundled face by naming its namespaced family (for example
 * `AK Geist`) in a font stack. The compiler then inlines that family as a
 * `data:` WOFF2, so the artifact still opens offline and makes no request; the
 * CSP widens `font-src` to `data:` only on pages that carry a face.
 *
 * Each family ships two subsets. Latin is always emitted; Vietnamese is emitted
 * only when the page text uses a character the Latin subset lacks, so an English
 * page does not pay for it. A family no stack names is never emitted.
 */

import type { ResolvedTheme } from '../theme/load-theme.js';
import {
  EMBEDDED_FONTS,
  type EmbeddedFont,
  LATIN_RANGE,
  VIETNAMESE_RANGE,
} from './embedded-fonts.generated.js';

const STACK_TOKENS = ['font-heading', 'font-body', 'font-mono'] as const;

/**
 * Characters only the Vietnamese subset covers (its overlap with Latin removed).
 * The combining marks are alternatives, because a character class may not mix
 * them with base letters.
 */
// biome-ignore lint/complexity/useRegexLiterals: the autofix turns the escapes into raw combining marks.
const VIETNAMESE_ONLY = new RegExp(
  '[\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9\u20AB]|\u0300|\u0301|\u0303|\u0309|\u0323',
  'u',
);

function stackFamilies(stack: string): string[] {
  return stack.split(',').map((family) => family.trim().replace(/^["']|["']$/gu, ''));
}

/** Bundled families named by any of the theme's font stacks, in bundle order. */
export function embeddedFamilies(theme: ResolvedTheme): EmbeddedFont[] {
  const named = new Set<string>();
  for (const tokens of [theme.light, theme.dark]) {
    for (const token of STACK_TOKENS) {
      const stack = tokens[token];
      if (stack !== undefined) for (const family of stackFamilies(stack)) named.add(family);
    }
  }
  return EMBEDDED_FONTS.filter((font) => named.has(font.family));
}

function face(font: EmbeddedFont, data: string, range: string): string {
  return `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${font.weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${range}}`;
}

/**
 * The `@font-face` rules a page needs, or an empty string. `text` is the
 * rendered page text the faces must cover; it only decides the subsets.
 */
export function embeddedFontCss(theme: ResolvedTheme, text: string): string {
  const fonts = embeddedFamilies(theme);
  if (fonts.length === 0) return '';
  const vietnamese = VIETNAMESE_ONLY.test(text.normalize('NFC'));
  return fonts
    .map((font) =>
      [
        `/* ${font.name}: ${font.copyright}. SIL Open Font License 1.1, https://openfontlicense.org */`,
        face(font, font.latin, LATIN_RANGE),
        vietnamese ? face(font, font.vietnamese, VIETNAMESE_RANGE) : '',
      ]
        .filter((rule) => rule !== '')
        .join('\n'),
    )
    .join('\n');
}
