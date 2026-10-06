/**
 * Feature sheet for the data table. It builds on the base table frame
 * (`.ak-table-wrap`, `th`, `td`, `.ak-num`), adding the search bar, sort
 * buttons, typed cells, the sticky header and the card layout on phones.
 *
 * Every control is hidden until the runtime marks the block ready, and print
 * hides them again and shows every row, so the table reads completely without
 * scripts and on paper.
 */

import { TRANSITION, UNIT } from '../../render/style-units.js';

const ROOT = '.ak-data-table';

const SR_ONLY =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';

const TOOLS = `${ROOT}{display:flex;flex-direction:column;gap:${UNIT(1.5)}}
${ROOT} .ak-table-wrap{position:relative}
${ROOT}:not([data-ak-table-ready]) .ak-dt-tools{display:none}
${ROOT} .ak-dt-tools{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:${UNIT(1)} ${UNIT(2)}}
${ROOT} .ak-dt-search{display:flex;align-items:center;gap:.6em;flex:1 1 240px;max-width:360px}
${ROOT} .ak-dt-search input{flex:1 1 auto;min-width:0;font:inherit;font-size:.94rem;min-height:40px;padding:.45em .9em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface);color:var(--ak-color-text);box-shadow:inset 0 1px 2px color-mix(in srgb,var(--ak-color-text) 6%,transparent);${TRANSITION}}
${ROOT} .ak-dt-search input::placeholder{color:var(--ak-color-text-muted);opacity:.85}
${ROOT} .ak-dt-search input:hover{border-color:color-mix(in srgb,var(--ak-color-text) 30%,var(--ak-color-border))}
${ROOT} .ak-dt-search input:focus-visible{outline:0;border-color:var(--ak-color-accent);box-shadow:var(--ak-ring)}
${ROOT} .ak-dt-count{margin:0;font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
${ROOT} .ak-dt-empty{margin:0;padding:${UNIT(2)};text-align:center;color:var(--ak-color-text-muted);border:var(--ak-border-width) dashed var(--ak-color-border);border-radius:var(--ak-radius-medium)}
${ROOT} .ak-dt-empty[hidden]{display:none}
${ROOT} tbody tr[data-ak-dt-miss]{display:none}`;

const SORT = `${ROOT} .ak-dt-sort{display:inline-flex;align-items:center;gap:.45em;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;white-space:nowrap;${TRANSITION}}
${ROOT} th.ak-num .ak-dt-sort{flex-direction:row-reverse}
${ROOT} .ak-dt-sort:hover,${ROOT} th[aria-sort] .ak-dt-sort{color:var(--ak-color-text)}
${ROOT} .ak-dt-sort-icon{display:inline-block;width:1em;text-align:center;color:var(--ak-color-text-muted);opacity:.55}
${ROOT} .ak-dt-sort-icon::before{content:"\\2195"}
${ROOT} th[aria-sort] .ak-dt-sort-icon{color:var(--ak-color-accent);opacity:1}
${ROOT} th[aria-sort="ascending"] .ak-dt-sort-icon::before{content:"\\2191"}
${ROOT} th[aria-sort="descending"] .ak-dt-sort-icon::before{content:"\\2193"}`;

const CELLS = `${ROOT} .ak-dt-center{text-align:center}
${ROOT} .ak-dt-nowrap{white-space:nowrap}
${ROOT} tbody th[scope="row"]{font-weight:600;white-space:nowrap}
${ROOT} td a{overflow-wrap:anywhere}
${ROOT} .ak-dt-progress{display:inline-flex;align-items:center;gap:.65em;white-space:nowrap}
${ROOT} meter{-webkit-appearance:none;-moz-appearance:none;appearance:none;width:5.5em;height:.5em;border:0;border-radius:999px;background:color-mix(in srgb,var(--ak-color-text) 9%,var(--ak-color-surface));overflow:hidden;vertical-align:middle}
${ROOT} meter::-webkit-meter-bar{height:.5em;border:0;border-radius:999px;background:color-mix(in srgb,var(--ak-color-text) 9%,var(--ak-color-surface))}
${ROOT} meter::-webkit-meter-optimum-value,${ROOT} meter::-webkit-meter-suboptimum-value,${ROOT} meter::-webkit-meter-even-less-good-value{border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb,var(--ak-color-accent) 62%,transparent),var(--ak-color-accent))}
${ROOT} meter::-moz-meter-bar{border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb,var(--ak-color-accent) 62%,transparent),var(--ak-color-accent))}
${ROOT} .ak-dt-spark{display:inline-block;width:6.5em;height:1.6em;vertical-align:middle;overflow:visible}
${ROOT} .ak-dt-spark-area{fill:color-mix(in srgb,var(--ak-color-accent) 14%,transparent)}
${ROOT} .ak-dt-spark-line{fill:none;stroke:var(--ak-color-accent);stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}`;

