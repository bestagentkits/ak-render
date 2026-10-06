/**
 * Feature sheets for the composition blocks: tabs, accordion, carousel and
 * bento. The core feature tables import them back under the same keys, so the
 * compiler still emits each one only when a page uses the feature.
 */

import { EASE_OUT, MID, SLOW, TRANSITION, UNIT } from '../../render/style-units.js';

export const TABS_CSS = `.ak-tabs [role="tablist"]{display:inline-flex;flex-wrap:wrap;gap:3px;max-width:100%;padding:3px;margin-bottom:calc(var(--ak-space-unit) * 2);background:color-mix(in srgb,var(--ak-color-text) 5%,var(--ak-color-background));border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium)}
.ak-tabs [role="tab"]{font:inherit;font-size:.92em;font-weight:550;background:transparent;border:0;padding:.5em 1.05em;min-height:36px;cursor:pointer;color:var(--ak-color-text-muted);border-radius:max(0px,calc(var(--ak-radius-medium) - 3px));${TRANSITION}}
.ak-tabs [role="tab"]:hover{color:var(--ak-color-text)}
.ak-tabs [role="tab"][aria-selected="true"]{color:var(--ak-color-text);background:var(--ak-color-surface);box-shadow:0 0 0 var(--ak-border-width) var(--ak-color-border),0 1px 3px color-mix(in srgb,var(--ak-color-text) 10%,transparent)}
.ak-tabs [role="tabpanel"]{padding:0;max-width:var(--ak-measure)}
.ak-tabs [role="tabpanel"][hidden]{display:none}
.ak-tab-panel-title{margin:0 0 .4em;font-family:var(--ak-font-heading);font-weight:600;color:var(--ak-color-text)}
.ak-tabs:not([data-ak-tabs-ready])>[role="tablist"]{display:none}
.ak-tabs:not([data-ak-tabs-ready])>[role="tabpanel"]+[role="tabpanel"]{margin-top:calc(var(--ak-space-unit) * 2.5)}
.ak-tabs[data-ak-tabs-ready]>[role="tabpanel"]>.ak-tab-panel-title{display:none}
@media (max-width:768px){.ak-tabs [role="tab"]{min-height:44px}}
@media print{.ak-tabs>[role="tablist"]{display:none!important}.ak-tabs>[role="tabpanel"][hidden]{display:block!important}.ak-tabs>[role="tabpanel"]+[role="tabpanel"]{margin-top:calc(var(--ak-space-unit) * 2.5)}.ak-tabs>[role="tabpanel"]>.ak-tab-panel-title{display:block!important}}`;

export const ACCORDION_CSS = `.ak-accordion{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 1)}
.ak-accordion details{background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);${TRANSITION}}
.ak-accordion details[open]{border-color:color-mix(in srgb,var(--ak-color-accent) 28%,var(--ak-color-border));box-shadow:var(--ak-elevation-card)}
.ak-accordion summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:calc(var(--ak-space-unit) * 2);cursor:pointer;padding:calc(var(--ak-space-unit) * 1.75) calc(var(--ak-space-unit) * 2.25);min-height:48px;font-family:var(--ak-font-heading);font-weight:600;border-radius:inherit;${TRANSITION}}
.ak-accordion summary::-webkit-details-marker{display:none}
.ak-accordion summary::after{content:"";flex:none;width:26px;height:26px;border-radius:50%;border:var(--ak-border-width) solid var(--ak-color-border);color:var(--ak-color-text-muted);background:linear-gradient(currentColor,currentColor) center/10px 1.5px no-repeat,linear-gradient(currentColor,currentColor) center/1.5px 10px no-repeat;${TRANSITION}}
.ak-accordion summary:hover{color:var(--ak-color-accent)}
.ak-accordion summary:hover::after{border-color:var(--ak-color-accent);color:var(--ak-color-accent)}
.ak-accordion details[open] summary::after{transform:rotate(180deg);background-size:10px 1.5px,1.5px 0;background-color:var(--ak-tint);color:var(--ak-color-accent);border-color:color-mix(in srgb,var(--ak-color-accent) 40%,var(--ak-color-border))}
.ak-accordion details > :not(summary){padding:0 calc(var(--ak-space-unit) * 2.25) calc(var(--ak-space-unit) * 2);margin:0;max-width:var(--ak-measure);color:var(--ak-color-text-muted)}`;

