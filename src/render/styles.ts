/**
 * Emitted stylesheets.
 *
 * One base sheet plus per-feature sheets. The compiler emits only the feature
 * sheets a page actually uses, which is both a size win and a correctness
 * property: a page without a carousel cannot ship carousel CSS that a later
 * change could accidentally apply.
 *
 * The sheets are static strings: the only interpolation is the shared
 * transition constant below. Everything variable comes from theme tokens, so a
 * spec cannot influence a declaration.
 *
 * Design rules the sheets follow (see DESIGN.md):
 * - the type scale is derived from the `font-scale` token, with a fixed fallback
 *   for engines without CSS `pow()`;
 * - vertical rhythm comes from one density-driven gap, doubled at section breaks;
 * - every transition uses the `motion-*` tokens, which reduced motion zeroes;
 * - tints are `color-mix()` of theme tokens, so no preset needs extra colours.
 */

import type { RuntimeFeature } from '../registry/roster.js';

/**
 * Shared transition, referenced as one custom property so the list is emitted
 * once. It is declared on `:root`, the same element that carries the motion
 * tokens and the reduced-motion override, so a zeroed duration still applies.
 */
const TRANSITION = 'transition:var(--ak-transition)';

export const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
:root{--ak-gap:calc(var(--ak-space-unit) * 3);--ak-transition:color var(--ak-motion-duration) var(--ak-motion-easing),background-color var(--ak-motion-duration) var(--ak-motion-easing),border-color var(--ak-motion-duration) var(--ak-motion-easing),box-shadow var(--ak-motion-duration) var(--ak-motion-easing),transform var(--ak-motion-duration) var(--ak-motion-easing),opacity var(--ak-motion-duration) var(--ak-motion-easing),text-decoration-color var(--ak-motion-duration) var(--ak-motion-easing);--ak-tint:color-mix(in srgb,var(--ak-color-accent) 7%,var(--ak-color-surface));accent-color:var(--ak-color-accent)}
[data-density="compact"]{--ak-gap:calc(var(--ak-space-unit) * 2)}
[data-density="spacious"]{--ak-gap:calc(var(--ak-space-unit) * 4)}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-padding-top:calc(var(--ak-space-unit) * 2)}
body{margin:0;background:var(--ak-color-background);color:var(--ak-color-text);font-family:var(--ak-font-body);font-size:var(--ak-font-size-base);line-height:var(--ak-line-height);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;font-kerning:normal}
::selection{background:color-mix(in srgb,var(--ak-color-accent) 24%,transparent)}
.ak-skip{position:fixed;left:var(--ak-space-unit);top:var(--ak-space-unit);transform:translateY(-200%);background:var(--ak-color-text);color:var(--ak-color-background);padding:.6em 1em;border-radius:var(--ak-radius-small);z-index:10;font-weight:600;${TRANSITION}}
.ak-skip:focus{transform:none}
.ak-shell{max-width:1100px;margin:0 auto;padding:calc(var(--ak-space-unit) * 3) calc(var(--ak-space-unit) * 3) calc(var(--ak-space-unit) * 10)}
.ak-page-bar{display:flex;justify-content:flex-end;margin-bottom:calc(var(--ak-space-unit) * 2)}
.ak-main{display:block}
:where(a){color:var(--ak-color-accent);text-decoration-line:underline;text-decoration-thickness:1px;text-underline-offset:.2em;text-decoration-color:color-mix(in srgb,currentColor 40%,transparent);${TRANSITION}}
:where(a):hover{text-decoration-color:currentColor}
:where(h1,h2,h3,h4,h5,h6){font-family:var(--ak-font-heading);line-height:1.18;margin:0;font-weight:700;text-wrap:balance;letter-spacing:-.01em}
h1{font-size:calc(var(--ak-font-size-base) * 2.44);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),4));line-height:1.08;letter-spacing:-.022em}
h2{font-size:calc(var(--ak-font-size-base) * 1.56);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),2));letter-spacing:-.016em}
h3{font-size:calc(var(--ak-font-size-base) * 1.25);font-size:calc(var(--ak-font-size-base) * var(--ak-font-scale))}
h4,h5,h6{font-size:calc(var(--ak-font-size-base) * 1.05)}
p{margin:0;text-wrap:pretty}
p + p{margin-top:.6em}
ul,ol{margin:0;padding-left:1.4em}
li::marker{color:var(--ak-color-text-muted)}
figure{margin:0}
code,kbd,pre{font-family:var(--ak-font-mono)}
strong{font-weight:650}
:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px;border-radius:var(--ak-radius-small)}
.ak-block + .ak-block{margin-top:var(--ak-gap)}
.ak-main > .ak-block + .ak-block:is(.ak-section,:has(> .ak-section-head)){margin-top:calc(var(--ak-gap) * 2)}
:is(.ak-stack,.ak-grid,.ak-split) > .ak-block{margin-top:0}
.ak-stack{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 2)}
.ak-stack[data-gap="tight"]{gap:var(--ak-space-unit)}
.ak-stack[data-gap="loose"]{gap:calc(var(--ak-space-unit) * 3)}
.ak-grid{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:repeat(3,minmax(0,1fr))}
ul.ak-grid{list-style:none;padding:0;margin:0}
.ak-grid[data-ak-columns="1"],.ak-gallery[data-ak-columns="1"]{grid-template-columns:minmax(0,1fr)}
.ak-grid[data-ak-columns="2"],.ak-gallery[data-ak-columns="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
.ak-grid[data-ak-columns="3"],.ak-gallery[data-ak-columns="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}
.ak-grid[data-ak-columns="4"],.ak-gallery[data-ak-columns="4"]{grid-template-columns:repeat(4,minmax(0,1fr))}
.ak-grid[data-ak-columns="5"],.ak-gallery[data-ak-columns="5"]{grid-template-columns:repeat(5,minmax(0,1fr))}
.ak-grid[data-ak-columns="6"],.ak-gallery[data-ak-columns="6"]{grid-template-columns:repeat(6,minmax(0,1fr))}
.ak-split{display:grid;gap:calc(var(--ak-space-unit) * 3);grid-template-columns:1fr 1fr}
.ak-split[data-ratio="wide-left"]{grid-template-columns:2fr 1fr}
.ak-split[data-ratio="wide-right"]{grid-template-columns:1fr 2fr}
.ak-muted{color:var(--ak-color-text-muted)}
.ak-eyebrow,.ak-label{font-family:var(--ak-font-mono);font-size:.74rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--ak-color-text-muted)}
.ak-hero{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 1.5);padding:calc(var(--ak-space-unit) * 2) 0 calc(var(--ak-space-unit) * 4);border-bottom:var(--ak-border-width) solid var(--ak-color-border)}
.ak-hero .ak-eyebrow{display:flex;align-items:center;gap:.75em;color:var(--ak-color-accent)}
.ak-hero .ak-eyebrow::before{content:"";width:1.75em;height:2px;border-radius:2px;background:currentColor;flex:none}
.ak-hero h1{max-width:22ch}
.ak-hero p:not(.ak-eyebrow){max-width:60ch;margin:0;font-size:calc(var(--ak-font-size-base) * 1.18);line-height:1.55;color:var(--ak-color-text-muted)}
.ak-page-title{margin-bottom:calc(var(--ak-space-unit) * 3)}
.ak-lead{font-size:calc(var(--ak-font-size-base) * 1.15)}
.ak-caption{font-size:.85rem;color:var(--ak-color-text-muted)}
.ak-prose{max-width:var(--ak-measure)}
.ak-card,.ak-surface{background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 2.5)}
.ak-card{display:flex;flex-direction:column;gap:var(--ak-space-unit)}
.ak-card p + p{margin-top:0}
.ak-card > p:not(.ak-label){color:var(--ak-color-text-muted)}
.ak-card > p:first-child:has(strong),.ak-card > .ak-label + p:has(strong){color:var(--ak-color-text)}
.ak-card--elevated,.ak-surface{box-shadow:var(--ak-elevation-card)}
.ak-card-title h3{font-size:calc(var(--ak-font-size-base) * 1.12);letter-spacing:-.005em}
.ak-section-head{display:flex;flex-direction:column;gap:.35em;margin-bottom:calc(var(--ak-space-unit) * 2)}
.ak-divider{border:0;border-top:var(--ak-border-width) solid var(--ak-color-border);margin:calc(var(--ak-space-unit) * 2) 0}
.ak-spacer{display:block}
.ak-spacer[data-size="small"]{height:var(--ak-space-unit)}
.ak-spacer[data-size="medium"]{height:calc(var(--ak-space-unit) * 2)}
.ak-spacer[data-size="large"]{height:calc(var(--ak-space-unit) * 4)}
.ak-quote{margin:0;border-left:3px solid var(--ak-color-accent);padding:.25em 0 .25em calc(var(--ak-space-unit) * 2.5);font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.22);line-height:1.45;letter-spacing:-.005em;max-width:var(--ak-measure)}
.ak-quote cite{display:block;margin-top:.75em;color:var(--ak-color-text-muted);font-family:var(--ak-font-mono);font-size:.78rem;font-style:normal;letter-spacing:.04em}
.ak-quote cite::before{content:"— "}
.ak-badge{--ak-tone:var(--ak-color-text-muted);display:inline-flex;align-items:center;padding:.18em .65em;border-radius:999px;border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-tone) 30%,var(--ak-color-border));background:color-mix(in srgb,var(--ak-tone) 9%,var(--ak-color-surface));color:var(--ak-tone);font-size:.74rem;font-family:var(--ak-font-mono);line-height:1.5;white-space:nowrap;font-variant-numeric:tabular-nums}
.ak-badge[data-tone="info"]{--ak-tone:var(--ak-color-info)}
.ak-badge[data-tone="success"]{--ak-tone:var(--ak-color-success)}
.ak-badge[data-tone="warning"]{--ak-tone:var(--ak-color-warning)}
.ak-badge[data-tone="danger"]{--ak-tone:var(--ak-color-danger)}
.ak-kbd{display:inline-flex;gap:.25em}
.ak-kbd kbd{border:var(--ak-border-width) solid var(--ak-color-border);border-bottom-width:2px;border-radius:var(--ak-radius-small);padding:.1em .45em;background:var(--ak-color-surface);font-size:.82em}
.ak-kv{display:grid;grid-template-columns:max-content minmax(0,1fr);margin:0}
.ak-kv dt,.ak-kv dd{padding:.55em 0;border-bottom:var(--ak-border-width) solid var(--ak-color-border)}
.ak-kv dt{color:var(--ak-color-text-muted);padding-right:calc(var(--ak-space-unit) * 3)}
.ak-kv dd{margin:0}
.ak-stats{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin:0;padding:0;list-style:none}
.ak-stat{background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 2) calc(var(--ak-space-unit) * 2.5);box-shadow:var(--ak-elevation-card)}
.ak-stat dt{font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted)}
.ak-stat dd{margin:.35em 0 0;font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.85);font-weight:650;line-height:1.1;letter-spacing:-.025em;font-variant-numeric:tabular-nums}
.ak-steps{counter-reset:ak-step;list-style:none;padding:0;display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 2.5)}
.ak-steps li{counter-increment:ak-step;position:relative;padding-left:calc(var(--ak-space-unit) * 5)}
.ak-steps li::before{content:counter(ak-step);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;background:var(--ak-color-accent);color:var(--ak-color-accent-contrast);display:flex;align-items:center;justify-content:center;font-family:var(--ak-font-mono);font-size:.8rem;font-weight:600}
.ak-steps li:not(:last-child)::after{content:"";position:absolute;left:13px;top:34px;bottom:calc(var(--ak-space-unit) * -2.5 + 6px);width:2px;border-radius:2px;background:var(--ak-color-border)}
.ak-steps li > p:not(:first-child){color:var(--ak-color-text-muted);margin-top:.15em}
.ak-timeline{list-style:none;padding:0 0 0 calc(var(--ak-space-unit) * .5);margin:0;border-left:2px solid var(--ak-color-border);display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 2.5)}
.ak-timeline li{position:relative;padding-left:calc(var(--ak-space-unit) * 2.5)}
.ak-timeline li::before{content:"";position:absolute;left:calc(var(--ak-space-unit) * -.5 - 7px);top:.3em;width:8px;height:8px;border-radius:50%;background:var(--ak-color-background);border:2px solid var(--ak-color-accent)}
.ak-timeline time{display:block;font-family:var(--ak-font-mono);font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ak-color-accent);margin-bottom:.2em}
.ak-timeline li > p:not(:first-of-type){color:var(--ak-color-text-muted);margin-top:.15em}
.ak-table-wrap{overflow-x:auto;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface);box-shadow:var(--ak-elevation-card)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
caption{text-align:left;padding-bottom:.5em;color:var(--ak-color-text-muted)}
th,td{text-align:left;padding:.7em 1em;border-bottom:var(--ak-border-width) solid var(--ak-color-border);vertical-align:top}
.ak-table-wrap tbody tr:last-child > *{border-bottom:0}
.ak-table-wrap tbody tr{${TRANSITION}}
.ak-table-wrap tbody tr:hover{background:var(--ak-tint)}
thead th{background:color-mix(in srgb,var(--ak-color-surface-raised) 70%,var(--ak-color-surface));font-family:var(--ak-font-mono);font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--ak-color-text-muted);white-space:nowrap}
.ak-compare{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:1fr 1fr}
.ak-compare h3{font-size:calc(var(--ak-font-size-base) * 1.05);margin-bottom:.6em}
.ak-compare ul{margin:0;display:flex;flex-direction:column;gap:.35em}
.ak-compare .ak-surface:first-child{border-top:3px solid var(--ak-color-accent)}
.ak-callout,.ak-alert{--ak-tone:var(--ak-color-info);border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-tone) 22%,var(--ak-color-border));border-left:3px solid var(--ak-tone);background:color-mix(in srgb,var(--ak-tone) 6%,var(--ak-color-surface));border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 2) calc(var(--ak-space-unit) * 2.5);display:flex;flex-direction:column;gap:.4em}
.ak-callout p + p,.ak-alert p + p{margin-top:0}
.ak-callout .ak-label,.ak-alert .ak-label{color:var(--ak-tone)}
.ak-callout[data-tone="success"],.ak-alert[data-tone="success"]{--ak-tone:var(--ak-color-success)}
.ak-callout[data-tone="warning"],.ak-alert[data-tone="warning"]{--ak-tone:var(--ak-color-warning)}
.ak-callout[data-tone="danger"],.ak-alert[data-tone="danger"]{--ak-tone:var(--ak-color-danger)}
.ak-code{margin:0;background:var(--ak-color-surface-raised);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);overflow:hidden}
.ak-code pre{margin:0;padding:calc(var(--ak-space-unit) * 2);overflow-x:auto;font-size:.86rem;line-height:1.65;tab-size:2}
.ak-code-head{display:flex;justify-content:space-between;gap:var(--ak-space-unit);align-items:center;padding:.6em calc(var(--ak-space-unit) * 2);border-bottom:var(--ak-border-width) solid var(--ak-color-border);background:color-mix(in srgb,var(--ak-color-surface-raised) 60%,var(--ak-color-surface))}
.ak-btn{font:inherit;font-size:.92em;font-weight:500;line-height:1.2;display:inline-flex;align-items:center;justify-content:center;gap:.45em;color:var(--ak-color-text);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:.55em 1.05em;cursor:pointer;min-height:40px;box-shadow:0 1px 0 color-mix(in srgb,var(--ak-color-text) 5%,transparent);text-decoration:none;${TRANSITION}}
.ak-btn:hover{border-color:color-mix(in srgb,var(--ak-color-accent) 50%,var(--ak-color-border));background:var(--ak-tint)}
.ak-btn:active{transform:translateY(1px);box-shadow:none}
.ak-btn:disabled,.ak-btn[aria-disabled="true"]{opacity:.5;cursor:not-allowed;transform:none}
.ak-btn[data-variant="primary"]{background:var(--ak-color-accent);color:var(--ak-color-accent-contrast);border-color:var(--ak-color-accent)}
.ak-btn[data-variant="primary"]:hover{background:color-mix(in srgb,var(--ak-color-accent) 86%,var(--ak-color-text))}
.ak-btn[data-variant="ghost"]{background:transparent;border-color:transparent;box-shadow:none}
.ak-btn[data-variant="ghost"]:hover{background:var(--ak-tint)}
.ak-toolbar{display:flex;flex-wrap:wrap;gap:var(--ak-space-unit);align-items:center;padding:var(--ak-space-unit);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium)}
.ak-list{list-style:none;padding:0;display:flex;flex-direction:column}
.ak-list li{display:flex;gap:var(--ak-space-unit);align-items:center;justify-content:space-between;border-bottom:var(--ak-border-width) solid var(--ak-color-border);padding:.7em 0}
.ak-list li:first-child{border-top:var(--ak-border-width) solid var(--ak-color-border)}
.ak-list li[hidden]{display:none}
li.ak-hidden{display:none}
.ak-progress{display:flex;flex-direction:column;gap:.45em}
.ak-progress progress{-webkit-appearance:none;appearance:none;width:100%;height:8px;border:0;border-radius:999px;background:var(--ak-color-surface-raised);overflow:hidden;color:var(--ak-color-accent)}
.ak-progress progress::-webkit-progress-bar{background:var(--ak-color-surface-raised);border-radius:999px}
.ak-progress progress::-webkit-progress-value{background:var(--ak-color-accent);border-radius:999px}
.ak-progress progress::-moz-progress-bar{background:var(--ak-color-accent);border-radius:999px}
.ak-media{margin:0;display:flex;flex-direction:column;gap:.6em}
.ak-media figcaption,.ak-gallery figcaption{font-size:.85rem;color:var(--ak-color-text-muted)}
.ak-media img,.ak-gallery img{display:block;max-width:100%;height:auto;border-radius:var(--ak-radius-medium);border:var(--ak-border-width) solid var(--ak-color-border);background:var(--ak-color-surface-raised)}
.ak-media video{display:block;max-width:100%;border-radius:var(--ak-radius-medium)}
.ak-gallery{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;padding:0;margin:0}
.ak-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (max-width:768px){body{--ak-font-size-base:16px}.ak-grid:not([data-ak-columns="1"]),.ak-gallery:not([data-ak-columns="1"]){grid-template-columns:repeat(2,minmax(0,1fr))}.ak-compare,.ak-split{grid-template-columns:1fr!important}.ak-shell{padding:calc(var(--ak-space-unit) * 2) calc(var(--ak-space-unit) * 2) calc(var(--ak-space-unit) * 7)}h1{font-size:calc(var(--ak-font-size-base) * 2);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),3))}h2{font-size:calc(var(--ak-font-size-base) * 1.4);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),1.5))}.ak-btn{min-height:44px}.ak-hero{padding-bottom:calc(var(--ak-space-unit) * 3)}}
@media (max-width:480px){.ak-grid{grid-template-columns:1fr!important}.ak-toolbar{flex-direction:column;align-items:stretch}.ak-stats{grid-template-columns:1fr 1fr}.ak-stat dd{font-size:calc(var(--ak-font-size-base) * 1.5)}.ak-kv{grid-template-columns:1fr}.ak-kv dt{border-bottom:0;padding-bottom:0}}
@media print{.ak-skip,.ak-page-bar{display:none}.ak-shell{max-width:none;padding:0}.ak-card,.ak-surface,.ak-stat,.ak-table-wrap{box-shadow:none}}`;

export const FEATURE_CSS: Readonly<Partial<Record<RuntimeFeature, string>>> = {
  tabs: `.ak-tabs [role="tablist"]{display:flex;flex-wrap:wrap;gap:.25em;border-bottom:var(--ak-border-width) solid var(--ak-color-border);margin-bottom:calc(var(--ak-space-unit) * 2)}