/**
 * Sticky header, above the card breakpoint only. A frame that has to scroll
 * sideways is the header's scroll container, so the header sticks to the page
 * only once the runtime finds the table fits and clips the frame instead.
 */
const STICKY = `@media (min-width:561px){${ROOT}[data-ak-sticky] thead th{position:sticky;top:0;z-index:1;box-shadow:inset 0 calc(var(--ak-border-width) * -1) 0 var(--ak-color-border)}${ROOT}[data-ak-sticky][data-ak-dt-fits] .ak-table-wrap{overflow:clip}}`;

/** At 560px and below every row becomes a card of labelled values. */
const CARDS = `@media (max-width:560px){${ROOT} .ak-table-wrap{overflow:visible;border:0;border-radius:0;background:none;box-shadow:none;animation:none}
${ROOT} table,${ROOT} tbody,${ROOT} tbody tr,${ROOT} tbody td,${ROOT} tbody th{display:block;width:auto;min-width:0}
${ROOT} thead{${SR_ONLY}}
${ROOT}[data-ak-table-ready] thead{position:static;width:auto;height:auto;margin:0 0 ${UNIT(1)};overflow:visible;clip:auto;white-space:normal;display:block}
${ROOT}[data-ak-table-ready] thead tr{display:flex;flex-wrap:wrap;gap:${UNIT(0.75)}}
${ROOT}[data-ak-table-ready] thead th{padding:0;border:0;background:none;box-shadow:none}
${ROOT}[data-ak-table-ready] .ak-dt-sort{min-height:44px;padding:0 .9em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:999px;background:var(--ak-color-surface)}
${ROOT}[data-ak-table-ready] th[aria-sort] .ak-dt-sort{border-color:color-mix(in srgb,var(--ak-color-accent) 45%,var(--ak-color-border))}
${ROOT} tbody tr{margin:0 0 ${UNIT(1.5)};padding:${UNIT(0.5)} ${UNIT(2)};border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-fill);box-shadow:var(--ak-elevation-card)}
${ROOT} tbody tr:hover{background:var(--ak-fill)}
${ROOT} tbody tr > *{display:flex;align-items:center;justify-content:space-between;gap:${UNIT(2)};padding:.6em 0;text-align:right;min-width:0;overflow-wrap:anywhere}
${ROOT} tbody tr > *:not(:last-child){border-bottom:var(--ak-border-width) solid var(--ak-color-border)}
${ROOT} tbody tr > *::before{content:attr(data-label);flex:none;max-width:45%;text-align:left;font-family:var(--ak-font-mono);font-size:.7rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted)}
${ROOT} tbody th[scope="row"]{justify-content:flex-start;text-align:left;font-family:var(--ak-font-heading);font-size:1.02rem}
${ROOT} tbody th[scope="row"]::before{display:none}
${ROOT} .ak-dt-search{max-width:none}
${ROOT} .ak-dt-search input{min-height:44px}}`;

const NARROW = `@media (max-width:768px) and (min-width:561px){${ROOT}[data-ak-table-ready] thead th{padding-top:0;padding-bottom:0}${ROOT} .ak-dt-sort{min-height:44px}${ROOT} .ak-dt-search input{min-height:44px}}`;

const PRINT = `@media print{${ROOT} .ak-dt-tools,${ROOT} .ak-dt-empty,${ROOT} .ak-dt-sort-icon{display:none!important}${ROOT} tbody tr[data-ak-dt-miss]{display:table-row!important}${ROOT} thead th{position:static!important}${ROOT} tbody tr{break-inside:avoid}}`;

export const DATA_TABLE_CSS = [TOOLS, SORT, CELLS, STICKY, NARROW, CARDS, PRINT].join('\n');
