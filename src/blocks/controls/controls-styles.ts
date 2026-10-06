/**
 * Feature sheets for the input controls and the filter bar. Token-driven:
 * fields take the surface and border tokens, focus uses `--ak-ring`, and the
 * switch is drawn from the accent. Targets reach 44px at the mobile
 * breakpoint. Without scripts the inputs stay disabled and a muted note says
 * so; print hides every control, since a printed control does nothing.
 *
 * The `visibleWhen` wrapper is `display:contents`, so it breaks the base
 * `.ak-block + .ak-block` gap; a view a control switches gets the gap back.
 */

import { TRANSITION, UNIT } from '../../render/style-units.js';

const FIELDS =
  '.ak-control select,.ak-control input[type="text"],.ak-control input[type="number"],.ak-control input[type="date"]';

export const CONTROLS_CSS = `.ak-control{display:flex;flex-direction:column;gap:.45em;min-width:0;max-width:420px;margin-inline:0;padding:0;border:0}
.ak-control>label,.ak-control>legend{font-weight:550;padding:0;margin:0}
fieldset.ak-control>legend{margin-bottom:.45em}
${FIELDS}{font:inherit;width:100%;min-width:0;min-height:40px;padding:.5em .85em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface);color:var(--ak-color-text);box-shadow:inset 0 1px 2px color-mix(in srgb,var(--ak-color-text) 6%,transparent);${TRANSITION}}
.ak-control input::placeholder{color:var(--ak-color-text-muted);opacity:.85}
.ak-control select:not(:disabled),.ak-control input:not(:disabled),.ak-choice:has(input:not(:disabled)) label{cursor:pointer}
.ak-control input[type="text"]:not(:disabled),.ak-control input[type="number"]:not(:disabled){cursor:text}
${FIELDS.split(',')
  .map((field) => `${field}:hover:not(:disabled)`)
  .join(',')}{border-color:color-mix(in srgb,var(--ak-color-text) 30%,var(--ak-color-border))}
${FIELDS.split(',')
  .map((field) => `${field}:focus-visible`)
  .join(',')}{outline:0;border-color:var(--ak-color-accent);box-shadow:var(--ak-ring)}
.ak-control :disabled{opacity:.62;cursor:not-allowed}
.ak-choice-list{display:flex;flex-wrap:wrap;gap:.15em 1.25em}
.ak-choice{display:flex;align-items:center;gap:.6em;min-height:40px}
.ak-choice input{flex:none;width:1.15em;height:1.15em;margin:0;accent-color:var(--ak-color-accent)}
.ak-choice input:focus-visible{outline:0;box-shadow:var(--ak-ring)}
.ak-switch .ak-choice input{appearance:none;-webkit-appearance:none;position:relative;width:2.6em;height:1.5em;border-radius:999px;background:color-mix(in srgb,var(--ak-color-text) 16%,var(--ak-color-surface));border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-color-text) 22%,var(--ak-color-border));${TRANSITION}}
.ak-switch .ak-choice input::before{content:"";position:absolute;top:50%;left:.15em;width:1.05em;height:1.05em;border-radius:50%;background:var(--ak-color-surface);box-shadow:0 1px 3px color-mix(in srgb,var(--ak-color-text) 30%,transparent);translate:0 -50%;transition:translate var(--ak-motion-duration) var(--ak-motion-easing)}
.ak-switch .ak-choice input:checked{background:var(--ak-color-accent);border-color:var(--ak-color-accent)}
.ak-switch .ak-choice input:checked::before{translate:1.1em -50%}
.ak-control-hint{margin:0;font-size:.85em;color:var(--ak-color-text-muted)}
.ak-control-note{margin:0;font-size:.8em;font-style:italic;color:var(--ak-color-text-muted)}
[data-ak-ready]>.ak-control-note{display:none}
.ak-control~[data-ak-when]>.ak-block{margin-top:var(--ak-gap)}
:is(.ak-stack,.ak-grid,.ak-split,.ak-filter-controls)>[data-ak-when]>.ak-block{margin-top:0}
@media (max-width:768px){${FIELDS}{min-height:44px}.ak-choice{min-height:44px}}
@media print{.ak-control{display:none!important}}`;

export const FILTER_BAR_CSS = `.ak-filter-bar{display:flex;flex-direction:column;gap:${UNIT(2)};min-width:0;padding:${UNIT(2.5)};background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);box-shadow:var(--ak-elevation-card)}
.ak-filter-bar>.ak-section-head{margin:0;padding:0;border:0}
.ak-filter-bar>.ak-section-head h3{margin:0;font-size:1rem;letter-spacing:-.005em}
.ak-filter-controls{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));align-items:start;gap:${UNIT(2)}}
@media (min-width:480px){.ak-filter-controls [data-ak-control="checkbox"],.ak-filter-controls [data-ak-control="switch"]{padding-top:calc(1lh + .45em)}}
.ak-filter-controls .ak-block{max-width:none;margin:0}
.ak-filter-controls fieldset.ak-control{grid-column:1 / -1}
.ak-filter-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:${UNIT(1.5)};padding-top:${UNIT(1.5)};border-top:var(--ak-border-width) solid var(--ak-color-border)}
.ak-filter-count{margin:0;font-family:var(--ak-font-mono);font-size:.8rem;letter-spacing:.04em;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
.ak-filter-bar:not([data-ak-ready]) .ak-filter-reset{display:none}
@media (max-width:768px){.ak-filter-reset{min-height:44px}}
@media print{.ak-filter-bar{display:none!important}}`;
