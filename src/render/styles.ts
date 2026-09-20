/**
 * Emitted stylesheets.
 *
 * One base sheet plus per-feature sheets. The compiler emits only the feature
 * sheets a page actually uses, which is both a size win and a correctness
 * property: a page without a carousel cannot ship carousel CSS that a later
 * change could accidentally apply.
 *
 * The sheets are static strings with no interpolation. Everything variable
 * comes from theme tokens, so a spec cannot influence a declaration.
 */

import type { RuntimeFeature } from '../registry/roster.js';

export const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ak-color-background);color:var(--ak-color-text);font-family:var(--ak-font-body);font-size:var(--ak-font-size-base);line-height:var(--ak-line-height)}
.ak-skip{position:absolute;left:-9999px;top:0;background:var(--ak-color-surface);color:var(--ak-color-text);padding:calc(var(--ak-space-unit) * 1.5);z-index:10}
.ak-skip:focus{left:0}
.ak-shell{max-width:1100px;margin:0 auto;padding:calc(var(--ak-space-unit) * 3) calc(var(--ak-space-unit) * 2) calc(var(--ak-space-unit) * 8)}
.ak-main{display:block}
:where(a){color:var(--ak-color-accent)}
:where(h1,h2,h3,h4,h5,h6){font-family:var(--ak-font-heading);line-height:1.2;margin:0}
h1{font-size:calc(var(--ak-font-size-base) * 2.1)}
h2{font-size:calc(var(--ak-font-size-base) * 1.6)}
h3{font-size:calc(var(--ak-font-size-base) * 1.3)}
h4,h5,h6{font-size:calc(var(--ak-font-size-base) * 1.1)}
p{margin:0}
ul,ol{margin:0;padding-left:1.4em}
code,kbd{font-family:var(--ak-font-mono)}
:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-block + .ak-block{margin-top:calc(var(--ak-space-unit) * 3)}
[data-density="compact"] .ak-block + .ak-block{margin-top:calc(var(--ak-space-unit) * 2)}
[data-density="spacious"] .ak-block + .ak-block{margin-top:calc(var(--ak-space-unit) * 4)}
.ak-stack{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 2)}
.ak-stack[data-gap="tight"]{gap:var(--ak-space-unit)}
.ak-stack[data-gap="loose"]{gap:calc(var(--ak-space-unit) * 3)}
.ak-grid{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:repeat(3,minmax(0,1fr))}
.ak-grid[data-ak-columns="1"],.ak-gallery[data-ak-columns="1"]{grid-template-columns:minmax(0,1fr)}
.ak-grid[data-ak-columns="2"],.ak-gallery[data-ak-columns="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
.ak-grid[data-ak-columns="3"],.ak-gallery[data-ak-columns="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}
.ak-grid[data-ak-columns="4"],.ak-gallery[data-ak-columns="4"]{grid-template-columns:repeat(4,minmax(0,1fr))}
.ak-grid[data-ak-columns="5"],.ak-gallery[data-ak-columns="5"]{grid-template-columns:repeat(5,minmax(0,1fr))}
.ak-grid[data-ak-columns="6"],.ak-gallery[data-ak-columns="6"]{grid-template-columns:repeat(6,minmax(0,1fr))}
.ak-split{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:1fr 1fr}
.ak-split[data-ratio="wide-left"]{grid-template-columns:2fr 1fr}
.ak-split[data-ratio="wide-right"]{grid-template-columns:1fr 2fr}
.ak-muted{color:var(--ak-color-text-muted)}
.ak-eyebrow,.ak-label{font-family:var(--ak-font-mono);font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted)}
.ak-hero{gap:var(--ak-space-unit);display:flex;flex-direction:column}
.ak-hero h1{max-width:var(--ak-measure)}
.ak-hero p{max-width:var(--ak-measure);font-size:calc(var(--ak-font-size-base) * 1.1);color:var(--ak-color-text-muted)}
.ak-lead{font-size:calc(var(--ak-font-size-base) * 1.15)}
.ak-caption{font-size:.85rem;color:var(--ak-color-text-muted)}
.ak-prose{max-width:var(--ak-measure)}
.ak-card,.ak-surface{background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 2)}
.ak-card{display:flex;flex-direction:column;gap:var(--ak-space-unit)}
.ak-card--elevated,.ak-surface{box-shadow:var(--ak-elevation-card)}
.ak-section-head{display:flex;flex-direction:column;gap:.35em;margin-bottom:calc(var(--ak-space-unit) * 1.5)}
.ak-divider{border:0;border-top:var(--ak-border-width) solid var(--ak-color-border);margin:calc(var(--ak-space-unit) * 2) 0;display:flex;align-items:center;gap:var(--ak-space-unit)}
.ak-spacer{display:block}
.ak-spacer[data-size="small"]{height:var(--ak-space-unit)}
.ak-spacer[data-size="medium"]{height:calc(var(--ak-space-unit) * 2)}
.ak-spacer[data-size="large"]{height:calc(var(--ak-space-unit) * 4)}
.ak-quote{border-left:3px solid var(--ak-color-accent);padding-left:calc(var(--ak-space-unit) * 2);font-size:calc(var(--ak-font-size-base) * 1.1)}
.ak-quote cite{display:block;margin-top:.5em;color:var(--ak-color-text-muted);font-size:.9rem;font-style:normal}
.ak-badge{display:inline-block;padding:.15em .6em;border-radius:999px;border:var(--ak-border-width) solid var(--ak-color-border);background:var(--ak-color-surface-raised);font-size:.78rem;font-family:var(--ak-font-mono)}
.ak-badge[data-tone="info"]{border-color:var(--ak-color-info);color:var(--ak-color-info)}
.ak-badge[data-tone="success"]{border-color:var(--ak-color-success);color:var(--ak-color-success)}
.ak-badge[data-tone="warning"]{border-color:var(--ak-color-warning);color:var(--ak-color-warning)}
.ak-badge[data-tone="danger"]{border-color:var(--ak-color-danger);color:var(--ak-color-danger)}
.ak-kbd{display:inline-flex;gap:.2em}
.ak-kbd kbd{border:var(--ak-border-width) solid var(--ak-color-border);border-bottom-width:2px;border-radius:var(--ak-radius-small);padding:.1em .4em;background:var(--ak-color-surface-raised);font-size:.85em}
.ak-kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.4em calc(var(--ak-space-unit) * 2);margin:0}
.ak-kv dt{color:var(--ak-color-text-muted)}
.ak-kv dd{margin:0}
.ak-stats{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:0;padding:0;list-style:none}
.ak-stat{background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 1.5)}
.ak-stat dt{font-size:.8rem;color:var(--ak-color-text-muted);font-family:var(--ak-font-mono)}
.ak-stat dd{margin:.2em 0 0;font-size:calc(var(--ak-font-size-base) * 1.5);font-family:var(--ak-font-heading)}
.ak-steps{counter-reset:ak-step;list-style:none;padding:0;display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 1.5)}
.ak-steps li{counter-increment:ak-step;position:relative;padding-left:calc(var(--ak-space-unit) * 4)}
.ak-steps li::before{content:counter(ak-step);position:absolute;left:0;top:0;width:24px;height:24px;border-radius:50%;background:var(--ak-color-accent);color:var(--ak-color-accent-contrast);display:flex;align-items:center;justify-content:center;font-family:var(--ak-font-mono);font-size:.8rem}
.ak-timeline{list-style:none;padding:0;margin:0;border-left:var(--ak-border-width) solid var(--ak-color-border);display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 2)}
.ak-timeline li{position:relative;padding-left:calc(var(--ak-space-unit) * 2)}
.ak-timeline li::before{content:"";position:absolute;left:calc(var(--ak-space-unit) * -1 - 3px);top:.45em;width:7px;height:7px;border-radius:50%;background:var(--ak-color-accent)}
.ak-timeline time{display:block;font-family:var(--ak-font-mono);font-size:.78rem;color:var(--ak-color-text-muted)}
.ak-table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;background:var(--ak-color-surface)}
caption{text-align:left;padding-bottom:.5em;color:var(--ak-color-text-muted)}
th,td{text-align:left;padding:.55em .75em;border-bottom:var(--ak-border-width) solid var(--ak-color-border);vertical-align:top}
thead th{background:var(--ak-color-surface-raised);font-family:var(--ak-font-mono);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
.ak-compare{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:1fr 1fr}
.ak-compare h3{font-size:calc(var(--ak-font-size-base) * 1.05);margin-bottom:.5em}
.ak-compare ul{margin:0}
.ak-callout,.ak-alert{border-left:4px solid var(--ak-color-info);background:var(--ak-color-surface);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 1.5);display:flex;flex-direction:column;gap:.4em}
.ak-callout[data-tone="success"],.ak-alert[data-tone="success"]{border-left-color:var(--ak-color-success)}
.ak-callout[data-tone="warning"],.ak-alert[data-tone="warning"]{border-left-color:var(--ak-color-warning)}
.ak-callout[data-tone="danger"],.ak-alert[data-tone="danger"]{border-left-color:var(--ak-color-danger)}
.ak-code{margin:0;background:var(--ak-color-surface-raised);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 1.5);overflow-x:auto}
.ak-code pre{margin:0;font-family:var(--ak-font-mono);font-size:.88rem;line-height:1.55}
.ak-code-head{display:flex;justify-content:space-between;gap:var(--ak-space-unit);align-items:center;margin-bottom:.5em}
.ak-btn{font:inherit;color:var(--ak-color-text);background:var(--ak-color-surface-raised);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small);padding:.4em .8em;cursor:pointer;min-height:36px}
.ak-btn:hover{border-color:var(--ak-color-accent)}
.ak-btn[data-variant="primary"]{background:var(--ak-color-accent);color:var(--ak-color-accent-contrast);border-color:var(--ak-color-accent)}
.ak-btn[data-variant="ghost"]{background:transparent;border-color:transparent}
.ak-toolbar{display:flex;flex-wrap:wrap;gap:var(--ak-space-unit);align-items:center;padding:var(--ak-space-unit);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium)}
.ak-list{list-style:none;padding:0;display:flex;flex-direction:column;gap:.5em}
.ak-list li{display:flex;gap:.5em;align-items:baseline;justify-content:space-between;border-bottom:var(--ak-border-width) solid var(--ak-color-border);padding-bottom:.4em}
.ak-list li[hidden]{display:none}
li.ak-hidden{display:none}
.ak-progress{display:flex;flex-direction:column;gap:.35em}
.ak-progress progress{width:100%;height:10px}
.ak-progress progress::-webkit-progress-bar{background:var(--ak-color-surface-raised)}
.ak-media{margin:0;display:flex;flex-direction:column;gap:.5em}
.ak-media img,.ak-gallery img{max-width:100%;height:auto;border-radius:var(--ak-radius-medium);border:var(--ak-border-width) solid var(--ak-color-border);background:var(--ak-color-surface-raised)}
.ak-media video{max-width:100%;border-radius:var(--ak-radius-medium)}
.ak-gallery{display:grid;gap:calc(var(--ak-space-unit) * 2);grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;padding:0;margin:0}
.ak-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (max-width:768px){body{--ak-font-size-base:16px}.ak-grid,.ak-compare,.ak-split,.ak-gallery{grid-template-columns:1fr!important}.ak-shell{padding:calc(var(--ak-space-unit) * 2) var(--ak-space-unit) calc(var(--ak-space-unit) * 6)}h1{font-size:calc(var(--ak-font-size-base) * 1.7)}}
@media (max-width:480px){.ak-toolbar{flex-direction:column;align-items:stretch}.ak-stats{grid-template-columns:1fr 1fr}}
@media print{.ak-skip,.ak-theme-toggle{display:none}}`;

export const FEATURE_CSS: Readonly<Partial<Record<RuntimeFeature, string>>> = {
  tabs: `.ak-tabs [role="tablist"]{display:flex;flex-wrap:wrap;gap:.25em;border-bottom:var(--ak-border-width) solid var(--ak-color-border);margin-bottom:calc(var(--ak-space-unit) * 1.5)}
