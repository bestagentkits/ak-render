/**
 * Icon emission.
 *
 * Each use is a small `<svg><use href="#id"/></svg>` pointing at a symbol in one
 * sprite at the end of the page. The sprite holds only the glyphs the page
 * resolved, once each, in sorted order, so the same spec always writes the same
 * bytes and a repeated icon costs one reference. Everything is same-document:
 * there is no fetch, no script and no inline style.
 */

import type { Diagnostic } from '../diagnostics.js';
import type { JsonValue } from '../json.js';
import { escapeAttribute } from '../render/escape.js';
import { type IconRequest, parseIconValue, profileOf, resolveIcon } from './icon-catalog.js';
import type { IconSize } from './icon-packs.js';

/** The glyphs a page used, keyed by symbol id. */
export type IconCollector = Map<string, { size: number; body: string }>;

export interface IconRenderContext {
  theme: { icons: string };
  icons: IconCollector;
  warnings?: Diagnostic[];
}

export interface IconRenderOptions {
  /** Size when the author did not choose one; the block decides what fits. */
  size: IconSize;
  /** JSON path of the icon prop, for diagnostics. */
  path: string;
  nodeId?: string;
  /** Extra class on the `<svg>`. */
  className?: string;
}

/**
 * Render one icon, or '' when the value does not resolve (validation has
 * already reported it). A label makes the icon a named image; without one it is
 * decorative and hidden from assistive technology.
 */
export function renderIcon(
  context: IconRenderContext,
  value: JsonValue | undefined,
  options: IconRenderOptions,
): string {
  if (value === undefined) return '';
  const parsed = parseIconValue(value);
  if (!parsed.ok) return '';
  const request: IconRequest = parsed.request;
  const profile = profileOf(context.theme.icons);
  const icon = resolveIcon(request, profile);
  if (icon === undefined) return '';
  if (icon.fallbackFrom !== undefined) {
    context.warnings?.push({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: options.path,
      ...(options.nodeId === undefined ? {} : { nodeId: options.nodeId }),
      message: `icon "${request.name}" is not in ${icon.fallbackFrom}; drawn with ${icon.pack} instead`,
      details: {
        icon: request.name,
        wanted: icon.fallbackFrom,
        used: icon.pack,
        glyph: icon.glyph,
      },
    });
  }
  context.icons.set(icon.symbolId, { size: icon.size, body: icon.body });
  const labelled =
    request.label === undefined
      ? ' aria-hidden="true" focusable="false"'
      : ` role="img" aria-label="${escapeAttribute(request.label)}"`;
  const classes = ['ak-icon', options.className].filter(Boolean).join(' ');
  return `<svg class="${classes}" data-size="${request.size ?? options.size}" data-pack="${icon.pack}"${labelled}><use href="#${icon.symbolId}"/></svg>`;
}

/** The sprite for the glyphs a page used; '' when it used none. */
export function renderIconSprite(icons: IconCollector): string {
  if (icons.size === 0) return '';
  const symbols = [...icons.keys()]
    .sort()
    .map((id) => {
      const entry = icons.get(id);
      if (entry === undefined) return '';
      return `<symbol id="${id}" viewBox="0 0 ${entry.size} ${entry.size}">${entry.body}</symbol>`;
    })
    .join('');
  return `<svg class="ak-icon-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" width="0" height="0">${symbols}</svg>`;
}

/**
 * Icon styles, emitted only when a page uses an icon. Sizes are em-based so an
 * icon scales with the text it sits in; colour is `currentColor` throughout, so
 * light, dark, print and forced-colors all follow the surrounding text.
 */
export const ICON_CSS = [
  '.ak-icon-sprite{position:absolute;width:0;height:0;overflow:hidden}',
  '.ak-icon{--ak-icon-size:1.25em;width:var(--ak-icon-size);height:var(--ak-icon-size);flex:none;vertical-align:-.25em;color:inherit;fill:currentColor}',
  '.ak-icon[data-size="xs"]{--ak-icon-size:.9em}',
  '.ak-icon[data-size="sm"]{--ak-icon-size:1.05em}',
  '.ak-icon[data-size="lg"]{--ak-icon-size:1.75em}',
  '.ak-icon[data-size="xl"]{--ak-icon-size:2.6em}',
  '.ak-icon[data-pack="pixelarticons"]{shape-rendering:crispEdges}',
  '.ak-icon-block{display:flex;align-items:center;gap:calc(var(--ak-space-unit) * 1.5);color:var(--ak-color-text)}',
  '.ak-icon-block .ak-icon{color:var(--ak-color-accent)}',
  '.ak-icon-block[data-tone="info"]{--ak-tone:var(--ak-color-info)}',
  '.ak-icon-block[data-tone="success"]{--ak-tone:var(--ak-color-success)}',
  '.ak-icon-block[data-tone="warning"]{--ak-tone:var(--ak-color-warning)}',
  '.ak-icon-block[data-tone="danger"]{--ak-tone:var(--ak-color-danger)}',
  '.ak-icon-block[data-tone] .ak-icon{color:var(--ak-tone)}',
  '.ak-callout:has(.ak-label > .ak-icon)::before,.ak-alert:has(> p > .ak-icon)::before{display:none}',
  '.ak-callout:has(.ak-label > .ak-icon),.ak-alert:has(> p > .ak-icon){padding-inline-start:calc(var(--ak-space-unit) * 3)}',
  '.ak-card-icon{display:inline-flex;align-items:center;justify-content:center;width:calc(var(--ak-space-unit) * 5.5);height:calc(var(--ak-space-unit) * 5.5);margin-bottom:calc(var(--ak-space-unit) * 1.5);border-radius:var(--ak-radius-medium);color:var(--ak-color-accent);background:color-mix(in srgb,var(--ak-color-accent) 12%,transparent)}',
  '.ak-stat dt:has(> .ak-icon)::before{display:none}',
  '.ak-stat dt > .ak-icon,.ak-steps .ak-icon,.ak-timeline .ak-icon{color:var(--ak-color-accent)}',
  '.ak-steps .ak-icon,.ak-timeline .ak-icon{margin-inline-end:.4em}',
  '.ak-callout .ak-label .ak-icon,.ak-alert .ak-icon{color:var(--ak-tone)}',
  '.ak-label .ak-icon{margin-inline-end:.45em;vertical-align:-.3em}',
  '.ak-btn .ak-icon{--ak-icon-size:1.15em;vertical-align:middle}',
].join('\n');
