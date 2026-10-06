/**
 * Feature sheets for the engineering widgets. Each sheet is emitted only when a
 * page uses its block, and every colour is a theme token or a `color-mix()` of
 * tokens. Status is always stated in text; tone only reinforces it.
 */

import { scrollEdges } from '../../render/derived-variables.js';
import { EASE_OUT, MID, TRANSITION, UNIT } from '../../render/style-units.js';
import { ROADMAP_MAX_PERIODS } from './roadmap.js';

const HAIRLINE = 'var(--ak-border-width) solid var(--ak-color-border)';
const MONO_LABEL =
  'font-family:var(--ak-font-mono);font-size:.7rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase';

/** Tone custom property for `[data-tone]` words, scoped to one block. */
function toneScope(scope: string): string {
  return `${scope} [data-tone]{--ak-tone:var(--ak-color-text-muted)}
${scope} [data-tone="info"]{--ak-tone:var(--ak-color-info)}
${scope} [data-tone="success"]{--ak-tone:var(--ak-color-success)}
${scope} [data-tone="warning"]{--ak-tone:var(--ak-color-warning)}
${scope} [data-tone="danger"]{--ak-tone:var(--ak-color-danger)}`;
}

/** A disclosure chevron on `summary` that turns when `openSummary` (its open form) matches. */
function chevron(summary: string, openSummary: string): string {
  return `${summary}{list-style:none;cursor:pointer}
${summary}::-webkit-details-marker{display:none}
${summary}::before{content:"";flex:none;align-self:center;width:.4em;height:.4em;margin:0 .2em 0 .05em;border-right:1.5px solid var(--ak-color-text-muted);border-bottom:1.5px solid var(--ak-color-text-muted);rotate:-45deg;transition:rotate var(--ak-motion-duration) var(--ak-motion-easing)}
${openSummary}::before{rotate:45deg}`;
}

export const KANBAN_CSS = `.ak-kanban{position:relative;overflow-x:auto;overscroll-behavior-x:contain;padding:2px 2px ${UNIT(1)};margin:-2px;border-radius:var(--ak-radius-large)}
.ak-kanban:focus-visible{outline:0;box-shadow:var(--ak-ring)}
.ak-kanban-cols{list-style:none;margin:0;padding:0;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(232px,1fr);gap:${UNIT(1.5)};align-items:start}
.ak-kanban-col{display:flex;flex-direction:column;gap:${UNIT(1)};min-width:0;padding:${UNIT(1.25)};border:${HAIRLINE};border-radius:var(--ak-radius-large);background:color-mix(in srgb,var(--ak-color-text) 3%,var(--ak-color-background))}
.ak-kanban-col-head{display:flex;align-items:center;justify-content:space-between;gap:.5em;margin:0;padding:.2em .35em;${MONO_LABEL};color:var(--ak-color-text-muted)}
.ak-kanban-col-head > span:first-child{min-width:0;overflow-wrap:anywhere}
.ak-kanban-count{flex:none;min-width:2em;padding:.1em .55em;border-radius:999px;background:color-mix(in srgb,var(--ak-color-text) 8%,transparent);color:var(--ak-color-text);text-align:center;letter-spacing:0;font-variant-numeric:tabular-nums}
.ak-kanban-cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:${UNIT(1)}}
.ak-kanban-card{display:flex;flex-direction:column;gap:.35em;min-width:0;padding:${UNIT(1.5)};border:${HAIRLINE};border-radius:var(--ak-radius-medium);background:var(--ak-fill);box-shadow:var(--ak-elevation-card);transition:translate ${MID} ${EASE_OUT},box-shadow ${MID} ${EASE_OUT},border-color var(--ak-motion-duration) var(--ak-motion-easing)}
.ak-kanban-card:hover{translate:0 -2px;border-color:color-mix(in srgb,var(--ak-color-accent) 35%,var(--ak-color-border));box-shadow:var(--ak-elevation-popover)}
.ak-kanban-card[hidden]{display:none}
.ak-kanban-card > p{margin:0}
.ak-kanban-card-title{font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.ak-kanban-card-text{font-size:.88rem;color:var(--ak-color-text-muted)}
.ak-kanban-meta{display:flex;flex-wrap:wrap;align-items:center;gap:.35em .45em;padding-top:.3em}
.ak-kanban-owner{margin-right:auto;font-size:.8rem;font-weight:550;color:var(--ak-color-text-muted)}
.ak-kanban-tag{padding:.1em .5em;border-radius:var(--ak-radius-small);background:color-mix(in srgb,var(--ak-color-accent) 10%,transparent);color:color-mix(in srgb,var(--ak-color-accent) 72%,var(--ak-color-text));font-family:var(--ak-font-mono);font-size:.68rem}
.ak-kanban-empty{margin:0;padding:${UNIT(1.5)};border:var(--ak-border-width) dashed var(--ak-color-border);border-radius:var(--ak-radius-medium);text-align:center;font-size:.85rem;color:var(--ak-color-text-muted)}
@media (max-width:768px){.ak-kanban{scroll-snap-type:x mandatory}.ak-kanban-cols{grid-auto-columns:85%}.ak-kanban-col{scroll-snap-align:start}}
@media print{.ak-kanban{overflow:visible}.ak-kanban-cols{grid-auto-flow:row;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}.ak-kanban-card{box-shadow:none;break-inside:avoid}}`;

