/**
 * Text 3D layout: shapes a string into positioned glyph outlines from a
 * bundled OFL font, at compile time, so the live view and the poster place
 * every glyph identically and the page carries only the outlines it uses.
 *
 * Units are ems: one em is the font size. Glyph paths stay in font units
 * (y up); `unitsPerEm` scales them.
 */

import { OUTLINE_FONTS, type OutlineFont } from './outline-fonts.generated.js';

export const TEXT_FONTS = ['display', 'serif'] as const;
export type TextFont = (typeof TEXT_FONTS)[number];
export const TEXT_MATERIALS = ['satin', 'metal', 'chrome', 'glass', 'neon'] as const;
export const TEXT_BEVELS = ['none', 'soft', 'round'] as const;
export const TEXT_MOTIONS = ['rise', 'wave', 'float', 'spin', 'none'] as const;
export const TEXT_SPLITS = ['character', 'word'] as const;

export const MAX_TEXT_LENGTH = 80;
export const MAX_TEXT_LINES = 3;
/** Distance between baselines, in ems. */
export const LINE_HEIGHT = 1.12;

/** A drawn unit (a character or a word) that moves as one; it turns about `[cx, cy]`. */
export interface TextUnit {
  readonly cx: number;
  readonly cy: number;
  /** Each glyph: index into `glyphs` and its pen position relative to the unit centre. */
  readonly items: readonly (readonly [glyph: number, x: number, y: number])[];
}

export interface TextLayout {
  readonly font: TextFont;
  readonly unitsPerEm: number;
  /** Unique outlines, in font units (y up). */
  readonly glyphs: readonly string[];
  readonly units: readonly TextUnit[];
  /** The ink box of the whole text in ems, y up, centred on the origin. */
  readonly width: number;
  readonly height: number;
  /** Characters the font has no outline for, each once, in order of appearance. */
  readonly missing: readonly string[];
  readonly lines: readonly string[];
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Every space separator advances like a space; it draws nothing. */
const isSpace = (ch: string) => /^[\p{Zs}\t]$/u.test(ch);
/** Format and control characters (other than the line break) take no room and draw nothing. */
const isInvisible = (ch: string) => /^[\p{Cc}\p{Cf}]$/u.test(ch);

/**
 * NFC first, so a base letter plus combining marks becomes the precomposed
 * letter the font draws; CRLF and lone CR are line breaks.
 */
export function textLines(text: string): string[] {
  return text.normalize('NFC').replace(/\r\n?/gu, '\n').split('\n');
}

/** The characters in `text` the font cannot draw, each once. */
export function missingGlyphs(text: string, font: OutlineFont): string[] {
  const missing = new Set<string>();
  for (const line of textLines(text)) {
    for (const ch of line) {
      if (isSpace(ch) || isInvisible(ch)) continue;
      if (!font.glyphs[ch]) missing.add(ch);
    }
  }
  return [...missing];
}

export const fontOf = (id: TextFont): OutlineFont => OUTLINE_FONTS[id];

/** `U+00E9` style code points, for diagnostics. */
export const codePoint = (ch: string) =>
  `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Lays out `text` centred on the origin. Characters the font lacks draw its
 * missing-glyph box, so the gap stays visible instead of closing silently.
 */
export function layoutText(
  text: string,
  fontId: TextFont,
  split: 'character' | 'word',
): TextLayout {
  const font = fontOf(fontId);
  const em = font.unitsPerEm;
  const lines = textLines(text).slice(0, MAX_TEXT_LINES);
  const glyphIndex = new Map<string, number>();
  const glyphs: string[] = [];
  const spaceAdvance = (font.glyphs[' ']?.[0] ?? em * 0.25) / em;
  const ascent = 0.72;
  const descent = 0.2;
  type Placed = { glyph: number; x: number; advance: number; word: number };
  const placedLines: { placed: Placed[]; width: number }[] = [];
  let word = 0;
  for (const line of lines) {
    const placed: Placed[] = [];
    let pen = 0;
    let previous = '';
    let inWord = false;
    for (const ch of line) {
      if (isInvisible(ch)) continue;
      if (isSpace(ch)) {
        pen += spaceAdvance;
        previous = '';
        if (inWord) word += 1;
        inWord = false;
        continue;
      }
      inWord = true;
      const outline = font.glyphs[ch] ?? font.notdef;
      pen += (font.kerning[previous + ch] ?? 0) / em;
      const key = font.glyphs[ch] ? ch : '\u0000notdef';
      let index = glyphIndex.get(key);
      if (index === undefined) {
        index = glyphs.length;
        glyphs.push(outline[1]);
        glyphIndex.set(key, index);
      }
      const advance = outline[0] / em;
      placed.push({ glyph: index, x: pen, advance, word });
      pen += advance;
      previous = ch;
    }
    if (inWord) word += 1;
    // A trailing space adds no ink, so the line's width ends at its last glyph.
    const last = placed[placed.length - 1];
    placedLines.push({ placed, width: last ? last.x + last.advance : 0 });
  }
  const width = Math.max(0, ...placedLines.map((l) => l.width));
  const blockHeight = (lines.length - 1) * LINE_HEIGHT + ascent + descent;
  // Baseline of the first line, so the block's ink box is centred vertically.
  const top = blockHeight / 2 - ascent;
  const units: TextUnit[] = [];
  placedLines.forEach(({ placed, width: lineWidth }, row) => {
    const offset = -lineWidth / 2;
    const baseline = top - row * LINE_HEIGHT;
    const cy = baseline + (ascent - descent) / 2;
    const groups = new Map<number, Placed[]>();
    placed.forEach((p, i) => {
      const key = split === 'word' ? p.word : i;
      const members = groups.get(key) ?? [];
      members.push(p);
      groups.set(key, members);
    });
    for (const members of groups.values()) {
      const first = members[0] as Placed;
      const end = members[members.length - 1] as Placed;
      const cx = offset + (first.x + end.x + end.advance) / 2;
      units.push({
        cx: round(cx),
        cy: round(cy),
        items: members.map(
          (m) => [m.glyph, round(offset + m.x - cx), round(baseline - cy)] as const,
        ),
      });
    }
  });
  return {
    font: fontId,
    unitsPerEm: em,
    glyphs,
    units,
    width: round(width),
    height: round(blockHeight),
    missing: missingGlyphs(lines.join('\n'), font),
    lines,
  };
}
