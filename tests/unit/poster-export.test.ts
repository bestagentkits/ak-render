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