/** Column count and item placement for 1..24 periods, as attribute rules instead of inline styles. */
function roadmapPlacement(): string {
  const rules: string[] = [];
  for (let index = 2; index <= ROADMAP_MAX_PERIODS; index += 1) {
    rules.push(`.ak-roadmap-grid[data-ak-cols="${index}"]{--ak-rm-cols:${index}}`);
  }
  for (let index = 1; index <= ROADMAP_MAX_PERIODS; index += 1) {
    rules.push(`.ak-roadmap-item[data-ak-start="${index}"]{grid-column-start:${index}}`);
    rules.push(`.ak-roadmap-item[data-ak-end="${index}"]{grid-column-end:${index + 1}}`);
  }
  return rules.join('\n');
}

export const ROADMAP_CSS = `.ak-roadmap{position:relative;overflow-x:auto;overscroll-behavior-x:contain;border:${HAIRLINE};border-radius:var(--ak-radius-large);background:var(--ak-fill);box-shadow:var(--ak-elevation-card)}
${scrollEdges('.ak-roadmap')}
.ak-roadmap:focus-visible{outline:0;box-shadow:var(--ak-ring)}
.ak-roadmap-grid{--ak-rm-cols:2;min-width:max(100%,calc(var(--ak-rm-cols) * 88px + ${UNIT(4)}));padding:${UNIT(2)};background:linear-gradient(90deg,color-mix(in srgb,var(--ak-color-border) 70%,transparent) var(--ak-border-width),transparent var(--ak-border-width)) content-box 0 0/calc(100% / var(--ak-rm-cols)) 100% repeat-x}
${roadmapPlacement()}
.ak-roadmap-periods,.ak-roadmap-items{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(var(--ak-rm-cols),minmax(0,1fr))}
.ak-roadmap-periods{margin-bottom:${UNIT(1.5)};padding-bottom:${UNIT(1)};border-bottom:${HAIRLINE}}
.ak-roadmap-periods li{padding:0 .7em;${MONO_LABEL};color:var(--ak-color-text-muted);overflow-wrap:anywhere}
.ak-roadmap-lane + .ak-roadmap-lane{margin-top:${UNIT(1.5)};padding-top:${UNIT(1.5)};border-top:var(--ak-border-width) dashed var(--ak-color-border)}
.ak-roadmap-lane-title{margin:0 0 ${UNIT(1)} .35em;font-size:.95rem;letter-spacing:-.005em}
.ak-roadmap-items{grid-auto-flow:row dense;row-gap:${UNIT(0.75)}}
.ak-roadmap-block [data-status]{--ak-rm-tone:var(--ak-color-text-muted)}
.ak-roadmap-block [data-status="active"]{--ak-rm-tone:var(--ak-color-accent)}
.ak-roadmap-block [data-status="done"]{--ak-rm-tone:var(--ak-color-success)}
.ak-roadmap-block [data-status="at-risk"]{--ak-rm-tone:var(--ak-color-warning)}
.ak-roadmap-item,.ak-roadmap-entry{display:flex;flex-direction:column;gap:.2em;min-width:0;padding:.55em .75em;border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-rm-tone) 38%,var(--ak-color-border));border-radius:var(--ak-radius-medium);background:color-mix(in srgb,var(--ak-rm-tone) 11%,var(--ak-color-surface))}
.ak-roadmap-item{margin:0 4px;${TRANSITION}}
.ak-roadmap-item:hover{border-color:color-mix(in srgb,var(--ak-rm-tone) 70%,var(--ak-color-border))}
.ak-roadmap-item[data-status="planned"],.ak-roadmap-entry[data-status="planned"]{border-style:dashed;background:var(--ak-color-surface)}
.ak-roadmap-item-title{font-size:.9rem;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.ak-roadmap-meta{display:flex;flex-wrap:wrap;align-items:center;gap:.15em .7em;font-family:var(--ak-font-mono);font-size:.68rem;letter-spacing:.03em;color:var(--ak-color-text-muted)}
.ak-roadmap-status{display:inline-flex;align-items:center;gap:.4em;font-weight:600;color:color-mix(in srgb,var(--ak-rm-tone) 78%,var(--ak-color-text))}
.ak-roadmap-status::before{content:"";width:.5em;height:.5em;border-radius:50%;background:currentColor}
.ak-roadmap-empty{margin:0 .35em;font-size:.85rem;color:var(--ak-color-text-muted)}
.ak-roadmap-agenda{display:none;list-style:none;margin:0;padding:0;flex-direction:column;gap:${UNIT(2)}}
.ak-roadmap-period{margin:0 0 ${UNIT(1)};${MONO_LABEL};color:var(--ak-color-accent)}
.ak-roadmap-agenda ul{list-style:none;margin:0 0 0 .3em;padding:0 0 0 ${UNIT(1.5)};border-left:2px solid color-mix(in srgb,var(--ak-color-accent) 30%,var(--ak-color-border));display:flex;flex-direction:column;gap:${UNIT(1)}}
@media (max-width:560px){.ak-roadmap{display:none}.ak-roadmap-agenda{display:flex}}
@media print{.ak-roadmap{display:none}.ak-roadmap-agenda{display:flex}.ak-roadmap-entry{break-inside:avoid}}`;