.ak-tabs [role="tab"]{font:inherit;background:transparent;border:0;border-bottom:2px solid transparent;padding:.5em .8em;cursor:pointer;color:var(--ak-color-text-muted)}
.ak-tabs [role="tab"][aria-selected="true"]{color:var(--ak-color-text);border-bottom-color:var(--ak-color-accent)}
.ak-tabs [role="tabpanel"]{padding:0}
.ak-tabs [role="tabpanel"][hidden]{display:none}`,

  accordion: `.ak-accordion{display:flex;flex-direction:column;gap:.4em}
.ak-accordion details{background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * .75) var(--ak-space-unit)}
.ak-accordion summary{cursor:pointer;font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.02)}
.ak-accordion details[open] summary{margin-bottom:.5em}`,

  carousel: `.ak-carousel{display:flex;flex-direction:column;gap:var(--ak-space-unit)}
.ak-carousel-slides{position:relative;min-height:120px}
.ak-carousel-slide{background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 2)}
.ak-carousel-slide[hidden]{display:none}
.ak-carousel-controls{display:flex;gap:var(--ak-space-unit);align-items:center}
.ak-carousel-status{font-family:var(--ak-font-mono);font-size:.8rem;color:var(--ak-color-text-muted)}`,

  slider: `.ak-slider{display:flex;flex-direction:column;gap:.35em;max-width:420px}
