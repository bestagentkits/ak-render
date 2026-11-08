import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { export3dPosterSvg } from '../../src/index.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url), 'utf8');

describe('export3dPosterSvg', () => {
  it('returns a standalone, deterministic SVG of the first 3D poster', () => {
    const svg = export3dPosterSvg(fixture('network-3d-basic'));
    expect(
      svg.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"',
      ),
    ).toBe(true);
    expect(svg).toContain('class="ak-3d-poster ak-net-poster"');
    expect(svg).toContain('--ak-color-text:');
    expect(svg).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)/u);
    expect(export3dPosterSvg(fixture('network-3d-basic'))).toBe(svg);
  });

  it('hides labels and carries both palettes on request', () => {
    const svg = export3dPosterSvg(fixture('scatter-3d-basic'), { labels: false, scheme: 'auto' });
    expect(svg).toContain('text{display:none}');
    expect(svg).toContain('@media (prefers-color-scheme:dark){svg{');
  });

  it('carries a particle poster its own night sky in both schemes', () => {
    const svg = export3dPosterSvg(fixture('particles-3d-galaxy'), { scheme: 'auto' });
    expect(svg).toContain('class="ak-3d-poster ak-pt-poster"');
    expect(svg).toContain('.ak-pt-poster{background:');
    expect(svg.match(/--ak-pt-night:/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(svg).toContain('--ak-pt-ink:var(--ak-color-text)');
    // Other widgets' exports stay free of the particle rules.
    expect(export3dPosterSvg(fixture('network-3d-basic'))).not.toContain('--ak-pt-night');
  });

  it('carries a product plan its finishes, pins and shadow', () => {
    const svg = export3dPosterSvg(fixture('product-3d-speaker'), { scheme: 'auto' });
    expect(svg).toContain('class="ak-3d-poster ak-product-poster"');
    expect(svg).toContain('.ak-product-pin circle{');
    expect(svg).toContain('.ak-3d-mark[data-tone="dark"]{--ak-3d-tone:');
    expect(svg).toContain('.ak-product-poster .ak-3d-mark[data-tone="neutral"]');
    expect(svg.match(/class="ak-product-pin"/gu)?.length).toBe(6);
    // Standalone SVG is XML: every attribute carries a value.
    expect(svg).not.toMatch(/<[a-z]+(?:\s+[a-z-]+="[^"]*")*\s+[a-z-]+[\s/>]/u);
    expect(export3dPosterSvg(fixture('network-3d-basic'))).not.toContain('.ak-product-pin');
  });

  it('carries a morph drawing its shade steps and a soft, sharp-edged surface', () => {
    const svg = export3dPosterSvg(fixture('morph-3d-shapes'), { scheme: 'auto' });
    expect(svg).toContain('class="ak-3d-poster ak-mo-poster"');
    expect(svg).toContain('.ak-mo-surface [data-l="0"]{fill:');
    expect(svg).toContain('.ak-mo-outline{mask-type:alpha}');
    expect(svg).toContain('<use href="#ak-mo-faces-morph" filter="url(#ak-mo-soft-morph)"/>');
    // The target buttons' drawings stay with the page, not the poster.
    expect(svg).not.toContain('class="ak-mo-glyph"');
    expect(svg).not.toMatch(/<[a-z]+(?:\s+[a-z-]+="[^"]*")*\s+[a-z-]+[\s/>]/u);
    expect(export3dPosterSvg(fixture('network-3d-basic'))).not.toContain('.ak-mo-surface');
  });

  it('carries a terrain drawing its contour runs, pins and floor shadow', () => {
    const svg = export3dPosterSvg(fixture('terrain-3d-crater'), { scheme: 'auto' });
    expect(svg).toContain('class="ak-3d-poster ak-tr-poster"');
    expect(svg).toContain('.ak-tr-c{fill:none;');
    expect(svg).toContain('class="ak-3d-mark ak-tr-pin"');
    expect(svg).toContain('fill="url(#ak-tr-floor-crater)"');
    // The legend and the place list stay with the page, not the poster.
    expect(svg).not.toContain('class="ak-tr-ramp"');
    expect(svg).not.toContain('data-ak-terrain-mark');
    expect(export3dPosterSvg(fixture('network-3d-basic'))).not.toContain('.ak-tr-c{');
  }, 20_000);

  it('draws a box as shaded faces', () => {
    const svg = export3dPosterSvg(fixture('scene-3d-basic'));
    expect(svg).toContain('class="ak-3d-face"');
    expect(svg).toContain('<linearGradient id="ak-3d-sheen"');
  });

  it('names the block when it has no poster', () => {
    expect(() => export3dPosterSvg(fixture('scene-3d-basic'), { blockId: 'missing' })).toThrow(
      /block "missing" has no drawn 3D poster/u,
    );
  });
});
