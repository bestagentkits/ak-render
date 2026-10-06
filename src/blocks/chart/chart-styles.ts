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
@media (max-width:768px){.ak-details summary{min-height:44px}}`;
