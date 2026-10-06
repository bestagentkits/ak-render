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

import type { RuntimeFeature } from '../registry/roster.js';
import { scrollEdges } from './derived-variables.js';
import { SHOWCASE_CSS } from './showcase-styles.js';

const TRANSITION = 'transition:var(--ak-transition)';

/**
 * The quiet disclosure summary: a mono label with a chevron that turns when the
 * `<details>` opens. A chart's data table and an adapter diagram's text
 * description both sit behind one.
 */
function disclosureSummary(details: string): string {
  return `${details} summary{display:inline-flex;align-items:center;gap:.55em;cursor:pointer;list-style:none;font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted);${TRANSITION}}
${details} summary::-webkit-details-marker{display:none}
${details} summary::before{content:"";width:.42em;height:.42em;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);${TRANSITION}}
${details}[open] summary::before{transform:rotate(45deg)}
${details} summary:hover{color:var(--ak-color-accent)}
${details}[open] summary{margin-bottom:calc(var(--ak-space-unit) * 1.5)}`;
}

export const FEATURE_CSS: Readonly<Partial<Record<RuntimeFeature, string>>> = {
  ...SHOWCASE_CSS,
  tabs: `.ak-tabs [role="tablist"]{display:inline-flex;flex-wrap:wrap;gap:3px;max-width:100%;padding:3px;margin-bottom:calc(var(--ak-space-unit) * 2);background:color-mix(in srgb,var(--ak-color-text) 5%,var(--ak-color-background));border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium)}
.ak-tabs [role="tab"]{font:inherit;font-size:.92em;font-weight:550;background:transparent;border:0;padding:.5em 1.05em;min-height:36px;cursor:pointer;color:var(--ak-color-text-muted);border-radius:max(0px,calc(var(--ak-radius-medium) - 3px));${TRANSITION}}
.ak-tabs [role="tab"]:hover{color:var(--ak-color-text)}
.ak-tabs [role="tab"][aria-selected="true"]{color:var(--ak-color-text);background:var(--ak-color-surface);box-shadow:0 0 0 var(--ak-border-width) var(--ak-color-border),0 1px 3px color-mix(in srgb,var(--ak-color-text) 10%,transparent)}
.ak-tabs [role="tabpanel"]{padding:0;max-width:var(--ak-measure)}
.ak-tabs [role="tabpanel"][hidden]{display:none}
@media (max-width:768px){.ak-tabs [role="tab"]{min-height:44px}}`,

  accordion: `.ak-accordion{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 1)}
.ak-accordion details{background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);${TRANSITION}}
.ak-accordion details[open]{border-color:color-mix(in srgb,var(--ak-color-accent) 28%,var(--ak-color-border));box-shadow:var(--ak-elevation-card)}
.ak-accordion summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:calc(var(--ak-space-unit) * 2);cursor:pointer;padding:calc(var(--ak-space-unit) * 1.75) calc(var(--ak-space-unit) * 2.25);min-height:48px;font-family:var(--ak-font-heading);font-weight:600;border-radius:inherit;${TRANSITION}}
.ak-accordion summary::-webkit-details-marker{display:none}
.ak-accordion summary::after{content:"";flex:none;width:26px;height:26px;border-radius:50%;border:var(--ak-border-width) solid var(--ak-color-border);color:var(--ak-color-text-muted);background:linear-gradient(currentColor,currentColor) center/10px 1.5px no-repeat,linear-gradient(currentColor,currentColor) center/1.5px 10px no-repeat;${TRANSITION}}
.ak-accordion summary:hover{color:var(--ak-color-accent)}
.ak-accordion summary:hover::after{border-color:var(--ak-color-accent);color:var(--ak-color-accent)}
.ak-accordion details[open] summary::after{transform:rotate(180deg);background-size:10px 1.5px,1.5px 0;background-color:var(--ak-tint);color:var(--ak-color-accent);border-color:color-mix(in srgb,var(--ak-color-accent) 40%,var(--ak-color-border))}
.ak-accordion details > :not(summary){padding:0 calc(var(--ak-space-unit) * 2.25) calc(var(--ak-space-unit) * 2);margin:0;max-width:var(--ak-measure);color:var(--ak-color-text-muted)}`,

  carousel: `.ak-carousel{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 1.5)}
.ak-carousel-slides{position:relative;min-height:120px}
.ak-carousel-slide{display:flex;flex-direction:column;justify-content:flex-end;gap:.5em;min-height:200px;padding:calc(var(--ak-space-unit) * 4);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:radial-gradient(120% 140% at 100% 0%,color-mix(in srgb,var(--ak-color-accent) 12%,transparent),transparent 55%),var(--ak-fill);box-shadow:var(--ak-elevation-card)}
.ak-carousel-slide h3{font-size:calc(var(--ak-font-size-base) * 1.56);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),2));letter-spacing:-.018em}
.ak-carousel-slide p{color:var(--ak-color-text-muted);max-width:56ch;margin:0}
.ak-carousel-slide[hidden]{display:none}
.ak-carousel-controls{display:flex;gap:var(--ak-space-unit);align-items:center}
.ak-carousel-controls [data-ak-carousel="prev"]::before{content:"\\2190";font-family:var(--ak-font-mono)}
.ak-carousel-controls [data-ak-carousel="next"]::after{content:"\\2192";font-family:var(--ak-font-mono)}
.ak-carousel-status{margin-left:auto;font-family:var(--ak-font-mono);font-size:.78rem;letter-spacing:.08em;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
@media (max-width:480px){.ak-carousel-slide{min-height:160px;padding:calc(var(--ak-space-unit) * 2.5)}}`,

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

  chart: `.ak-chart{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 2);background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 3);box-shadow:var(--ak-elevation-card);--ak-c0:var(--ak-color-accent);--ak-c1:var(--ak-color-info);--ak-c2:var(--ak-color-success);--ak-c3:var(--ak-color-warning);--ak-c4:var(--ak-color-danger);--ak-c5:var(--ak-color-text-muted)}
@supports (color:oklch(from red l c h)){.ak-chart{--ak-c1:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 210));--ak-c2:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 120));--ak-c3:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 60));--ak-c4:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 290));--ak-c5:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 165))}}
.ak-chart svg{display:block;width:100%;height:auto;overflow:visible}
.ak-chart:is([data-ak-kind="pie"],[data-ak-kind="donut"]) svg{max-height:320px}
.ak-chart figcaption{font-family:var(--ak-font-heading);font-weight:600;font-size:calc(var(--ak-font-size-base) * 1.06);letter-spacing:-.01em;color:var(--ak-color-text)}
.ak-chart .ak-chart-s0{--ak-series:var(--ak-c0)}
.ak-chart .ak-chart-s1{--ak-series:var(--ak-c1)}
.ak-chart .ak-chart-s2{--ak-series:var(--ak-c2)}
.ak-chart .ak-chart-s3{--ak-series:var(--ak-c3)}
.ak-chart .ak-chart-s4{--ak-series:var(--ak-c4)}
.ak-chart .ak-chart-s5{--ak-series:var(--ak-c5)}
.ak-chart .ak-chart-bar:not([fill]),.ak-chart .ak-chart-slice{fill:var(--ak-series,var(--ak-c0))}
.ak-chart .ak-chart-bar,.ak-chart .ak-chart-slice{${TRANSITION}}
.ak-chart .ak-chart-slice{stroke:var(--ak-color-surface);stroke-width:3}
.ak-chart .ak-chart-slice:hover,.ak-chart .ak-chart-slice:focus-visible{opacity:.72}
.ak-chart svg:has(.ak-chart-bar:is(:hover,:focus-visible)) .ak-chart-bar:not(:hover,:focus-visible){opacity:.38}
.ak-chart-canvas{overflow-x:auto;overscroll-behavior-x:contain}
.ak-chart:is([data-ak-kind="bar"],[data-ak-kind="line"],[data-ak-kind="area"]) .ak-chart-canvas svg{min-width:560px}
.ak-chart .ak-chart-stop{stop-color:var(--ak-series,var(--ak-c0));stop-opacity:.34}
.ak-chart .ak-chart-stop--end{stop-opacity:0}
.ak-chart .ak-chart-stop--bar{stop-opacity:1}
.ak-chart .ak-chart-stop--bar.ak-chart-stop--end{stop-opacity:.62}
.ak-chart .ak-chart-value{fill:var(--ak-color-text);font-family:var(--ak-font-mono);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;opacity:0;pointer-events:none;${TRANSITION}}
.ak-chart :is(.ak-chart-bar,.ak-chart-point):is(:hover,:focus-visible) + .ak-chart-value{opacity:1}
.ak-chart .ak-chart-line{fill:none;stroke:var(--ak-series,var(--ak-c0));stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.ak-chart .ak-chart-point{fill:var(--ak-color-surface);stroke:var(--ak-series,var(--ak-c0));stroke-width:2.25;${TRANSITION}}
.ak-chart .ak-chart-point:hover,.ak-chart .ak-chart-point:focus-visible{fill:var(--ak-series,var(--ak-c0));stroke-width:5;stroke-opacity:.35}
.ak-chart .ak-chart-area{stroke:none}
.ak-chart .ak-chart-axis{stroke:color-mix(in srgb,var(--ak-color-text) 28%,var(--ak-color-border));stroke-width:1}
.ak-chart .ak-chart-grid{stroke:var(--ak-color-border);stroke-width:1;stroke-dasharray:1 5;stroke-linecap:round}
.ak-chart .ak-chart-track{fill:color-mix(in srgb,var(--ak-color-text) 7%,var(--ak-color-surface))}
.ak-chart .ak-chart-label{fill:var(--ak-color-text-muted);font-family:var(--ak-font-mono);font-size:10.5px;font-variant-numeric:tabular-nums}
.ak-chart .ak-chart-label--row{fill:var(--ak-color-text);font-family:var(--ak-font-body);font-size:13px;font-weight:500}
.ak-chart .ak-chart-total{fill:var(--ak-color-text);font-family:var(--ak-font-heading);font-size:26px;font-weight:700;letter-spacing:-.02em}
.ak-chart :focus-visible{outline:2px solid var(--ak-color-accent)}
.ak-chart-legend{display:flex;flex-wrap:wrap;gap:.5em 1.4em;list-style:none;margin:0;padding:0;font-size:.82rem;color:var(--ak-color-text-muted)}
.ak-chart:is([data-ak-kind="pie"],[data-ak-kind="donut"]) .ak-chart-legend{justify-content:center}
.ak-chart-legend li{display:inline-flex;align-items:center;gap:.5em}
.ak-chart-swatch{width:.7em;height:.7em;border-radius:2px;background:var(--ak-series,var(--ak-c0))}
.ak-details{border-top:var(--ak-border-width) solid var(--ak-color-border);padding-top:calc(var(--ak-space-unit) * 1.5);margin-top:calc(var(--ak-space-unit) * -.5)}
${disclosureSummary('.ak-details')}
.ak-details table{font-size:.85rem;border:var(--ak-border-width) solid var(--ak-color-border)}
.ak-details caption{font-size:.8rem}
@media (max-width:768px){.ak-details summary{min-height:44px}}`,

  filter: `.ak-search{display:flex;flex-direction:column;gap:.5em;max-width:420px}
.ak-search label{font-weight:550}
.ak-search input{font:inherit;min-height:44px;padding:.55em .95em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface);color:var(--ak-color-text);box-shadow:inset 0 1px 2px color-mix(in srgb,var(--ak-color-text) 6%,transparent);${TRANSITION}}
.ak-search input::placeholder{color:var(--ak-color-text-muted);opacity:.85}
.ak-search input:hover{border-color:color-mix(in srgb,var(--ak-color-text) 30%,var(--ak-color-border))}
.ak-search input:focus-visible{outline:0;border-color:var(--ak-color-accent);box-shadow:var(--ak-ring)}`,

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
  diagram: `.ak-diagram{min-width:0}
.ak-diagram-rendered{overflow-x:auto;overscroll-behavior-x:contain;padding:calc(var(--ak-space-unit) * 2);background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);box-shadow:var(--ak-elevation-card)}
${scrollEdges('.ak-diagram-rendered')}
.ak-diagram-rendered svg{display:block;max-width:none;height:auto}
.ak-diagram-details{margin-top:calc(var(--ak-space-unit) * 1.5)}
${disclosureSummary('.ak-diagram-details')}
@media (max-width:768px){.ak-diagram-details summary{min-height:44px}}
@media print{.ak-diagram-rendered{overflow:visible;box-shadow:none}.ak-diagram-rendered svg{max-width:100%}}
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
