/**
 * Emitted stylesheets.
 *
 * One base sheet plus per-feature sheets (`feature-styles.ts`). The compiler
 * emits only the feature sheets a page actually uses, which is both a size win
 * and a correctness property: a page without a carousel cannot ship carousel CSS
 * that a later change could accidentally apply.
 *
 * The sheets are static strings: the only interpolation is the shared
 * transition constant below. Everything variable comes from theme tokens, so a
 * spec cannot influence a declaration.
 *
 * Design rules the sheets follow (see DESIGN.md):
 * - the type scale is derived from the `font-scale` token, with a fixed fallback
 *   for engines without CSS `pow()`;
 * - vertical rhythm comes from one density-driven gap, enlarged at section breaks;
 * - top-level sections open on a hairline carrying a short accent tab, the same
 *   motif as the hero eyebrow rule;
 * - every transition uses the `motion-*` tokens, which reduced motion zeroes;
 * - tints are `color-mix()` of theme tokens, so no preset needs extra colours.
 */

export { FEATURE_CSS } from './feature-styles.js';

import { DARK_FILL, RING, TINT } from './derived-variables.js';
import { EFFECTS_CSS } from './effects-styles.js';
import { SIGNATURE_CSS } from './signature-styles.js';

/**
 * Shared transition, referenced as one custom property so the list is emitted
 * once. It is declared on `:root`, the same element that carries the motion
 * tokens and the reduced-motion override, so a zeroed duration still applies.
 */
const TRANSITION = 'transition:var(--ak-transition)';