.ak-slider input[type="range"]{width:100%}
.ak-slider output{font-family:var(--ak-font-mono);font-size:.85rem;color:var(--ak-color-text-muted)}`,

  dialog: `dialog.ak-dialog{max-width:min(560px,92vw);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:var(--ak-color-surface);color:var(--ak-color-text);padding:calc(var(--ak-space-unit) * 2);box-shadow:var(--ak-elevation-popover)}
dialog.ak-dialog::backdrop{background:rgba(0,0,0,.5)}
.ak-dialog-actions{display:flex;gap:var(--ak-space-unit);justify-content:flex-end;margin-top:calc(var(--ak-space-unit) * 1.5)}`,

  chart: `.ak-chart{display:flex;flex-direction:column;gap:var(--ak-space-unit)}
.ak-chart svg{width:100%;height:auto;overflow:visible}
.ak-chart figcaption{font-size:.85rem;color:var(--ak-color-text-muted)}
.ak-chart .ak-chart-bar{fill:var(--ak-color-accent)}
.ak-chart .ak-chart-bar--alt{fill:var(--ak-color-info)}
.ak-chart .ak-chart-line{fill:none;stroke:var(--ak-color-accent);stroke-width:2}
.ak-chart .ak-chart-area{fill:var(--ak-color-accent);opacity:.18}
.ak-chart .ak-chart-axis{stroke:var(--ak-color-border);stroke-width:1}
.ak-chart .ak-chart-label{fill:var(--ak-color-text-muted);font-family:var(--ak-font-mono);font-size:10px}
.ak-chart :focus-visible{outline:2px solid var(--ak-color-accent)}
.ak-details{margin-top:var(--ak-space-unit)}
.ak-details summary{cursor:pointer;color:var(--ak-color-text-muted);font-size:.85rem}`,

  filter: `.ak-search{display:flex;flex-direction:column;gap:.35em;max-width:380px}
.ak-search input{font:inherit;padding:.45em .6em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small);background:var(--ak-color-surface);color:var(--ak-color-text)}`,

  theme: `.ak-theme-toggle{margin-left:auto}`,

  media: `.ak-media-fallback{display:flex;flex-direction:column;gap:.35em;background:var(--ak-color-surface);border:var(--ak-border-width) dashed var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 1.5)}
.ak-media-fallback img{max-width:100%;border-radius:var(--ak-radius-small)}`,

  diagram: `.ak-diagram{overflow-x:auto}
.ak-diagram svg{max-width:100%;height:auto}
.ak-diagram-fallback{background:var(--ak-color-surface-raised);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 1.5)}`,
};
