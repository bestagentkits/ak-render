/**
 * Per-feature stylesheets.
 *
 * The compiler emits a sheet here only when the page uses that feature, and
 * `verify.ts` checks the marker selector in both directions, so selectors for a
 * feature must stay in its own entry and never move into `BASE_CSS`.
 *
 * Shared vocabulary from the base sheet: `--ak-transition` for every state
 * change, `--ak-fill` for surface backgrounds (a top-lit sheen in dark mode),
 * `--ak-tint` for hover washes and `--ak-ring` for focus halos on inputs.
 */

import { CHART_CSS } from '../blocks/chart/chart-styles.js';
import { ACCORDION_CSS, CAROUSEL_CSS, TABS_CSS } from '../blocks/composition/composition-styles.js';
import type { RuntimeFeature } from '../registry/roster.js';
import { scrollEdges } from './derived-variables.js';
import { SHOWCASE_CSS } from './showcase-styles.js';
import { disclosureSummary, TRANSITION } from './style-units.js';

/**
 * Selectors for a block that follows a visible block across `visibleWhen`
 * wrappers: a block inside a wrapper with a visible block or wrapper before it,
 * and a block after a visible wrapper (or after a hidden one that itself
 * follows a block). `scope` prefixes the parent, as in `.ak-section > `.
 */
function whenGapTargets(target: string, scope = ''): string {
  const before = ':where(.ak-block,.ak-when:not([hidden]))';
  const wrapperBefore = ':where(.ak-when:not([hidden]),.ak-block ~ .ak-when)';
  return [`${scope}${before} ~ .ak-when > ${target}`, `${scope}${wrapperBefore} ~ ${target}`].join(
    ',',
  );
}