export const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
:root{--ak-gap:calc(var(--ak-space-unit) * 3);--ak-transition:color var(--ak-motion-duration) var(--ak-motion-easing),background-color var(--ak-motion-duration) var(--ak-motion-easing),border-color var(--ak-motion-duration) var(--ak-motion-easing),box-shadow var(--ak-motion-duration) var(--ak-motion-easing),transform var(--ak-motion-duration) var(--ak-motion-easing),opacity var(--ak-motion-duration) var(--ak-motion-easing),text-decoration-color var(--ak-motion-duration) var(--ak-motion-easing);${TINT};${RING};--ak-fill:var(--ak-color-surface);accent-color:var(--ak-color-accent)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK_FILL}}}
:root[data-theme="dark"]{${DARK_FILL}}
[data-density="compact"]{--ak-gap:calc(var(--ak-space-unit) * 2)}
[data-density="spacious"]{--ak-gap:calc(var(--ak-space-unit) * 4)}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-padding-top:calc(var(--ak-space-unit) * 2)}
body{margin:0;background:linear-gradient(180deg,color-mix(in srgb,var(--ak-color-accent) 5%,var(--ak-color-background)),var(--ak-color-background) 520px) no-repeat,var(--ak-color-background);color:var(--ak-color-text);font-family:var(--ak-font-body);font-size:var(--ak-font-size-base);line-height:var(--ak-line-height);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;font-kerning:normal;overflow-wrap:break-word}
::selection{background:color-mix(in srgb,var(--ak-color-accent) 24%,transparent)}
.ak-skip{position:fixed;left:var(--ak-space-unit);top:var(--ak-space-unit);transform:translateY(-200%);background:var(--ak-color-text);color:var(--ak-color-background);padding:.6em 1em;border-radius:var(--ak-radius-small);z-index:10;font-weight:600;${TRANSITION}}
.ak-skip:focus{transform:none}
.ak-shell{max-width:1120px;margin:0 auto;padding:calc(var(--ak-space-unit) * 3) calc(var(--ak-space-unit) * 4) calc(var(--ak-space-unit) * 12)}
.ak-page-bar{display:flex;justify-content:flex-end;margin-bottom:calc(var(--ak-space-unit) * 2)}
.ak-main{display:block}
:where(a){color:var(--ak-color-accent);text-decoration-line:underline;text-decoration-thickness:1px;text-underline-offset:.22em;text-decoration-color:color-mix(in srgb,currentColor 35%,transparent);${TRANSITION}}
:where(a):hover{text-decoration-color:currentColor}
:where(h1,h2,h3,h4,h5,h6){font-family:var(--ak-font-heading);line-height:1.2;margin:0;font-weight:700;text-wrap:balance;letter-spacing:-.012em}
h1{font-size:calc(var(--ak-font-size-base) * 2.44);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),4));line-height:1.06;letter-spacing:-.028em}
h2{font-size:calc(var(--ak-font-size-base) * 1.56);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),2));line-height:1.15;letter-spacing:-.02em}
h3{font-size:calc(var(--ak-font-size-base) * 1.25);font-size:calc(var(--ak-font-size-base) * var(--ak-font-scale));letter-spacing:-.012em}
h4,h5,h6{font-size:calc(var(--ak-font-size-base) * 1.05)}
p{margin:0;text-wrap:pretty}
p + p{margin-top:.6em}
ul,ol{margin:0;padding-left:1.4em}
li::marker{color:var(--ak-color-text-muted)}
figure{margin:0}
code,kbd,pre{font-family:var(--ak-font-mono)}
:not(pre) > code{font-size:.86em;padding:.12em .4em;border-radius:var(--ak-radius-small);background:color-mix(in srgb,var(--ak-color-text) 6%,transparent);border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-color-text) 8%,transparent)}
strong{font-weight:650}
hr{border:0;border-top:var(--ak-border-width) solid var(--ak-color-border)}
:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px;border-radius:var(--ak-radius-small)}
.ak-block + .ak-block{margin-top:var(--ak-gap)}
.ak-main > .ak-block + .ak-block:is(.ak-section,:has(> .ak-section-head)){margin-top:calc(var(--ak-gap) * 2.5)}
.ak-section > .ak-block + .ak-block:has(> .ak-section-head){margin-top:calc(var(--ak-gap) * 1.75)}
:is(.ak-stack,.ak-grid,.ak-split) > .ak-block{margin-top:0}
.ak-stack{display:flex;flex-direction:column;align-items:flex-start;gap:calc(var(--ak-space-unit) * 2)}
.ak-stack > :not(.ak-badge,.ak-kbd,.ak-btn){align-self:stretch}
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
.ak-split{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:1fr 1fr}
.ak-split[data-ratio="wide-left"]{grid-template-columns:2fr 1fr}
.ak-split[data-ratio="wide-right"]{grid-template-columns:1fr 2fr}
.ak-split > *,.ak-grid > *,.ak-compare > *{min-width:0}
.ak-muted{color:var(--ak-color-text-muted)}
.ak-eyebrow,.ak-label{font-family:var(--ak-font-mono);font-size:.72rem;font-weight:500;line-height:1.5;letter-spacing:.1em;text-transform:uppercase;color:var(--ak-color-text-muted)}
.ak-hero{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 2);padding:calc(var(--ak-space-unit) * 5) 0 calc(var(--ak-space-unit) * 3)}
.ak-hero .ak-eyebrow{display:flex;align-items:center;gap:.85em;color:var(--ak-color-accent)}
.ak-hero .ak-eyebrow::before{content:"";width:2.5rem;height:2px;background:currentColor;flex:none}
.ak-hero h1{max-width:20ch;font-size:calc(var(--ak-font-size-base) * 3);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),5));line-height:1.02;letter-spacing:-.034em}
.ak-hero p:not(.ak-eyebrow){max-width:58ch;margin:0;font-size:calc(var(--ak-font-size-base) * 1.2);line-height:1.55;color:var(--ak-color-text-muted)}
.ak-page-title{margin-bottom:calc(var(--ak-space-unit) * 3)}
.ak-lead{font-size:calc(var(--ak-font-size-base) * 1.18);line-height:1.55;max-width:var(--ak-measure)}
.ak-caption{font-size:.84rem;color:var(--ak-color-text-muted)}
.ak-prose{max-width:var(--ak-measure)}
.ak-section-head{display:flex;flex-direction:column;gap:.4em;margin-bottom:calc(var(--ak-space-unit) * 2)}
.ak-main > .ak-section > .ak-section-head{position:relative;padding-top:calc(var(--ak-space-unit) * 2.5);margin-bottom:calc(var(--ak-space-unit) * 3.5);border-top:var(--ak-border-width) solid var(--ak-color-border)}
.ak-main > .ak-section > .ak-section-head::before{content:"";position:absolute;left:0;top:calc(var(--ak-border-width) * -1);width:2.5rem;height:2px;background:var(--ak-color-accent)}
.ak-section .ak-block > .ak-section-head h2,.ak-section > h2.ak-block,.ak-stack > h2.ak-block{font-size:calc(var(--ak-font-size-base) * 1.25);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),1.2));letter-spacing:-.014em}
.ak-card,.ak-surface{background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 3)}
.ak-card{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 1)}
.ak-card p + p{margin-top:0}
.ak-card > p:not(.ak-label){color:var(--ak-color-text-muted)}
.ak-card > p:first-child:has(strong),.ak-card > .ak-label + p:has(strong){color:var(--ak-color-text);font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.08);letter-spacing:-.01em}
.ak-card > .ak-label:first-child{align-self:flex-start;padding:.1em .6em;border-radius:999px;background:color-mix(in srgb,var(--ak-color-text) 6%,transparent);margin-bottom:.35em}
.ak-card--elevated,.ak-surface{box-shadow:var(--ak-elevation-card)}
.ak-card-title h3{font-size:calc(var(--ak-font-size-base) * 1.12);letter-spacing:-.01em}
.ak-divider{border:0;border-top:var(--ak-border-width) solid var(--ak-color-border);margin:calc(var(--ak-space-unit) * 2) 0}
.ak-block:has(> .ak-divider + .ak-label){display:flex;align-items:center;gap:calc(var(--ak-space-unit) * 2)}
.ak-block:has(> .ak-divider + .ak-label) > .ak-divider{flex:1;margin:0}
.ak-block:has(> .ak-divider + .ak-label) > .ak-label{order:-1}
.ak-spacer{display:block}
.ak-spacer[data-size="small"]{height:var(--ak-space-unit)}
.ak-spacer[data-size="medium"]{height:calc(var(--ak-space-unit) * 2)}
.ak-spacer[data-size="large"]{height:calc(var(--ak-space-unit) * 4)}
.ak-quote{position:relative;margin:0;padding:calc(var(--ak-space-unit) * 1) 0 0 calc(var(--ak-space-unit) * 6);max-width:var(--ak-measure)}
.ak-quote::before{content:"\\201C";position:absolute;left:0;top:0;font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 4.5);line-height:.9;font-weight:400;font-style:normal;color:var(--ak-color-accent)}
.ak-quote p{font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.3);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),1.25));line-height:1.4;letter-spacing:-.012em;text-wrap:balance}
.ak-quote cite{display:flex;align-items:center;gap:.75em;margin-top:1em;color:var(--ak-color-text-muted);font-family:var(--ak-font-mono);font-size:.74rem;font-style:normal;letter-spacing:.08em;text-transform:uppercase}
.ak-quote cite::before{content:"";width:1.5rem;height:1px;background:currentColor}
.ak-badge{--ak-tone:var(--ak-color-text-muted);display:inline-flex;align-items:center;gap:.45em;padding:.2em .7em;border-radius:999px;border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-tone) 28%,var(--ak-color-border));background:color-mix(in srgb,var(--ak-tone) 9%,var(--ak-color-surface));color:var(--ak-tone);font-size:.72rem;font-family:var(--ak-font-mono);font-weight:500;letter-spacing:.02em;line-height:1.5;white-space:nowrap;font-variant-numeric:tabular-nums}
.ak-badge:is([data-tone="info"],[data-tone="success"],[data-tone="warning"],[data-tone="danger"])::before{content:"";width:.45em;height:.45em;border-radius:50%;background:currentColor;box-shadow:0 0 0 2px color-mix(in srgb,currentColor 22%,transparent)}
.ak-badge[data-tone="info"]{--ak-tone:var(--ak-color-info)}
.ak-badge[data-tone="success"]{--ak-tone:var(--ak-color-success)}
.ak-badge[data-tone="warning"]{--ak-tone:var(--ak-color-warning)}
.ak-badge[data-tone="danger"]{--ak-tone:var(--ak-color-danger)}
.ak-kbd{display:inline-flex;align-items:center;gap:.3em}
.ak-kbd kbd{display:inline-flex;align-items:center;justify-content:center;min-width:1.9em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small);padding:.12em .5em;background:var(--ak-color-surface);box-shadow:inset 0 -2px 0 color-mix(in srgb,var(--ak-color-text) 10%,var(--ak-color-border)),0 1px 1px color-mix(in srgb,var(--ak-color-text) 6%,transparent);font-size:.78em;font-weight:500;line-height:1.5;color:var(--ak-color-text)}
.ak-kv{display:grid;grid-template-columns:minmax(120px,max-content) minmax(0,1fr);margin:0;border-top:var(--ak-border-width) solid var(--ak-color-border)}
.ak-kv dt,.ak-kv dd{padding:.75em 0;border-bottom:var(--ak-border-width) solid var(--ak-color-border)}
.ak-kv dt{font-family:var(--ak-font-mono);font-size:.74rem;letter-spacing:.08em;text-transform:uppercase;line-height:var(--ak-line-height);color:var(--ak-color-text-muted);padding-right:calc(var(--ak-space-unit) * 4);padding-top:calc(.75em + .2rem)}
.ak-kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.ak-stats{display:grid;gap:0;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin:0;padding:0;list-style:none;overflow:hidden;background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);box-shadow:var(--ak-elevation-card)}
.ak-stat{padding:calc(var(--ak-space-unit) * 2.5) calc(var(--ak-space-unit) * 3) calc(var(--ak-space-unit) * 3);box-shadow:calc(var(--ak-border-width) * -1) calc(var(--ak-border-width) * -1) 0 0 var(--ak-color-border)}
.ak-stat dt{display:flex;align-items:center;gap:.6em;font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ak-color-text-muted)}
.ak-stat dt::before{content:"";width:.4rem;height:.4rem;border-radius:50%;background:var(--ak-color-accent)}
.ak-stat dd{margin:.5em 0 0;font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 2.4);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),3.6));font-weight:700;line-height:1;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.ak-steps{counter-reset:ak-step;list-style:none;padding:0;margin:0;display:flex;flex-direction:column}
.ak-steps li{counter-increment:ak-step;position:relative;padding:0 0 calc(var(--ak-space-unit) * 3) calc(var(--ak-space-unit) * 6);min-height:40px}
.ak-steps li:last-child{padding-bottom:0}
.ak-steps li::before{content:counter(ak-step,decimal-leading-zero);position:absolute;left:0;top:-.1em;width:32px;height:32px;border-radius:50%;background:var(--ak-color-surface);border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-color-accent) 45%,var(--ak-color-border));box-shadow:0 0 0 4px var(--ak-color-background);color:var(--ak-color-accent);display:flex;align-items:center;justify-content:center;font-family:var(--ak-font-mono);font-size:.72rem;font-weight:600;font-variant-numeric:tabular-nums;z-index:1}
.ak-steps li:not(:last-child)::after{content:"";position:absolute;left:15.5px;top:calc(32px - .1em);bottom:0;width:1px;background:linear-gradient(var(--ak-color-border),color-mix(in srgb,var(--ak-color-accent) 30%,var(--ak-color-border)))}
.ak-steps li > p:first-child{font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.06)}
.ak-steps li > p:not(:first-child){color:var(--ak-color-text-muted);margin-top:.2em;max-width:var(--ak-measure)}
.ak-timeline{list-style:none;padding:0;margin:0;display:flex;flex-direction:column}
.ak-timeline li{position:relative;padding:0 0 calc(var(--ak-space-unit) * 3) calc(var(--ak-space-unit) * 4)}
.ak-timeline li:last-child{padding-bottom:0}
.ak-timeline li::before{content:"";position:absolute;left:5px;top:.42em;width:9px;height:9px;border-radius:50%;background:var(--ak-color-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--ak-color-accent) 16%,var(--ak-color-background));z-index:1}
.ak-timeline li:not(:last-child)::after{content:"";position:absolute;left:9px;top:calc(.42em + 9px);bottom:-.42em;width:1px;background:var(--ak-color-border)}
.ak-timeline time{display:block;font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ak-color-accent);margin-bottom:.3em}
.ak-timeline li > p:first-of-type{font-family:var(--ak-font-heading)}
.ak-timeline li > p:not(:first-of-type){color:var(--ak-color-text-muted);margin-top:.15em;max-width:var(--ak-measure)}
.ak-table-wrap{overflow-x:auto;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-fill);box-shadow:var(--ak-elevation-card)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
caption{text-align:left;padding-bottom:.5em;color:var(--ak-color-text-muted)}
.ak-table-wrap caption:not(.ak-sr){padding:calc(var(--ak-space-unit) * 1.75) calc(var(--ak-space-unit) * 2);font-family:var(--ak-font-heading);font-weight:600;color:var(--ak-color-text);border-bottom:var(--ak-border-width) solid var(--ak-color-border)}
th,td{text-align:left;padding:.8em calc(var(--ak-space-unit) * 2);border-bottom:var(--ak-border-width) solid var(--ak-color-border);vertical-align:top}
tbody th{font-weight:600}
.ak-table-wrap tbody tr:last-child > *{border-bottom:0}
.ak-table-wrap tbody tr{${TRANSITION}}
.ak-table-wrap tbody tr:hover{background:var(--ak-tint)}
thead th{background:color-mix(in srgb,var(--ak-color-text) 3.5%,var(--ak-color-surface));font-family:var(--ak-font-mono);font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--ak-color-text-muted);white-space:nowrap;padding-top:.9em;padding-bottom:.9em}
.ak-compare{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:1fr 1fr}
.ak-compare .ak-surface{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 1.5)}
.ak-compare h3{display:flex;align-items:center;gap:.6em;font-size:calc(var(--ak-font-size-base) * 1.1)}
.ak-compare h3::before{content:"";width:.55em;height:.55em;border-radius:50%;border:2px solid var(--ak-color-text-muted)}
.ak-compare ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column}
.ak-compare li{position:relative;padding:.55em 0 .55em 1.5em;border-top:var(--ak-border-width) solid var(--ak-color-border)}
.ak-compare li::before{content:"";position:absolute;left:.2em;top:1.15em;width:.4em;height:.4em;border-radius:50%;background:var(--ak-color-text-muted)}
.ak-compare .ak-surface:first-child{background:linear-gradient(180deg,var(--ak-tint),transparent 70%),var(--ak-fill);border-color:color-mix(in srgb,var(--ak-color-accent) 35%,var(--ak-color-border))}
.ak-compare .ak-surface:first-child h3::before{background:var(--ak-color-accent);border-color:var(--ak-color-accent)}
.ak-compare .ak-surface:first-child li::before{background:var(--ak-color-accent)}
.ak-callout,.ak-alert{--ak-tone:var(--ak-color-info);--ak-glyph:"i";position:relative;border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-tone) 26%,var(--ak-color-border));background:color-mix(in srgb,var(--ak-tone) 6%,var(--ak-color-surface));border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 2.25) calc(var(--ak-space-unit) * 3) calc(var(--ak-space-unit) * 2.25) calc(var(--ak-space-unit) * 7);display:flex;flex-direction:column;gap:.35em}
.ak-callout::before,.ak-alert::before{content:var(--ak-glyph);position:absolute;left:calc(var(--ak-space-unit) * 2.5);top:calc(var(--ak-space-unit) * 2.25);width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--ak-tone);color:var(--ak-color-surface);font-family:var(--ak-font-mono);font-size:.8rem;font-weight:700;line-height:1;box-shadow:0 0 0 4px color-mix(in srgb,var(--ak-tone) 16%,transparent)}
.ak-callout p,.ak-alert p{max-width:var(--ak-measure)}
.ak-callout p + p,.ak-alert p + p{margin-top:0}
.ak-callout p:not(.ak-label):not(:has(strong)),.ak-alert p:not(:has(strong)){color:color-mix(in srgb,var(--ak-color-text) 82%,var(--ak-tone))}
.ak-callout .ak-label,.ak-alert .ak-label{color:var(--ak-tone);font-weight:600}
.ak-callout[data-tone="success"],.ak-alert[data-tone="success"]{--ak-tone:var(--ak-color-success);--ak-glyph:"\\2713"}
.ak-callout[data-tone="warning"],.ak-alert[data-tone="warning"]{--ak-tone:var(--ak-color-warning);--ak-glyph:"!"}
.ak-callout[data-tone="danger"],.ak-alert[data-tone="danger"]{--ak-tone:var(--ak-color-danger);--ak-glyph:"\\00D7"}
.ak-alert{border-color:color-mix(in srgb,var(--ak-tone) 45%,var(--ak-color-border));background:color-mix(in srgb,var(--ak-tone) 10%,var(--ak-color-surface))}
.ak-code{margin:0;background:color-mix(in srgb,var(--ak-color-text) 4%,var(--ak-color-surface));border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);overflow:hidden}
.ak-code pre{margin:0;padding:calc(var(--ak-space-unit) * 2.5) calc(var(--ak-space-unit) * 3);overflow-x:auto;font-size:.85rem;line-height:1.7;tab-size:2}
.ak-code-head{display:flex;justify-content:space-between;gap:var(--ak-space-unit);align-items:center;padding:.65em calc(var(--ak-space-unit) * 3);border-bottom:var(--ak-border-width) solid var(--ak-color-border);background:var(--ak-color-surface)}
.ak-code-head .ak-label{display:flex;align-items:center;gap:.6em}
.ak-code-head .ak-label::before{content:"";width:.45rem;height:.45rem;border-radius:2px;background:var(--ak-color-accent)}
.ak-btn{font:inherit;font-size:.92em;font-weight:550;line-height:1.2;display:inline-flex;align-items:center;justify-content:center;gap:.5em;color:var(--ak-color-text);background:var(--ak-color-surface);border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-color-text) 14%,var(--ak-color-border));border-radius:var(--ak-radius-medium);padding:.6em 1.1em;cursor:pointer;min-height:40px;box-shadow:0 1px 2px color-mix(in srgb,var(--ak-color-text) 7%,transparent);text-decoration:none;${TRANSITION}}
.ak-btn:hover{border-color:color-mix(in srgb,var(--ak-color-accent) 55%,var(--ak-color-border));background:var(--ak-tint);color:var(--ak-color-text)}
.ak-btn:active{transform:translateY(1px);box-shadow:none}
.ak-btn:disabled,.ak-btn[aria-disabled="true"]{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
.ak-btn:disabled:hover,.ak-btn[aria-disabled="true"]:hover{background:var(--ak-color-surface);border-color:color-mix(in srgb,var(--ak-color-text) 14%,var(--ak-color-border))}
.ak-btn[data-variant="primary"]{background:var(--ak-color-accent);color:var(--ak-color-accent-contrast);border-color:var(--ak-color-accent);box-shadow:0 1px 2px color-mix(in srgb,var(--ak-color-accent) 30%,transparent),0 4px 14px color-mix(in srgb,var(--ak-color-accent) 22%,transparent)}
.ak-btn[data-variant="primary"]:hover{background:color-mix(in srgb,var(--ak-color-accent) 86%,var(--ak-color-text));color:var(--ak-color-accent-contrast)}
.ak-btn[data-variant="ghost"]{background:transparent;border-color:transparent;box-shadow:none;color:var(--ak-color-accent)}
.ak-btn[data-variant="ghost"]:hover{background:var(--ak-tint);border-color:transparent}
.ak-toolbar{display:flex;flex-wrap:wrap;gap:var(--ak-space-unit);align-items:center;padding:calc(var(--ak-space-unit) * 1);background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);box-shadow:var(--ak-elevation-card)}
.ak-toolbar > .ak-section-head{margin:0 calc(var(--ak-space-unit) * 1) 0 calc(var(--ak-space-unit) * 1)}
.ak-toolbar > .ak-section-head h2{font-size:calc(var(--ak-font-size-base) * 1);letter-spacing:-.005em}
.ak-toolbar > a{display:inline-flex;align-items:center;min-height:40px;padding:0 .75em;margin-left:auto;font-weight:550}
.ak-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column}
.ak-list li{display:flex;gap:calc(var(--ak-space-unit) * 2);align-items:center;justify-content:space-between;border-bottom:var(--ak-border-width) solid var(--ak-color-border);padding:.8em 0}
.ak-list li:first-child{border-top:var(--ak-border-width) solid var(--ak-color-border)}
.ak-list li[hidden]{display:none}
.ak-list li > span:first-child{min-width:0}
li.ak-hidden{display:none}
.ak-progress{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:.6em var(--ak-space-unit)}
.ak-progress .ak-caption{grid-row:1;grid-column:2;font-family:var(--ak-font-mono);font-size:.78rem;font-variant-numeric:tabular-nums;color:var(--ak-color-text)}
.ak-progress progress{grid-column:1 / -1;-webkit-appearance:none;appearance:none;width:100%;height:10px;border:0;border-radius:999px;background:color-mix(in srgb,var(--ak-color-text) 8%,var(--ak-color-surface));overflow:hidden;color:var(--ak-color-accent)}
.ak-progress progress::-webkit-progress-bar{background:color-mix(in srgb,var(--ak-color-text) 8%,var(--ak-color-surface));border-radius:999px}
.ak-progress progress::-webkit-progress-value{background:linear-gradient(90deg,color-mix(in srgb,var(--ak-color-accent) 65%,var(--ak-color-surface)),var(--ak-color-accent));border-radius:999px}
.ak-progress progress::-moz-progress-bar{background:linear-gradient(90deg,color-mix(in srgb,var(--ak-color-accent) 65%,var(--ak-color-surface)),var(--ak-color-accent));border-radius:999px}
.ak-media{margin:0;display:flex;flex-direction:column;gap:.75em}
.ak-media figcaption,.ak-gallery figcaption{font-size:.84rem;color:var(--ak-color-text-muted)}
.ak-media img,.ak-gallery img{display:block;max-width:100%;height:auto;border-radius:var(--ak-radius-medium);border:var(--ak-border-width) solid var(--ak-color-border);background:var(--ak-color-surface-raised);box-shadow:var(--ak-elevation-card)}
.ak-media video{display:block;max-width:100%;border-radius:var(--ak-radius-medium)}
.ak-gallery{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;padding:0;margin:0}
.ak-gallery figure{display:flex;flex-direction:column;gap:.6em}
.ak-gallery img{width:100%;aspect-ratio:16 / 9;object-fit:cover}
.ak-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.ak-section{scroll-margin-top:calc(var(--ak-space-unit) * 3)}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
th.ak-num,td.ak-num{text-align:right;font-variant-numeric:tabular-nums}
td:is(.ak-add,.ak-del,.ak-zero){font-family:var(--ak-font-mono);font-size:.85em;font-weight:600}
td.ak-zero{color:var(--ak-color-text-muted);font-weight:400}
tr:has(.ak-badge) > *{vertical-align:middle}
td.ak-add{color:color-mix(in srgb,var(--ak-color-success) 82%,var(--ak-color-text))}
td.ak-del{color:color-mix(in srgb,var(--ak-color-danger) 82%,var(--ak-color-text))}
td > .ak-badge{vertical-align:middle}
.ak-card[data-tone="info"]{--ak-tone:var(--ak-color-info)}
.ak-card[data-tone="success"]{--ak-tone:var(--ak-color-success)}
.ak-card[data-tone="warning"]{--ak-tone:var(--ak-color-warning)}
.ak-card[data-tone="danger"]{--ak-tone:var(--ak-color-danger)}
.ak-card:not([data-tone="neutral"])[data-tone] > .ak-label:first-child{display:inline-flex;align-items:center;gap:.55em;align-self:flex-start;color:color-mix(in srgb,var(--ak-tone) 78%,var(--ak-color-text))}
.ak-card:not([data-tone="neutral"])[data-tone] > .ak-label:first-child::before{content:"";width:.5em;height:.5em;border-radius:50%;background:var(--ak-tone);box-shadow:0 0 0 3px color-mix(in srgb,var(--ak-tone) 20%,transparent)}
.ak-card:not([data-tone="neutral"])[data-tone]:hover{border-color:color-mix(in srgb,var(--ak-tone) 45%,var(--ak-color-border))}
.ak-code-head{justify-content:flex-start}
.ak-code-lang{margin-left:auto;padding:.15em .65em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:999px;font-family:var(--ak-font-mono);font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted)}
.ak-code-copy{margin-left:auto;display:inline-flex;align-items:center;gap:.7em;min-height:30px;padding:.3em .75em;font:inherit;font-family:var(--ak-font-mono);font-size:.68rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted);background:transparent;border:var(--ak-border-width) solid transparent;border-radius:var(--ak-radius-small);cursor:pointer;${TRANSITION}}
.ak-code-lang + .ak-code-copy{margin-left:0}
.ak-code-copy::before{content:"";width:.7em;height:.8em;border:1.5px solid currentColor;border-radius:2px;box-shadow:2.5px -2.5px 0 -1px var(--ak-color-surface),2.5px -2.5px 0 .5px currentColor}
.ak-code-copy:hover{color:var(--ak-color-accent);background:var(--ak-tint);border-color:color-mix(in srgb,var(--ak-color-accent) 30%,transparent)}
.ak-code-copy[data-ak-copied]{color:color-mix(in srgb,var(--ak-color-success) 82%,var(--ak-color-text));border-color:color-mix(in srgb,var(--ak-color-success) 40%,transparent)}
.ak-code-copy[data-ak-copied]::before{content:"\\2713";width:auto;height:auto;border:0;box-shadow:none;font-size:1.2em;line-height:1}
.ak-code pre:has(.ak-line ~ .ak-line){counter-reset:ak-line;padding-left:calc(var(--ak-space-unit) * 1.5)}
.ak-code .ak-line{counter-increment:ak-line}
.ak-code pre:has(.ak-line ~ .ak-line) .ak-line::before{content:counter(ak-line);display:inline-block;width:2.2em;margin-right:1.4em;text-align:right;color:color-mix(in srgb,var(--ak-color-text-muted) 60%,transparent);-webkit-user-select:none;user-select:none}
.ak-main :is(p,li,td,dd,figcaption) > a[href^="http"]:not(.ak-btn)::after{content:"\\2197";display:inline-block;margin-left:.15em;font-size:.78em;text-decoration:none;opacity:.7}
.ak-progress-rail{display:none}
@supports (animation-timeline:scroll()){.ak-progress-rail{display:block;position:fixed;top:0;left:0;right:0;height:3px;z-index:30;pointer-events:none;background:linear-gradient(90deg,color-mix(in srgb,var(--ak-color-accent) 55%,var(--ak-color-surface)),var(--ak-color-accent));transform-origin:0 50%;transform:scaleX(0);animation:ak-reading linear both;animation-timeline:scroll(root)}@keyframes ak-reading{to{transform:scaleX(1)}}}
.ak-colophon{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--ak-space-unit) calc(var(--ak-space-unit) * 3);margin-top:calc(var(--ak-gap) * 3);padding-top:calc(var(--ak-space-unit) * 2);border-top:var(--ak-border-width) solid var(--ak-color-border);font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.04em;color:var(--ak-color-text-muted)}
.ak-colophon p{margin:0;display:flex;flex-wrap:wrap;gap:.3em 1.4em}
.ak-colophon-title{color:var(--ak-color-text);font-weight:600}
.ak-colophon a{display:inline-flex;align-items:center;gap:.45em;min-height:44px;color:var(--ak-color-text-muted);text-decoration:none;${TRANSITION}}
.ak-colophon a::before{content:"\\2191"}
.ak-colophon a:hover{color:var(--ak-color-accent)}
@media (max-width:768px){body{--ak-font-size-base:16px}.ak-grid:not([data-ak-columns="1"]),.ak-gallery:not([data-ak-columns="1"]){grid-template-columns:repeat(2,minmax(0,1fr))}.ak-compare,.ak-split{grid-template-columns:1fr!important}.ak-shell{padding:calc(var(--ak-space-unit) * 2) calc(var(--ak-space-unit) * 2) calc(var(--ak-space-unit) * 8)}h1{font-size:calc(var(--ak-font-size-base) * 2);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),3))}.ak-hero h1{font-size:calc(var(--ak-font-size-base) * 2.2);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),3.5))}h2{font-size:calc(var(--ak-font-size-base) * 1.4);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),1.5))}.ak-btn{min-height:44px}.ak-toolbar > a{min-height:44px}.ak-code-copy{min-height:44px}.ak-table-wrap table{min-width:560px}.ak-hero{padding-top:calc(var(--ak-space-unit) * 3)}.ak-main > .ak-block + .ak-block:is(.ak-section,:has(> .ak-section-head)){margin-top:calc(var(--ak-gap) * 2)}}
@media (max-width:480px){.ak-grid,.ak-gallery{grid-template-columns:1fr!important}.ak-toolbar{flex-direction:column;align-items:stretch}.ak-toolbar > a{margin-left:0}.ak-stats{grid-template-columns:1fr 1fr}.ak-stat{padding:calc(var(--ak-space-unit) * 2)}.ak-stat dd{font-size:calc(var(--ak-font-size-base) * 1.85)}.ak-kv{grid-template-columns:minmax(0,1fr)}.ak-kv dt{border-bottom:0;padding-bottom:0}.ak-callout,.ak-alert{padding-left:calc(var(--ak-space-unit) * 6)}.ak-callout::before,.ak-alert::before{left:calc(var(--ak-space-unit) * 2)}.ak-quote{padding-left:calc(var(--ak-space-unit) * 4.5)}.ak-quote::before{font-size:calc(var(--ak-font-size-base) * 3.5)}.ak-card,.ak-surface{padding:calc(var(--ak-space-unit) * 2.5)}th,td{padding-left:calc(var(--ak-space-unit) * 1.5);padding-right:calc(var(--ak-space-unit) * 1.5)}}
@media print{body{background:none}.ak-skip,.ak-page-bar,.ak-progress-rail,.ak-code-copy,.ak-colophon a{display:none}.ak-shell{max-width:none;padding:0}.ak-card,.ak-surface,.ak-stat,.ak-stats,.ak-table-wrap,.ak-toolbar{box-shadow:none}}
${SIGNATURE_CSS}
${EFFECTS_CSS}`;