export const TEST_RESULTS_CSS = `.ak-tests{display:flex;flex-direction:column;gap:${UNIT(2)}}
.ak-tests-summary{--ak-tone:var(--ak-color-success);display:flex;flex-direction:column;gap:${UNIT(1.75)};padding:${UNIT(2.5)};border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-tone) 32%,var(--ak-color-border));border-radius:var(--ak-radius-large);background:color-mix(in srgb,var(--ak-tone) 7%,var(--ak-fill));box-shadow:var(--ak-elevation-card)}
.ak-tests-summary[data-status="fail"]{--ak-tone:var(--ak-color-danger)}
.ak-tests-verdict{display:flex;align-items:center;gap:.6em;margin:0;font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.3);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),1.4));font-weight:700;line-height:1.2;letter-spacing:-.02em}
.ak-tests-verdict::before{content:"";flex:none;width:.55em;height:.55em;border-radius:50%;background:var(--ak-tone);box-shadow:0 0 0 4px color-mix(in srgb,var(--ak-tone) 22%,transparent)}
.ak-tests-bar{display:block;width:100%;height:10px;border-radius:999px;overflow:hidden;background:color-mix(in srgb,var(--ak-color-text) 8%,var(--ak-color-surface))}
.ak-tests-seg[data-status="pass"]{fill:var(--ak-color-success)}
.ak-tests-seg[data-status="fail"]{fill:var(--ak-color-danger)}
.ak-tests-seg[data-status="flaky"]{fill:var(--ak-color-warning)}
.ak-tests-seg[data-status="skip"]{fill:color-mix(in srgb,var(--ak-color-text) 28%,var(--ak-color-surface))}
.ak-tests-counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:${UNIT(1.5)};margin:0}
.ak-tests-counts > div{display:flex;flex-direction:column;gap:.15em;min-width:0}
.ak-tests-counts dt{${MONO_LABEL};font-weight:500;color:var(--ak-color-text-muted)}
.ak-tests-counts dd{margin:0;font-family:var(--ak-font-heading);font-size:1.4rem;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.ak-tests-counts [data-status="fail"] dd{color:color-mix(in srgb,var(--ak-color-danger) 82%,var(--ak-color-text))}
.ak-tests-counts [data-status="pass"] dd{color:color-mix(in srgb,var(--ak-color-success) 82%,var(--ak-color-text))}
.ak-tests-counts [data-status="flaky"] dd{color:color-mix(in srgb,var(--ak-color-warning) 82%,var(--ak-color-text))}
.ak-tests-suites{display:flex;flex-direction:column;gap:${UNIT(1)}}
.ak-tests-suite{border:${HAIRLINE};border-radius:var(--ak-radius-medium);background:var(--ak-fill);${TRANSITION}}
.ak-tests-suite[data-status="fail"]{border-color:color-mix(in srgb,var(--ak-color-danger) 40%,var(--ak-color-border))}
.ak-tests-suite > summary{display:flex;flex-wrap:wrap;align-items:center;gap:.3em ${UNIT(1.5)};min-height:48px;padding:${UNIT(1.25)} ${UNIT(2)};border-radius:inherit;${TRANSITION}}
${chevron('.ak-tests-suite > summary', '.ak-tests-suite[open] > summary')}
.ak-tests-suite > summary:hover{background:var(--ak-tint)}
.ak-tests-suite-name{font-weight:650;overflow-wrap:anywhere}
.ak-tests-suite-counts{margin-left:auto;font-family:var(--ak-font-mono);font-size:.74rem;color:var(--ak-color-text-muted)}
.ak-tests-cases{list-style:none;margin:0;padding:0 ${UNIT(2)} ${UNIT(1)}}
.ak-tests-case{--ak-tone:var(--ak-color-danger);display:flex;flex-direction:column;gap:.4em;padding:.65em 0;border-top:${HAIRLINE}}
.ak-tests-case[data-status="flaky"]{--ak-tone:var(--ak-color-warning)}
.ak-tests-case-head{display:flex;flex-wrap:wrap;align-items:center;gap:.4em .75em}
.ak-tests-case-head .ak-badge{min-width:5.6em;justify-content:center}
.ak-tests-name{flex:1 1 14em;min-width:0;font-size:.92rem;overflow-wrap:anywhere}
.ak-tests-case[data-status="skip"] .ak-tests-name{color:var(--ak-color-text-muted)}
.ak-tests-time{font-family:var(--ak-font-mono);font-size:.74rem;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
.ak-tests-case > .ak-tests-file{align-self:flex-start;font-size:.76rem;color:var(--ak-color-text-muted);overflow-wrap:anywhere}
.ak-tests-message{margin:0;padding:${UNIT(1.25)} ${UNIT(1.5)};border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-tone) 26%,var(--ak-color-border));border-radius:var(--ak-radius-small);background:color-mix(in srgb,var(--ak-tone) 7%,var(--ak-color-surface));font-size:.8rem;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
@media (max-width:560px){.ak-tests-summary{padding:${UNIT(2)}}.ak-tests-suite > summary{padding:${UNIT(1.25)} ${UNIT(1.5)}}.ak-tests-cases{padding:0 ${UNIT(1.5)} ${UNIT(1)}}.ak-tests-suite-counts{margin-left:0;flex-basis:100%}}
@media print{.ak-tests-summary{box-shadow:none}.ak-tests-suite::details-content{content-visibility:visible;display:block}.ak-tests-case{break-inside:avoid}}`;