.ak-tabs [role="tab"]{font:inherit;font-weight:500;background:transparent;border:0;border-bottom:2px solid transparent;margin-bottom:calc(var(--ak-border-width) * -1);padding:.6em .9em;min-height:40px;cursor:pointer;color:var(--ak-color-text-muted);border-radius:var(--ak-radius-small) var(--ak-radius-small) 0 0;${TRANSITION}}
.ak-tabs [role="tab"]:hover{color:var(--ak-color-text);background:var(--ak-tint)}
.ak-tabs [role="tab"][aria-selected="true"]{color:var(--ak-color-text);border-bottom-color:var(--ak-color-accent)}
.ak-tabs [role="tabpanel"]{padding:0}
.ak-tabs [role="tabpanel"][hidden]{display:none}`,

  accordion: `.ak-accordion{display:flex;flex-direction:column}
.ak-accordion details{background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-top-width:0}
.ak-accordion :not(details) + details,.ak-accordion details:first-child{border-top-width:var(--ak-border-width);border-radius:var(--ak-radius-medium) var(--ak-radius-medium) 0 0}
.ak-accordion details:last-child{border-bottom-left-radius:var(--ak-radius-medium);border-bottom-right-radius:var(--ak-radius-medium)}
.ak-accordion details:only-of-type{border-radius:var(--ak-radius-medium)}
.ak-accordion summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:var(--ak-space-unit);cursor:pointer;padding:calc(var(--ak-space-unit) * 1.5) calc(var(--ak-space-unit) * 2);min-height:44px;font-family:var(--ak-font-heading);font-weight:600;${TRANSITION}}
.ak-accordion summary::-webkit-details-marker{display:none}
.ak-accordion summary::after{content:"";flex:none;width:.5em;height:.5em;border-right:2px solid var(--ak-color-text-muted);border-bottom:2px solid var(--ak-color-text-muted);transform:translateY(-25%) rotate(45deg);${TRANSITION}}
.ak-accordion summary:hover{background:var(--ak-tint)}
.ak-accordion details[open] summary::after{transform:translateY(25%) rotate(-135deg)}
.ak-accordion details > :not(summary){padding:0 calc(var(--ak-space-unit) * 2) calc(var(--ak-space-unit) * 1.75);color:var(--ak-color-text-muted)}`,

  carousel: `.ak-carousel{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 1.5)}
