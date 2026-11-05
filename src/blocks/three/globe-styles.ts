/**
 * Token-driven CSS for `globe-3d`; shipped with the 3D feature. The table,
 * legend chips, swatches and name tag reuse the `network-3d` rules.
 */

export const GLOBE_CSS = `
.ak-globe .ak-3d-stage{background:radial-gradient(42% 58% at 50% 50%,color-mix(in oklab,var(--ak-color-accent) 10%,transparent),transparent 70%),radial-gradient(130% 110% at 30% 0%,var(--ak-color-surface-raised,var(--ak-color-surface)),color-mix(in oklab,var(--ak-color-background) 78%,var(--ak-color-text)))}
.ak-globe-ocean-hi{stop-color:color-mix(in oklab,var(--ak-color-accent) 16%,var(--ak-color-surface-raised,var(--ak-color-surface)))}
.ak-globe-ocean-lo{stop-color:color-mix(in oklab,color-mix(in oklab,var(--ak-color-accent) 12%,var(--ak-color-background)) 82%,var(--ak-color-text))}
.ak-globe-glow-in{stop-color:var(--ak-color-accent);stop-opacity:.42}
.ak-globe-glow-mid{stop-color:var(--ak-color-accent);stop-opacity:.12}
.ak-globe-glow-out{stop-color:var(--ak-color-accent);stop-opacity:0}
.ak-globe-land{fill:none;stroke:color-mix(in oklab,var(--ak-color-text) 72%,var(--ak-color-accent));stroke-width:2.1;stroke-linecap:round}
.ak-globe-land-1{stroke-opacity:.62}
.ak-globe-land-2{stroke-opacity:.34}
.ak-globe-rim{fill:none;stroke:color-mix(in oklab,var(--ak-color-accent) 55%,transparent);stroke-width:1}
.ak-globe-arc{fill:none;stroke-opacity:.9;stroke-linecap:round;fill-opacity:0}
.ak-globe-marker circle{stroke:var(--ak-color-background);stroke-width:1.2;fill-opacity:1}
.ak-globe-stem{fill:none;stroke-width:1.4;stroke-opacity:.85}
.ak-globe-cluster circle{fill-opacity:.28;stroke-width:1.6}
.ak-globe-cluster text{fill:var(--ak-color-text);stroke:none;font:700 11px var(--ak-font-body,inherit);text-anchor:middle;font-variant-numeric:tabular-nums}
.ak-globe-labels text{fill:var(--ak-color-text);font:600 11px var(--ak-font-body,inherit);text-anchor:middle;paint-order:stroke;stroke:var(--ak-color-background);stroke-width:3px;stroke-opacity:.85}
.ak-globe-controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:calc(var(--ak-space-unit)*1.5)}
.ak-globe-controls:empty{display:none}
.ak-globe-time{display:grid;grid-template-columns:auto minmax(10rem,18rem);align-items:center;gap:.25em calc(var(--ak-space-unit)*1.25);font-size:.9em;color:var(--ak-color-text-muted)}
.ak-globe-time output{color:var(--ak-color-text);font-weight:600;font-variant-numeric:tabular-nums}
.ak-globe-time input{accent-color:var(--ak-color-accent);width:100%;min-height:28px;margin:0}
.ak-globe-time input:not([disabled]){cursor:pointer}
.ak-globe-time input:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-globe-time-ends{grid-column:2;display:flex;justify-content:space-between;font-size:.8em;font-variant-numeric:tabular-nums}
.ak-globe-table td{font-variant-numeric:tabular-nums;white-space:nowrap}
.ak-globe-table tr[data-ak-globe-out]{display:none}
.ak-globe-labels-live{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.ak-globe-bubble{position:absolute;left:0;top:0;transform:translate(-50%,-50%);min-width:1.9em;padding:.28em .45em;border-radius:999px;text-align:center;font:700 11px/1 var(--ak-font-body,inherit);color:var(--ak-color-text);font-variant-numeric:tabular-nums;background:color-mix(in oklab,var(--ak-color-surface) 78%,transparent);border:1px solid color-mix(in oklab,var(--ak-color-accent) 60%,transparent);box-shadow:0 0 12px -2px color-mix(in oklab,var(--ak-color-accent) 55%,transparent);backdrop-filter:blur(4px)}
.ak-globe-bubble[hidden]{display:none}
@media (max-width:480px){.ak-globe-time{grid-template-columns:1fr}.ak-globe-time-ends{grid-column:1}}
@media print{.ak-globe-table tr[data-ak-globe-out]{display:table-row}.ak-globe-labels-live,.ak-globe-time{display:none}}
`;