export const CAROUSEL_CSS = `.ak-carousel{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 1.5)}
.ak-carousel-slides{position:relative;min-height:120px}
.ak-carousel-slide{display:flex;flex-direction:column;justify-content:flex-end;gap:.5em;min-height:200px;padding:calc(var(--ak-space-unit) * 4);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:radial-gradient(120% 140% at 100% 0%,color-mix(in srgb,var(--ak-color-accent) 12%,transparent),transparent 55%),var(--ak-fill);box-shadow:var(--ak-elevation-card)}
.ak-carousel-slide h3{font-size:calc(var(--ak-font-size-base) * 1.56);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),2));letter-spacing:-.018em}
.ak-carousel-slide p{color:var(--ak-color-text-muted);max-width:56ch;margin:0}
.ak-carousel-slide[hidden]{display:none}
.ak-carousel:not([data-ak-carousel-ready])>.ak-carousel-slides{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,100%);gap:var(--ak-space-unit);overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory}
.ak-carousel:not([data-ak-carousel-ready])>.ak-carousel-slides>.ak-carousel-slide{scroll-snap-align:start}
.ak-carousel:not([data-ak-carousel-ready])>.ak-carousel-controls{display:none}
.ak-carousel-controls{display:flex;gap:var(--ak-space-unit);align-items:center}
.ak-carousel-controls [data-ak-carousel="prev"]::before{content:"\\2190";font-family:var(--ak-font-mono)}
.ak-carousel-controls [data-ak-carousel="next"]::after{content:"\\2192";font-family:var(--ak-font-mono)}
.ak-carousel-status{margin-left:auto;font-family:var(--ak-font-mono);font-size:.78rem;letter-spacing:.08em;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
@media (max-width:480px){.ak-carousel-slide{min-height:160px;padding:calc(var(--ak-space-unit) * 2.5)}}
@media print{.ak-carousel>.ak-carousel-slides{display:flex!important;flex-direction:column;gap:var(--ak-space-unit);overflow:visible!important}.ak-carousel>.ak-carousel-slides>.ak-carousel-slide[hidden]{display:flex!important}.ak-carousel-slide{min-height:0;box-shadow:none;break-inside:avoid}.ak-carousel>.ak-carousel-controls{display:none!important}}`;

export const BENTO_CSS = `.ak-bento{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:minmax(190px,auto);grid-auto-flow:dense;gap:${UNIT(2)}}
.ak-tile{position:relative;isolation:isolate;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;gap:.45em;min-width:0;padding:${UNIT(3)};border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:var(--ak-fill);box-shadow:var(--ak-elevation-card);transition:translate ${MID} ${EASE_OUT},box-shadow ${MID} ${EASE_OUT},border-color var(--ak-motion-duration) var(--ak-motion-easing)}
.ak-tile[data-size="wide"]{grid-column:span 2}
.ak-tile[data-size="tall"]{grid-row:span 2}
.ak-tile[data-size="large"]{grid-column:span 2;grid-row:span 2}
.ak-tile:first-child{background:radial-gradient(120% 100% at 100% 0%,color-mix(in srgb,var(--ak-color-accent) 16%,transparent),transparent 62%),var(--ak-fill)}
.ak-tile:hover{translate:0 -4px;border-color:color-mix(in srgb,var(--ak-color-accent) 40%,var(--ak-color-border));box-shadow:var(--ak-elevation-popover)}
.ak-tile[data-media]{justify-content:flex-start;padding:0}
.ak-tile-media{display:flex;flex:1 1 auto;min-height:170px;overflow:hidden;padding:${UNIT(3)} 0 0 ${UNIT(3)};border-bottom:var(--ak-border-width) solid var(--ak-color-border);background:radial-gradient(120% 140% at 0 0,color-mix(in srgb,var(--ak-color-accent) 16%,var(--ak-color-surface-raised)),var(--ak-color-surface-raised) 70%)}
.ak-tile-media img{display:block;flex:1 1 auto;width:100%;min-width:0;min-height:146px;object-fit:cover;object-position:top left;border:var(--ak-border-width) solid var(--ak-color-border);border-width:var(--ak-border-width) 0 0 var(--ak-border-width);border-top-left-radius:var(--ak-radius-large);box-shadow:0 18px 48px -18px color-mix(in srgb,var(--ak-color-text) 34%,transparent);transform-origin:0 0;transition:transform ${SLOW} ${EASE_OUT}}
.ak-tile:hover .ak-tile-media img{transform:translate(-4px,-4px) scale(1.02)}
.ak-tile-media .ak-caption{padding:${UNIT(2)}}
.ak-tile[data-media] .ak-tile-body{padding:${UNIT(2.25)} ${UNIT(2.5)} ${UNIT(2.5)}}
.ak-tile-body{display:flex;flex-direction:column;gap:.4em}
.ak-tile-body > p{margin:0}
.ak-tile .ak-eyebrow{color:var(--ak-color-accent)}
.ak-tile-value{font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),5));font-weight:700;line-height:.95;letter-spacing:-.05em;font-variant-numeric:tabular-nums;background:linear-gradient(140deg,var(--ak-color-text) 30%,var(--ak-color-accent));-webkit-background-clip:text;background-clip:text;color:transparent}
.ak-tile-title{font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),1.4));font-weight:650;line-height:1.2;letter-spacing:-.02em}
.ak-tile[data-size="large"] .ak-tile-title{font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),2.4));letter-spacing:-.03em}
.ak-tile-text{max-width:46ch;color:var(--ak-color-text-muted);font-size:.95rem}
@media (max-width:900px){.ak-bento{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.ak-bento{grid-template-columns:1fr;grid-auto-rows:auto}.ak-tile[data-size]{grid-column:auto;grid-row:auto;min-height:0}.ak-tile-value{font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),4))}}
@keyframes ak-settle{from{scale:1.12}to{scale:1}}
@supports (animation-timeline:view()){@media (prefers-reduced-motion:no-preference){.ak-tile-media img{animation:ak-settle linear both;animation-timeline:view();animation-range:entry 0% cover 40%}}}
@media print{.ak-tile-media img{animation:none!important}}`;