.ak-carousel-slides{position:relative;min-height:120px}
.ak-carousel-slide{background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);padding:calc(var(--ak-space-unit) * 3);box-shadow:var(--ak-elevation-card)}
.ak-carousel-slide p{color:var(--ak-color-text-muted);margin-top:.35em}
.ak-carousel-slide[hidden]{display:none}
.ak-carousel-controls{display:flex;gap:var(--ak-space-unit);align-items:center}
.ak-carousel-status{margin-left:auto;font-family:var(--ak-font-mono);font-size:.78rem;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}`,

  slider: `.ak-slider{display:flex;flex-direction:column;gap:.45em;max-width:420px}
.ak-slider input[type="range"]{width:100%;accent-color:var(--ak-color-accent);min-height:24px}
.ak-slider output{font-family:var(--ak-font-mono);font-size:.82rem;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}`,

  dialog: `dialog.ak-dialog{max-width:min(560px,92vw);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:var(--ak-color-surface);color:var(--ak-color-text);padding:calc(var(--ak-space-unit) * 3);box-shadow:var(--ak-elevation-popover)}
dialog.ak-dialog::backdrop{background:color-mix(in srgb,var(--ak-color-text) 40%,transparent);backdrop-filter:blur(2px)}
dialog.ak-dialog[open]{animation:ak-rise var(--ak-motion-duration) var(--ak-motion-easing)}
@keyframes ak-rise{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
.ak-dialog-actions{display:flex;gap:var(--ak-space-unit);justify-content:flex-end;margin-top:calc(var(--ak-space-unit) * 2)}`,

  chart: `.ak-chart{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 1.5);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 2.5);box-shadow:var(--ak-elevation-card);--ak-c0:var(--ak-color-accent);--ak-c1:var(--ak-color-info);--ak-c2:var(--ak-color-success);--ak-c3:var(--ak-color-warning);--ak-c4:var(--ak-color-danger);--ak-c5:var(--ak-color-text-muted)}