export const LOG_VIEWER_CSS = `.ak-log-search{margin-bottom:${UNIT(1.5)}}
.ak-log{overflow:hidden;border:${HAIRLINE};border-radius:var(--ak-radius-large);background:var(--ak-fill);box-shadow:var(--ak-elevation-card)}
${toneScope('.ak-log-block')}
.ak-log-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5em ${UNIT(1.5)};padding:${UNIT(1.25)} ${UNIT(2)};border-bottom:${HAIRLINE};background:var(--ak-color-surface)}
.ak-log-total{margin:0;${MONO_LABEL};font-weight:500;color:var(--ak-color-text-muted)}
.ak-log-counts{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.4em}
.ak-log-counts li{padding:.1em .6em;border-radius:999px;background:color-mix(in srgb,var(--ak-tone) 12%,transparent);color:color-mix(in srgb,var(--ak-tone) 78%,var(--ak-color-text));font-family:var(--ak-font-mono);font-size:.7rem;font-variant-numeric:tabular-nums}
.ak-log-lines{list-style:none;margin:0;padding:${UNIT(1)} 0;display:grid;grid-template-columns:max-content max-content minmax(0,max-content) minmax(0,1fr);font-family:var(--ak-font-mono);font-size:.8rem;line-height:1.55}
.ak-log-line{display:grid;grid-column:1 / -1;grid-template-columns:auto auto auto minmax(0,1fr);grid-template-columns:subgrid;column-gap:${UNIT(1.5)};align-items:baseline;padding:.2em ${UNIT(2)};${TRANSITION}}
.ak-log-line:hover{background:var(--ak-tint)}
.ak-log-line[hidden]{display:none}
.ak-log-line[data-level="error"]{background:color-mix(in srgb,var(--ak-color-danger) 6%,transparent)}
.ak-log-line[data-level="warn"]{background:color-mix(in srgb,var(--ak-color-warning) 5%,transparent)}
.ak-log-time{color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.ak-log-level{font-size:.7rem;font-weight:700;letter-spacing:.06em;color:color-mix(in srgb,var(--ak-tone) 82%,var(--ak-color-text))}
.ak-log-source{color:var(--ak-color-text-muted);overflow-wrap:anywhere}
.ak-log-message{white-space:pre-wrap;overflow-wrap:anywhere}
@media (max-width:560px){.ak-log-lines{grid-template-columns:max-content max-content minmax(0,1fr)}.ak-log-line{padding:.35em ${UNIT(1.5)}}.ak-log-message{grid-column:1 / -1}.ak-log-head{padding:${UNIT(1.25)} ${UNIT(1.5)}}}
@media print{.ak-log-search{display:none}.ak-log{box-shadow:none}.ak-log-line{break-inside:avoid}}`;

