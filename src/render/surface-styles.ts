/**
 * The night band: an inverse surface for sections and the closing CTA.
 *
 * Inside `[data-surface="inverse"]` the colour tokens are redeclared with the
 * theme's own dark values, so every block nested in the band (cards, code,
 * charts) recolours from tokens exactly as it does in dark mode. The values are
 * the validated theme colours themselves, written as literals: aliasing the
 * root variables would be cyclic, because the band redeclares those variables.
 *
 * The derived variables that `:root` computes once (`--ak-tint`, `--ak-ring`,
 * `--ak-fill`) are recomputed here too, since an inherited custom property
 * carries the root's light result, not its formula.
 *
 * This sheet is emitted only on pages that use the band, and it names no
 * feature marker (see `verify.ts`).
 */

import type { ResolvedTheme } from '../theme/load-theme.js';
import { TOKEN_SPECS, tokenVariable } from '../theme/tokens.js';
import { DARK_FILL, RING, TINT } from './derived-variables.js';

const UNIT = (factor: number): string => `calc(var(--ak-space-unit) * ${factor})`;

/** Colour tokens of the theme's dark scheme as declarations, in a stable order. */
function darkColorDeclarations(theme: ResolvedTheme): string {
  return Object.keys(theme.dark)
    .filter((token) => TOKEN_SPECS[token]?.kind === 'color')
    .sort()
    .map((token) => `${tokenVariable(token)}:${theme.dark[token]}`)
    .join(';');
}

// The same formulas dark mode uses, so the band matches it exactly.
const DERIVED = [TINT, RING, DARK_FILL, 'color-scheme:dark'].join(';');

/** True when any node on the page sits on the night band. */
export function usesInverseSurface(
  nodes: readonly { type: string; props: Record<string, unknown> }[],
): boolean {
  return nodes.some((node) => node.type === 'cta' || node.props.surface === 'inverse');
}

export function inverseSurfaceCss(theme: ResolvedTheme): string {
  return `[data-surface="inverse"]{${darkColorDeclarations(theme)};${DERIVED};position:relative;isolation:isolate;overflow:hidden;padding:${UNIT(7)} ${UNIT(5)};border-radius:calc(var(--ak-radius-large) * 1.6);border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-color-text) 10%,transparent);background:radial-gradient(70% 90% at 100% 0%,color-mix(in srgb,var(--ak-color-accent) 26%,transparent),transparent 70%),radial-gradient(60% 80% at 0% 100%,color-mix(in srgb,var(--ak-color-info) 14%,transparent),transparent 70%),linear-gradient(180deg,color-mix(in srgb,var(--ak-color-surface) 70%,var(--ak-color-background)),var(--ak-color-background));color:var(--ak-color-text);box-shadow:0 1px 0 color-mix(in srgb,#fff 8%,transparent) inset,0 40px 80px -40px color-mix(in srgb,var(--ak-color-background) 80%,transparent)}
[data-surface="inverse"]::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(color-mix(in srgb,var(--ak-color-text) 5%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--ak-color-text) 5%,transparent) 1px,transparent 1px);background-size:48px 48px;-webkit-mask-image:radial-gradient(90% 70% at 50% 0%,#000,transparent);mask-image:radial-gradient(90% 70% at 50% 0%,#000,transparent)}
[data-surface="inverse"] ::selection{background:color-mix(in srgb,var(--ak-color-accent) 40%,transparent)}
@media (max-width:768px){[data-surface="inverse"]{padding:${UNIT(5)} ${UNIT(3)};margin-inline:${UNIT(-1.5)}}}
@media print{[data-surface="inverse"]{box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}[data-surface="inverse"]::before{display:none}}`;
}
