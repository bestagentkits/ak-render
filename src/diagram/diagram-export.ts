/**
 * Static diagram export: one diagram-panel's drawing as a standalone SVG file.
 *
 * The export comes from the compiled page, so it is the same drawing the
 * reader sees, with its ids scoped, its labels from the spec and its
 * stylesheet filtered. It is taken at compile time, before any runtime has
 * touched it, so no animation, dimming or zoom can leak into the snapshot.
 * The theme's colour tokens are written onto the root element, which keeps
 * the drawing legible when it opens outside the page; `scheme` picks light or
 * dark. The output is deterministic and offline: it is the drawing and its
 * own `<style>`, with the page nonce removed.
 */

import { RenderError } from '../errors.js';
import { compile, type RenderOptions } from '../render/render.js';

export interface DiagramSvgOptions extends RenderOptions {
  /** The diagram-panel's `id`; the first diagram on the page when omitted. */
  blockId?: string;
  /** Which theme colours the file carries. */
  scheme?: 'light' | 'dark';
}

function escapeAttribute(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;');
}

/** Returns the standalone SVG of one contract 2 diagram on the page. */
export function exportDiagramSvg(spec: unknown, options: DiagramSvgOptions = {}): string {
  const { blockId, scheme = 'light', ...renderOptions } = options;
  const result = compile(spec, renderOptions);
  const html = result.html;
  const figureAt =
    blockId === undefined
      ? html.indexOf('class="ak-block ak-diagram"')
      : html.indexOf(`data-ak-id="${escapeAttribute(blockId)}"`);
  const canvasAt = figureAt === -1 ? -1 : html.indexOf('data-ak-diagram-contract="2"', figureAt);
  const nextFigure = figureAt === -1 ? -1 : html.indexOf('<figure', figureAt + 1);
  if (canvasAt === -1 || (nextFigure !== -1 && canvasAt > nextFigure)) {
    throw new RenderError(
      'SPEC_VALIDATION_ERROR',
      blockId === undefined
        ? 'the page has no diagram drawn by a contract 2 adapter to export'
        : `block "${blockId}" has no diagram drawn by a contract 2 adapter to export`,
      { path: blockId === undefined ? '$.blocks' : `$.blocks.${blockId}` },
    );
  }
  const start = html.indexOf('<svg', canvasAt);
  // Balance nested <svg> so an adapter's inner viewport cannot end the drawing early.
  const tag = /<svg[\s>]|<\/svg>/gu;
  tag.lastIndex = start;
  let depth = 0;
  let end = start;
  for (let match = tag.exec(html); match !== null; match = tag.exec(html)) {
    depth += match[0] === '</svg>' ? -1 : 1;
    if (depth === 0) {
      end = match.index + 6;
      break;
    }
  }
  const svg = html
    .slice(start, end)
    .replace(/ nonce="[^"]*"/gu, '')
    .replace(/<script[\s\S]*?<\/script>/gu, '')
    .replace(/ on[a-z]+="[^"]*"/gu, '');
  const tokens = (scheme === 'dark' ? result.theme.dark : result.theme.light) as Record<
    string,
    string | undefined
  >;
  const variables = Object.keys(tokens)
    .filter((name) => name.startsWith('color-'))
    .sort()
    .map((name) => `--ak-${name}:${tokens[name]}`)
    .join(';');
  const colour = tokens['color-text'] ?? (scheme === 'dark' ? '#eee' : '#111');
  const background =
    tokens['color-surface'] ?? tokens['color-bg'] ?? (scheme === 'dark' ? '#111' : '#fff');
  // The page scopes adapter styles to its canvas with @scope, which has no
  // root outside the page; the rules apply unscoped to this lone drawing.
  const unscoped = svg.replace(/@scope \([^)]*\)\{([\s\S]*?)\}<\/style>/gu, '$1</style>');
  const namespaced = /^<svg[^>]* xmlns="/u.test(unscoped)
    ? unscoped
    : unscoped.replace(/^<svg/u, '<svg xmlns="http://www.w3.org/2000/svg"');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${namespaced.replace(
    /^<svg/u,
    `<svg style="${escapeAttribute(`${variables};color:${colour};background:${background}`)}"`,
  )}\n`;
}
