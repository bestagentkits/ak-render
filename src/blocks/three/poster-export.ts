/**
 * Static 3D poster export: one 3D block's compile-time SVG plan as a
 * standalone file, for previews, cards and docs.
 *
 * The poster is the same drawing a reader sees with no JavaScript, no WebGL
 * or in print. It is cut from the compiled page, so it always agrees with the
 * page, and it carries its own `<style>`: the 3D poster rules plus the theme's
 * colour tokens for the chosen `scheme`. `labels: false` hides every text
 * label, for previews too small to read them. The output is deterministic and
 * offline.
 */

import { RenderError } from '../../errors.js';
import { escapeAttribute } from '../../render/escape.js';
import { compile, type RenderOptions } from '../../render/render.js';
import { GLOBE_CSS } from './globe-styles.js';
import { MORPH_CSS } from './morph-styles.js';
import { NETWORK_CSS } from './network-styles.js';
import { PARTICLES_CSS, particleSchemeVars } from './particles-styles.js';
import { PRODUCT_CSS } from './product-styles.js';
import { SCATTER_CSS } from './scatter-styles.js';
import { SHADER_CSS, shaderSchemeVars } from './shader-styles.js';
import { TERRAIN_CSS } from './terrain-styles.js';
import { TEXT_CSS } from './text-styles.js';
import { THREE_CSS } from './three-styles.js';
import { TIMELINE_CSS } from './timeline-styles.js';

export interface PosterSvgOptions extends RenderOptions {
  /** The 3D block's `id`; the first 3D block on the page when omitted. */
  blockId?: string;
  /**
   * Which theme colours the file carries; `auto` carries both and follows the
   * viewer's `prefers-color-scheme`.
   */
  scheme?: 'light' | 'dark' | 'auto';
  /** Draw the text labels; off for thumbnails too small to read them. */
  labels?: boolean;
}

/** Returns the standalone SVG poster of one 3D block on the page. */
export function export3dPosterSvg(spec: unknown, options: PosterSvgOptions = {}): string {
  const { blockId, scheme = 'light', labels = true, ...renderOptions } = options;
  const result = compile(spec, renderOptions);
  const html = result.html;
  const blockAt =
    blockId === undefined
      ? html.indexOf('class="ak-block ak-3d')
      : html.indexOf(`data-ak-id="${escapeAttribute(blockId)}"`);
  const start = blockAt === -1 ? -1 : html.indexOf('<svg class="ak-3d-poster', blockAt);
  const nextBlock = blockAt === -1 ? -1 : html.indexOf('<figure', blockAt + 1);
  if (start === -1 || (nextBlock !== -1 && start > nextBlock)) {
    throw new RenderError(
      'SPEC_VALIDATION_ERROR',
      blockId === undefined
        ? 'the page has no 3D block with a drawn poster to export'
        : `block "${blockId}" has no drawn 3D poster to export`,
      { path: blockId === undefined ? '$.blocks' : `$.blocks.${blockId}` },
    );
  }
  // Posters never nest an <svg>, so the first close ends the drawing.
  const svg = html.slice(start, html.indexOf('</svg>', start) + 6);
  // A particle poster draws its own night sky, whose tones follow the scheme.
  const particles = /^<svg[^>]*\bclass="[^"]*\bak-pt-poster\b/u.test(svg);
  // So does a shader poster.
  const shader = /^<svg[^>]*\bclass="[^"]*\bak-sh-poster\b/u.test(svg);
  const lettering = /^<svg[^>]*\bclass="[^"]*\bak-tx-poster\b/u.test(svg);
  // A product plan needs its neutral finishes, pins and contact shadow.
  const product = /^<svg[^>]*\bclass="[^"]*\bak-product-poster\b/u.test(svg);
  // A globe needs its ocean, glow, land dots and arcs.
  const globe = /^<svg[^>]*\bclass="[^"]*\bak-globe-poster\b/u.test(svg);
  // A morph drawing needs its shade steps and floor shadow.
  const morph = /^<svg[^>]*\bclass="[^"]*\bak-mo-poster\b/u.test(svg);
  // A timeline drawing needs its path, stems, shadows, halo and tags.
  const timeline = /^<svg[^>]*\bclass="[^"]*\bak-tl-poster\b/u.test(svg);
  // A terrain drawing needs its contour runs, pins and floor shadow.
  const terrain = /^<svg[^>]*\bclass="[^"]*\bak-tr-poster\b/u.test(svg);
  const palette = (which: 'light' | 'dark'): string => {
    const tokens = result.theme[which] as Record<string, string | undefined>;
    const variables = Object.keys(tokens)
      .filter((name) => name.startsWith('color-'))
      .sort()
      .map((name) => `--ak-${name}:${tokens[name]}`);
    if (particles) variables.push(particleSchemeVars(which));
    if (shader) variables.push(shaderSchemeVars(which));
    return `svg{--ak-font-body:system-ui,sans-serif;${variables.join(';')};color:${tokens['color-text'] ?? 'inherit'}}`;
  };
  const colours =
    scheme === 'auto'
      ? `${palette('light')}@media (prefers-color-scheme:dark){${palette('dark')}}`
      : palette(scheme);
  const style = `${colours}${THREE_CSS}${NETWORK_CSS}${SCATTER_CSS}${particles ? PARTICLES_CSS : ''}${shader ? SHADER_CSS : ''}${product ? PRODUCT_CSS : ''}${lettering ? TEXT_CSS : ''}${morph ? MORPH_CSS : ''}${globe ? GLOBE_CSS : ''}${terrain ? TERRAIN_CSS : ''}${timeline ? TIMELINE_CSS : ''}${labels ? '' : 'text{display:none}'}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg.replace(
    /^<svg([^>]*)>/u,
    `<svg xmlns="http://www.w3.org/2000/svg"$1><style>${style}</style>`,
  )}\n`;
}