export const FEATURE_CSS: Readonly<Partial<Record<RuntimeFeature, string>>> = {
  ...SHOWCASE_CSS,
  tabs: TABS_CSS,

  accordion: ACCORDION_CSS,

  carousel: CAROUSEL_CSS,

  slider: `.ak-slider{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:.6em var(--ak-space-unit);max-width:440px}
.ak-slider label{font-weight:550}
.ak-slider input[type="range"]{grid-column:1 / -1;width:100%;margin:0;accent-color:var(--ak-color-accent);min-height:28px;cursor:pointer}
.ak-slider output{grid-row:1;grid-column:2;min-width:2.5em;padding:.15em .6em;text-align:center;border-radius:999px;background:var(--ak-tint);border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-color-accent) 25%,var(--ak-color-border));font-family:var(--ak-font-mono);font-size:.8rem;color:var(--ak-color-accent);font-variant-numeric:tabular-nums}
@media (max-width:768px){.ak-slider input[type="range"]{min-height:44px}}`,

  dialog: `dialog.ak-dialog{width:min(560px,calc(100vw - 32px));max-width:none;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:var(--ak-fill);color:var(--ak-color-text);padding:calc(var(--ak-space-unit) * 3.5);box-shadow:var(--ak-elevation-popover)}
dialog.ak-dialog::backdrop{background:color-mix(in srgb,var(--ak-color-background) 62%,transparent);backdrop-filter:blur(8px) saturate(.9)}
dialog.ak-dialog[open]{animation:ak-rise calc(var(--ak-motion-duration) * 1.5) var(--ak-motion-easing)}
@keyframes ak-rise{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.ak-dialog-title{margin-bottom:var(--ak-space-unit)}
.ak-dialog-title h2{font-size:calc(var(--ak-font-size-base) * 1.4);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),1.5))}
dialog.ak-dialog > p{color:var(--ak-color-text-muted)}
.ak-dialog-actions{display:flex;flex-wrap:wrap;gap:var(--ak-space-unit);justify-content:flex-end;margin:calc(var(--ak-space-unit) * 3) calc(var(--ak-space-unit) * -3.5) calc(var(--ak-space-unit) * -3.5);padding:calc(var(--ak-space-unit) * 2) calc(var(--ak-space-unit) * 3.5);border-top:var(--ak-border-width) solid var(--ak-color-border);background:color-mix(in srgb,var(--ak-color-text) 3%,transparent);border-radius:0 0 var(--ak-radius-large) var(--ak-radius-large)}`,

  chart: CHART_CSS,

  filter: `.ak-search{display:flex;flex-direction:column;gap:.5em;max-width:420px}
.ak-search label{font-weight:550}
.ak-search input{font:inherit;min-height:44px;padding:.55em .95em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface);color:var(--ak-color-text);box-shadow:inset 0 1px 2px color-mix(in srgb,var(--ak-color-text) 6%,transparent);${TRANSITION}}
.ak-search input::placeholder{color:var(--ak-color-text-muted);opacity:.85}
.ak-search input:hover{border-color:color-mix(in srgb,var(--ak-color-text) 30%,var(--ak-color-border))}
.ak-search input:focus-visible{outline:0;border-color:var(--ak-color-accent);box-shadow:var(--ak-ring)}`,

  syntax: `.ak-tk-k{color:var(--ak-color-accent);font-weight:600}
.ak-tk-s,.ak-tk-ins{color:var(--ak-color-success)}
.ak-tk-n,.ak-tk-a{color:var(--ak-color-warning)}
.ak-tk-t,.ak-tk-hunk{color:var(--ak-color-info)}
.ak-tk-f{color:color-mix(in srgb,var(--ak-color-accent) 55%,var(--ak-color-text))}
.ak-tk-v,.ak-tk-del{color:var(--ak-color-danger)}
.ak-tk-c{color:var(--ak-color-text-muted);font-style:italic}
.ak-tk-meta{color:var(--ak-color-text-muted);font-weight:600}`,

  theme: `.ak-theme-toggle{min-height:34px;padding:.35em .9em;font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted);border-radius:999px;background:var(--ak-color-surface)}
.ak-theme-toggle::before{content:"";width:.75em;height:.75em;border-radius:50%;background:linear-gradient(90deg,currentColor 50%,transparent 50%);box-shadow:inset 0 0 0 1.5px currentColor;${TRANSITION}}
.ak-theme-toggle:hover{color:var(--ak-color-text)}
.ak-theme-toggle[aria-pressed="true"]::before{transform:rotate(180deg)}
@keyframes ak-reveal{from{clip-path:circle(0 at var(--ak-vt-x,100%) var(--ak-vt-y,0))}to{clip-path:circle(150vmax at var(--ak-vt-x,100%) var(--ak-vt-y,0))}}
@media (prefers-reduced-motion:no-preference){::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}::view-transition-new(root){animation:ak-reveal .75s cubic-bezier(.16,1,.3,1)}}
@media (max-width:768px){.ak-theme-toggle{min-height:44px}}`,

  media: `.ak-media-fallback{display:flex;flex-direction:column;align-items:flex-start;gap:.5em;background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 2.5)}
.ak-media-fallback p{margin:0}
.ak-media-fallback img{width:100%;max-width:100%;border-radius:var(--ak-radius-small);margin-bottom:calc(var(--ak-space-unit) * 1)}
.ak-media-fallback > p:first-of-type:has(strong){font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.1)}
.ak-media-fallback .ak-caption{display:inline-flex;align-items:center;gap:.5em;font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.04em}
.ak-media-fallback .ak-caption::before{content:"";width:.5em;height:.5em;border-radius:50%;background:var(--ak-color-warning)}
.ak-media-fallback > a{display:inline-flex;align-items:center;gap:.35em;margin-top:.35em;font-weight:550}
.ak-media-fallback > a::after{content:"\\2197";text-decoration:none}`,

  outline: `.ak-toc{display:none;font-size:.84rem}
.ak-toc-title{margin:0 0 .9em;font-family:var(--ak-font-mono);font-size:.68rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ak-color-text-muted)}
.ak-toc ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;border-left:var(--ak-border-width) solid var(--ak-color-border)}
.ak-toc a{display:block;margin-left:calc(var(--ak-border-width) * -1);padding:.42em 0 .42em 1.1em;border-left:2px solid transparent;color:var(--ak-color-text-muted);text-decoration:none;line-height:1.4;${TRANSITION}}
.ak-toc a:hover{color:var(--ak-color-text);border-left-color:color-mix(in srgb,var(--ak-color-text) 30%,transparent)}
.ak-toc a[aria-current]{color:var(--ak-color-accent);border-left-color:var(--ak-color-accent);font-weight:600}
@media (min-width:1280px){.ak-shell--outline{max-width:1400px;display:grid;grid-template-columns:minmax(0,1fr) 216px;column-gap:calc(var(--ak-space-unit) * 8);align-items:start}.ak-shell--outline > *{grid-column:1}.ak-shell--outline > .ak-toc{display:block;grid-column:2;grid-row:1 / span 2;position:sticky;top:calc(var(--ak-space-unit) * 4);max-height:calc(100vh - var(--ak-space-unit) * 8);overflow-y:auto;padding-top:calc(var(--ak-space-unit) * 1)}}
@media print{.ak-toc{display:none!important}}`,
  // A `visibleWhen` wrapper adds no box of its own; `hidden` must win over any
  // display a block sets, and the compiler already emitted the initial view.
  // Because the wrapper is not a block, the base `.ak-block + .ak-block` gap
  // skips it: these rules restore the gap (and the section-break gaps) for a
  // block inside a wrapper and for a block after one, whenever a visible block
  // comes earlier. They stay at low specificity, so the base resets of flex and
  // grid containers keep winning.
  state: `.ak-when{display:contents}
.ak-when[hidden]{display:none!important}
${whenGapTargets('.ak-block')}{margin-top:var(--ak-gap)}
${whenGapTargets('.ak-block:has(> .ak-section-head)', '.ak-section > ')}{margin-top:calc(var(--ak-gap) * 1.75)}
${whenGapTargets('.ak-block:is(.ak-section,:has(> .ak-section-head))', '.ak-main > ')}{margin-top:calc(var(--ak-gap) * 2.5)}
:where(.ak-stack,.ak-grid,.ak-split) > .ak-when > .ak-block{margin-top:0}`,
  diagram: `.ak-diagram{min-width:0}
.ak-diagram-rendered{overflow-x:auto;overscroll-behavior-x:contain;contain:paint;padding:calc(var(--ak-space-unit) * 2);background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);box-shadow:var(--ak-elevation-card)}
${scrollEdges('.ak-diagram-rendered')}
.ak-diagram-rendered svg{display:block;max-width:none;height:auto}
.ak-diagram-details{margin-top:calc(var(--ak-space-unit) * 1.5)}
${disclosureSummary('.ak-diagram-details')}
@media (max-width:768px){.ak-diagram-details summary{min-height:44px}}
@media print{.ak-diagram-rendered{overflow:visible;box-shadow:none}.ak-diagram-rendered svg{max-width:100%}.ak-diagram-details::details-content{content-visibility:visible;display:block}.ak-diagram-details summary::before{display:none}}
@media (prefers-reduced-motion:reduce),print{.ak-diagram-canvas,.ak-diagram-canvas *{animation:none!important;transition:none!important}}
[data-motion="none"] .ak-diagram-canvas,[data-motion="none"] .ak-diagram-canvas *{animation:none!important;transition:none!important}
.ak-diagram-fallback{display:flex;flex-direction:column;gap:var(--ak-space-unit);background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 3);box-shadow:var(--ak-elevation-card)}
.ak-diagram-fallback{gap:calc(var(--ak-space-unit) * 2)}
.ak-diagram-fallback > .ak-caption{font-size:.74rem;color:var(--ak-color-text-muted)}
.ak-diagram-title{margin:0;font-family:var(--ak-font-mono);font-size:.7rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ak-color-text-muted)}
.ak-flow{list-style:none;margin:0;padding:calc(var(--ak-space-unit) * 1) 0;display:flex;align-items:center;overflow-x:auto}
.ak-flow > li{display:flex;align-items:center;flex:1 1 auto;min-width:0}
.ak-flow > li:last-child{flex:0 0 auto}
.ak-flow-node{flex:none;display:flex;flex-direction:column;gap:.3em;min-width:9rem;padding:calc(var(--ak-space-unit) * 1.75) calc(var(--ak-space-unit) * 2.25);background:var(--ak-color-surface);border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-color-text) 14%,var(--ak-color-border));border-radius:var(--ak-radius-medium);box-shadow:var(--ak-elevation-card);${TRANSITION}}
.ak-flow-name{font-family:var(--ak-font-heading);font-weight:600;line-height:1.25;color:var(--ak-color-text)}
.ak-flow-node code{align-self:flex-start;padding:0;background:none;border:0;font-size:.72rem;color:var(--ak-color-text-muted)}
.ak-flow > li:first-child .ak-flow-node{border-color:color-mix(in srgb,var(--ak-color-accent) 45%,var(--ak-color-border))}
.ak-flow > li:last-child .ak-flow-node{background:color-mix(in srgb,var(--ak-color-accent) 9%,var(--ak-color-surface));border-color:var(--ak-color-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--ak-color-accent) 12%,transparent),var(--ak-elevation-card)}
.ak-flow-node:hover{border-color:var(--ak-color-accent)}
.ak-flow-edge{position:relative;flex:1;min-width:7rem;height:2.75rem;margin:0 .4rem}
.ak-flow-edge::before{content:"";position:absolute;left:0;right:6px;top:50%;height:1.5px;background:linear-gradient(90deg,color-mix(in srgb,var(--ak-color-text) 22%,var(--ak-color-border)),var(--ak-color-accent))}
.ak-flow-edge::after{content:"";position:absolute;right:0;top:50%;transform:translateY(-50%);border-left:7px solid var(--ak-color-accent);border-top:4.5px solid transparent;border-bottom:4.5px solid transparent}
.ak-flow-edge-label{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:calc(100% - 1.5rem);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:.2em .7em;background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:999px;font-family:var(--ak-font-mono);font-size:.66rem;letter-spacing:.03em;color:var(--ak-color-text-muted)}
.ak-flow-nodes{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:calc(var(--ak-space-unit) * 1.5)}
.ak-flow-links{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.ak-flow-links li{display:flex;flex-wrap:wrap;align-items:center;gap:.6em;padding:.65em 0;border-top:var(--ak-border-width) solid var(--ak-color-border)}
.ak-flow-arrow{color:var(--ak-color-accent);font-weight:600}
.ak-flow-link-label{margin-left:auto;font-size:.88rem;color:var(--ak-color-text-muted)}
@media (max-width:640px){.ak-flow{flex-direction:column;align-items:stretch}.ak-flow > li{flex-direction:column;align-items:stretch}.ak-flow-edge{flex:none;min-width:0;height:3.25rem;margin:.25rem 0}.ak-flow-edge::before{left:50%;right:auto;top:0;bottom:6px;width:1.5px;height:auto;background:linear-gradient(180deg,color-mix(in srgb,var(--ak-color-text) 22%,var(--ak-color-border)),var(--ak-color-accent))}.ak-flow-edge::after{right:auto;left:50%;top:auto;bottom:0;transform:translateX(-50%);border-left:4.5px solid transparent;border-right:4.5px solid transparent;border-top:7px solid var(--ak-color-accent);border-bottom:0}}`,
};