@supports (color:oklch(from red l c h)){.ak-chart{--ak-c1:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 210));--ak-c2:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 120));--ak-c3:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 60));--ak-c4:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 290));--ak-c5:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 165))}}
.ak-chart svg{display:block;width:100%;height:auto;overflow:visible}
.ak-chart figcaption{font-family:var(--ak-font-heading);font-weight:600;font-size:calc(var(--ak-font-size-base) * 1.02);color:var(--ak-color-text)}
.ak-chart .ak-chart-s0{--ak-series:var(--ak-c0)}
.ak-chart .ak-chart-s1{--ak-series:var(--ak-c1)}
.ak-chart .ak-chart-s2{--ak-series:var(--ak-c2)}
.ak-chart .ak-chart-s3{--ak-series:var(--ak-c3)}
.ak-chart .ak-chart-s4{--ak-series:var(--ak-c4)}
.ak-chart .ak-chart-s5{--ak-series:var(--ak-c5)}
.ak-chart .ak-chart-bar,.ak-chart .ak-chart-slice{fill:var(--ak-series,var(--ak-c0));${TRANSITION}}
.ak-chart .ak-chart-slice{stroke:var(--ak-color-surface);stroke-width:2}
.ak-chart .ak-chart-bar:hover,.ak-chart .ak-chart-slice:hover,.ak-chart .ak-chart-bar:focus-visible,.ak-chart .ak-chart-slice:focus-visible{opacity:.78}
.ak-chart .ak-chart-line{fill:none;stroke:var(--ak-series,var(--ak-c0));stroke-width:2.25;stroke-linejoin:round;stroke-linecap:round}
.ak-chart .ak-chart-point{fill:var(--ak-color-surface);stroke:var(--ak-series,var(--ak-c0));stroke-width:2}
.ak-chart .ak-chart-area{fill:var(--ak-series,var(--ak-c0));opacity:.14}
.ak-chart .ak-chart-axis{stroke:var(--ak-color-border);stroke-width:1}
.ak-chart .ak-chart-grid{stroke:var(--ak-color-border);stroke-width:1;stroke-dasharray:2 4;opacity:.8}
.ak-chart .ak-chart-track{fill:var(--ak-color-surface-raised)}
.ak-chart .ak-chart-label{fill:var(--ak-color-text-muted);font-family:var(--ak-font-mono);font-size:11px;font-variant-numeric:tabular-nums}
.ak-chart .ak-chart-label--row{fill:var(--ak-color-text);font-family:var(--ak-font-body);font-size:13px}
.ak-chart .ak-chart-total{fill:var(--ak-color-text);font-family:var(--ak-font-heading);font-size:22px;font-weight:650}
.ak-chart :focus-visible{outline:2px solid var(--ak-color-accent)}
.ak-chart-legend{display:flex;flex-wrap:wrap;gap:.4em 1.25em;list-style:none;margin:0;padding:0;font-size:.82rem;color:var(--ak-color-text-muted)}
.ak-chart-legend li{display:inline-flex;align-items:center;gap:.45em}
.ak-chart-swatch{width:.75em;height:.75em;border-radius:3px;background:var(--ak-series,var(--ak-c0))}
.ak-details{border-top:var(--ak-border-width) solid var(--ak-color-border);padding-top:var(--ak-space-unit)}
.ak-details summary{cursor:pointer;color:var(--ak-color-text-muted);font-size:.82rem;width:max-content;${TRANSITION}}
.ak-details summary:hover{color:var(--ak-color-text)}
.ak-details[open] summary{margin-bottom:var(--ak-space-unit)}
.ak-details table{font-size:.85rem}`,

  filter: `.ak-search{display:flex;flex-direction:column;gap:.45em;max-width:380px}