export const API_ENDPOINT_CSS = `.ak-api{display:flex;flex-direction:column;gap:${UNIT(2)};padding:${UNIT(3)};border:${HAIRLINE};border-radius:var(--ak-radius-large);background:var(--ak-fill);box-shadow:var(--ak-elevation-card)}
${toneScope('.ak-api')}
.ak-api-head{display:flex;flex-wrap:wrap;align-items:center;gap:${UNIT(1)} ${UNIT(1.5)}}
.ak-api-title{display:flex;flex-wrap:wrap;align-items:center;gap:.6em;flex:1 1 16em;min-width:0;margin:0;font-size:1rem;letter-spacing:0}
.ak-api-method{flex:none;padding:.3em .7em;border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-tone) 42%,var(--ak-color-border));border-radius:var(--ak-radius-small);background:color-mix(in srgb,var(--ak-tone) 13%,var(--ak-color-surface));color:color-mix(in srgb,var(--ak-tone) 75%,var(--ak-color-text));font-family:var(--ak-font-mono);font-size:.78rem;font-weight:700;letter-spacing:.06em}
.ak-api-title .ak-api-path{min-width:0;padding:0;border:0;background:none;font-size:1.05rem;font-weight:600;overflow-wrap:anywhere}
.ak-api-param{padding:0 .12em;border-radius:3px;background:var(--ak-tint);color:var(--ak-color-accent)}
.ak-api-summary{max-width:var(--ak-measure);color:var(--ak-color-text-muted)}
.ak-api-heading{margin:${UNIT(0.5)} 0 calc(var(--ak-space-unit) * -1);${MONO_LABEL};color:var(--ak-color-text-muted)}
.ak-api-required{margin-left:.5em;font-family:var(--ak-font-mono);font-size:.64rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:color-mix(in srgb,var(--ak-color-danger) 80%,var(--ak-color-text))}
.ak-api-responses{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:${UNIT(1.5)}}
.ak-api-response{display:flex;flex-direction:column;gap:${UNIT(1)}}
.ak-api-response-head{display:flex;align-items:baseline;gap:.6em}
.ak-api-response-head > span:last-child{flex:1 1 0%;min-width:0}
@media (max-width:560px){.ak-api{padding:${UNIT(2)}}}
@media print{.ak-api{box-shadow:none}}`;

