/** Feature sheet for the chart block, including its data-table disclosure. */

import { disclosureSummary, TRANSITION } from '../../render/style-units.js';

export const CHART_CSS = `.ak-chart{display:flex;flex-direction:column;gap:calc(var(--ak-space-unit) * 2);background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);padding:calc(var(--ak-space-unit) * 3);box-shadow:var(--ak-elevation-card);--ak-c0:var(--ak-color-accent);--ak-c1:var(--ak-color-info);--ak-c2:var(--ak-color-success);--ak-c3:var(--ak-color-warning);--ak-c4:var(--ak-color-danger);--ak-c5:var(--ak-color-text-muted)}
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
@media (max-width:768px){.ak-details summary{min-height:44px}}
.ak-chart:is([data-ak-kind="scatter"],[data-ak-kind="histogram"],[data-ak-kind="stacked-bar"],[data-ak-kind="stacked-bar-100"],[data-ak-kind="waterfall"],[data-ak-kind="heatmap"],[data-ak-kind="funnel"],[data-ak-kind="treemap"]) .ak-chart-canvas svg{min-width:560px}
.ak-chart[data-ak-kind="gauge"] svg{max-height:320px}
.ak-chart .ak-chart-axis-title{fill:var(--ak-color-text-muted);font-family:var(--ak-font-mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
.ak-chart .ak-chart-value--halo{paint-order:stroke;stroke:var(--ak-color-surface);stroke-width:3px;stroke-linejoin:round}
.ak-chart .ak-chart-up{--ak-series:var(--ak-color-success)}
.ak-chart .ak-chart-down{--ak-series:var(--ak-color-danger)}
.ak-chart .ak-chart-net{--ak-series:color-mix(in srgb,var(--ak-color-text) 72%,var(--ak-color-surface))}
.ak-chart .ak-chart-connector{stroke:color-mix(in srgb,var(--ak-color-text) 40%,var(--ak-color-border));stroke-width:1;stroke-dasharray:3 3}
.ak-chart .ak-chart-h0{--ak-heat:.16}
.ak-chart .ak-chart-h1{--ak-heat:.34}
.ak-chart .ak-chart-h2{--ak-heat:.52}
.ak-chart .ak-chart-h3{--ak-heat:.74}
.ak-chart .ak-chart-h4{--ak-heat:1}
.ak-chart .ak-chart-heat{fill:var(--ak-c0);fill-opacity:var(--ak-heat,1);${TRANSITION}}
.ak-chart .ak-chart-heat:is(:hover,:focus-visible){stroke:var(--ak-color-text);stroke-width:1.5}
.ak-chart .ak-chart-heat-swatch{--ak-series:var(--ak-c0);opacity:var(--ak-heat,1)}
.ak-chart .ak-chart-cell{fill:color-mix(in srgb,var(--ak-series,var(--ak-c0)) 22%,var(--ak-color-surface));stroke:var(--ak-series,var(--ak-c0));stroke-width:1.5;${TRANSITION}}
.ak-chart .ak-chart-cell:is(:hover,:focus-visible){fill:color-mix(in srgb,var(--ak-series,var(--ak-c0)) 38%,var(--ak-color-surface))}
.ak-chart .ak-chart-cell-label{fill:var(--ak-color-text);font-family:var(--ak-font-body);font-size:13px;font-weight:600;pointer-events:none}
.ak-chart .ak-chart-cell-value{fill:var(--ak-color-text-muted);font-family:var(--ak-font-mono);font-size:11px;font-variant-numeric:tabular-nums;pointer-events:none}
.ak-chart :is(.ak-chart-heat,.ak-chart-cell):is(:hover,:focus-visible) + .ak-chart-value{opacity:1}
.ak-chart .ak-chart-target{stroke:var(--ak-color-text);stroke-width:2.5;stroke-linecap:round}
.ak-chart .ak-chart-marker-rule{stroke:var(--ak-color-text-muted);stroke-width:1.25;stroke-dasharray:4 4}
.ak-chart .ak-chart-marker-label{fill:var(--ak-color-text);font-family:var(--ak-font-mono);font-size:10.5px;letter-spacing:.04em;text-transform:uppercase}
.ak-chart .ak-chart-note-dot{fill:var(--ak-color-accent);stroke:var(--ak-color-surface);stroke-width:2}
.ak-chart .ak-chart-note-number{fill:var(--ak-color-accent-contrast);font-family:var(--ak-font-mono);font-size:11px;font-weight:700;pointer-events:none}
.ak-chart-notes{margin:0;padding-left:1.6em;font-size:.86rem;color:var(--ak-color-text);display:grid;gap:.25em}
.ak-chart-notes li::marker{font-family:var(--ak-font-mono);font-weight:700;color:var(--ak-color-accent)}
.ak-chart-note-at{color:var(--ak-color-text-muted);font-family:var(--ak-font-mono);font-size:.8em;font-variant-numeric:tabular-nums}`;