.ak-search input{font:inherit;min-height:42px;padding:.5em .8em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface);color:var(--ak-color-text);${TRANSITION}}
.ak-search input::placeholder{color:var(--ak-color-text-muted)}
.ak-search input:hover{border-color:color-mix(in srgb,var(--ak-color-accent) 40%,var(--ak-color-border))}
.ak-search input:focus-visible{outline:0;border-color:var(--ak-color-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ak-color-accent) 22%,transparent)}`,

  theme: `.ak-theme-toggle{min-height:34px;padding:.35em .85em;font-family:var(--ak-font-mono);font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ak-color-text-muted);border-radius:999px}
.ak-theme-toggle::before{content:"";width:.7em;height:.7em;border-radius:50%;background:linear-gradient(90deg,currentColor 50%,transparent 50%);box-shadow:inset 0 0 0 1.5px currentColor}
@media (max-width:768px){.ak-theme-toggle{min-height:44px}}`,

  media: `.ak-media-fallback{display:flex;flex-direction:column;gap:.45em;background:var(--ak-color-surface);border:var(--ak-border-width) dashed var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 2)}
.ak-media-fallback img{max-width:100%;border-radius:var(--ak-radius-small)}`,

  diagram: `.ak-diagram{overflow-x:auto}
.ak-diagram svg{max-width:100%;height:auto}
.ak-diagram-fallback{background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 2.5);box-shadow:var(--ak-elevation-card)}`,
};