export const SCHEMA_VIEWER_CSS = `.ak-schema{padding:${UNIT(2)} ${UNIT(2.5)};border:${HAIRLINE};border-radius:var(--ak-radius-large);background:var(--ak-fill);box-shadow:var(--ak-elevation-card);font-size:.9rem}
.ak-schema ul{list-style:none;margin:0;padding:0}
.ak-schema ul ul{margin-left:.4em;padding-left:${UNIT(1.5)};border-left:${HAIRLINE}}
.ak-schema li{padding:.1em 0}
.ak-schema-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:.15em .6em;padding:.25em .45em;margin-left:-.45em;border-radius:var(--ak-radius-small);${TRANSITION}}
${chevron('.ak-schema summary', '.ak-schema details[open] > summary')}
div.ak-schema-row::before{content:"";flex:none;align-self:center;width:.36em;height:.36em;margin:0 .22em 0 .07em;border-radius:50%;background:color-mix(in srgb,var(--ak-color-text) 28%,transparent)}
.ak-schema-row:hover{background:var(--ak-tint)}
.ak-schema-name{font-family:var(--ak-font-mono);font-weight:600;overflow-wrap:anywhere}
.ak-schema-type{font-family:var(--ak-font-mono);font-size:.8rem;color:color-mix(in srgb,var(--ak-color-accent) 78%,var(--ak-color-text));overflow-wrap:anywhere}
.ak-schema-type[data-implicit]{font-style:italic;color:var(--ak-color-text-muted)}
.ak-schema-required{font-family:var(--ak-font-mono);font-size:.64rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:color-mix(in srgb,var(--ak-color-danger) 80%,var(--ak-color-text))}
.ak-schema-desc{max-width:var(--ak-measure);margin:0 0 .2em 1.15em;font-size:.85rem;color:var(--ak-color-text-muted)}
@media (max-width:560px){.ak-schema{padding:${UNIT(1.5)} ${UNIT(2)}}.ak-schema ul ul{padding-left:${UNIT(1)}}}
@media print{.ak-schema{box-shadow:none}.ak-schema details::details-content{content-visibility:visible;display:block}}`;
