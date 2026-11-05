import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUTLINE_FONTS } from '../../src/blocks/three/outline-fonts.generated.js';
import { export3dPosterSvg } from '../../src/blocks/three/poster-export.js';
import { textConfig } from '../../src/blocks/three/text-3d.js';
import { layoutText, missingGlyphs } from '../../src/blocks/three/text-layout.js';
import { riseEnd, unitPose } from '../../src/blocks/three/text-motion.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url), 'utf8');

const spec = (extra: Record<string, unknown> = {}) => ({
  version: 1,
  meta: { title: 'Text' },
  blocks: [{ type: 'text-3d', id: 't', text: 'Hello', ...extra }],
});

const diagnostics = (input: unknown) =>
  normalizeSpec(input).diagnostics.map((d) => `${d.severity} ${d.path}: ${d.message}`);

function config(extra: Record<string, unknown> = {}) {
  const node = normalizeSpec(spec(extra)).ir?.nodes.find((n) => n.type === 'text-3d');
  if (!node) throw new Error('no node');
  return textConfig(node);
}

describe('text-3d fonts', () => {
  it('bundles Latin, Latin Extended and Vietnamese outlines with kerning', () => {
    for (const font of Object.values(OUTLINE_FONTS)) {
      for (const ch of 'AZaz09ÀÿĀžĂăƠơƯưẠỹđ€') expect(font.glyphs[ch], ch).toBeDefined();
      expect(font.notdef[1]).toMatch(/^M/u);
      expect(Object.keys(font.kerning).length).toBeGreaterThan(1000);
    }
    expect(OUTLINE_FONTS.display.kerning.AV).toBeLessThan(0);
  });
});

describe('text-3d layout', () => {
  it('centres the ink box, kerns pairs and shares one outline per distinct glyph', () => {
    const layout = layoutText('AVA', 'display', 'character');
    expect(layout.glyphs).toHaveLength(2);
    expect(layout.units).toHaveLength(3);
    const plain = layoutText('AHA', 'display', 'character');
    expect(layout.width).toBeLessThan(plain.width);
    const xs = layout.units.map((u) => u.cx);
    expect((xs[0] ?? 0) + (xs[2] ?? 0)).toBeCloseTo(0, 1);
  });

  it('groups by word and stacks up to three lines', () => {
    expect(layoutText('Ship it now', 'display', 'word').units).toHaveLength(3);
    const two = layoutText('Open\nlate', 'serif', 'character');
    expect(two.lines).toEqual(['Open', 'late']);
    // One long line breaks at the space that balances its halves.
    expect(layoutText('Ship faster with every release', 'display', 'word').lines).toEqual([
      'Ship faster with',
      'every release',
    ]);
    expect(new Set(two.units.map((u) => u.cy)).size).toBe(2);
  });

  it('normalizes combining marks to the precomposed glyph and flags what no font draws', () => {
    const composed = layoutText('Café', 'serif', 'character');
    expect(composed.lines).toEqual(['Café']);
    expect(composed.missing).toEqual([]);
    expect(missingGlyphs('Tiếng Việt', OUTLINE_FONTS.display)).toEqual([]);
    const missing = layoutText('Hi 世界 ✓', 'display', 'character');
    expect(missing.missing).toEqual(['世', '界', '✓']);
    // Each missing character still takes a unit, drawn as the font's box.
    expect(missing.units).toHaveLength(5);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(config({ text: 'Tiếng Việt' }))).toBe(
      JSON.stringify(config({ text: 'Tiếng Việt' })),
    );
  });
});

describe('text-3d validation', () => {
  it('warns with the code points and a fix when a glyph is missing', () => {
    const found = normalizeSpec(spec({ text: 'Hi 世' })).diagnostics;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'warning', path: '$.blocks[0].text' });
    expect(found[0]?.message).toContain('U+4E16');
    expect(found[0]?.details).toMatchObject({ missing: ['U+4E16'] });
  });

  it('rejects blank text, more than three lines and unknown finishes', () => {
    expect(diagnostics(spec({ text: '   ' }))).toEqual([
      expect.stringContaining('needs text to draw'),
    ]);
    expect(diagnostics(spec({ text: 'a\nb\nc\nd' }))).toEqual([expect.stringContaining('4 lines')]);
    expect(diagnostics(spec({ material: 'gold' }))).toHaveLength(1);
    expect(diagnostics(spec({ depth: 2 }))).toHaveLength(1);
    expect(diagnostics(spec({ animation: 'wave', split: 'word', font: 'serif' }))).toEqual([]);
  });
});

describe('text-3d motion', () => {
  it('rests at the poster pose once a rise lands and when motion is none', () => {
    expect(unitPose('none', 3, 2, 5)).toEqual([0, 0, 0, 1]);
    expect(unitPose('rise', riseEnd(5), 4, 5).map((v) => v + 0)).toEqual([0, 0, 0, 1]);
    // Before its turn a unit is collapsed, so the entrance starts from nothing.
    expect(unitPose('rise', 0, 3, 5)[3]).toBeLessThan(0.01);
  });

  it('loops wave and spin and returns to rest between flips', () => {
    expect(unitPose('wave', 1, 0, 3)[0]).not.toBe(0);
    expect(unitPose('spin', 3, 0, 3)[2]).toBe(0);
    expect(unitPose('spin', 0.5, 0, 3)[2]).toBeGreaterThan(0);
  });
});

describe('text-3d render', () => {
  it('emits the same bytes twice, a labelled poster and no network reference', () => {
    const a = compile(fixture('text-3d-hero'), { source: 'hero' }).html;
    expect(compile(fixture('text-3d-hero'), { source: 'hero' }).html).toBe(a);
    expect(a).toContain('class="ak-3d-poster ak-tx-poster"');
    expect(a).toContain('aria-label="Ship it."');
    expect(a).not.toMatch(/https?:\/\/(?!www\.w3\.org)[^"' ]*\.(?:woff2?|ttf|otf|js)/u);
  });

  it('spells the text out in the caption when a glyph is missing', () => {
    const html = compile(fixture('text-3d-unicode'), { source: 'unicode' }).html;
    expect(html).toContain('<span class="ak-tx-copy" aria-hidden="true">Hi 世界 ✓</span>');
    expect(html.match(/class="ak-tx-copy"/gu)).toHaveLength(1);
  });

  it('exports a standalone poster with the lettering rules', () => {
    const svg = export3dPosterSvg(fixture('text-3d-hero'), { scheme: 'auto' });
    expect(svg).toContain('.ak-tx-poster[data-material="satin"]');
    expect(export3dPosterSvg(fixture('network-3d-basic'))).not.toContain('ak-tx-poster');
  });
});
