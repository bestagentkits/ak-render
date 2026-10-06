/**
 * Feature sheets for the evidence widgets. `evidence` covers the benchmark
 * comparison, the metric breakdown and the references list; `annotated-image`
 * is separate because it is the only one that positions pins over media.
 *
 * Every value comes from theme tokens. Positions and widths are static rules
 * keyed by quantized attributes (`data-ak-pct`, `data-x`, `data-y`), so the
 * page needs no inline style and no script to lay them out.
 */

import { TRANSITION, UNIT } from '../../render/style-units.js';
import { PIN_STEP } from './annotated-image.js';
import { BREAKDOWN_SERIES } from './metric-breakdown.js';

const MONO_LABEL =
  'font-family:var(--ak-font-mono);font-size:.7rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted)';

/** One rule per value of an integer attribute, e.g. `[data-ak-pct="42"]{width:42%}`. */
function steppedRules(selector: string, attribute: string, property: string, step: number): string {
  const rules: string[] = [];
  for (let value = 0; value <= 100; value += step) {
    rules.push(`${selector}[${attribute}="${value}"]{${property}:${value}%}`);
  }
  return rules.join('');
}

const BENCHMARK_CSS = `.ak-bench{display:flex;flex-direction:column;gap:${UNIT(1.5)}}
.ak-bench-summary{display:flex;flex-wrap:wrap;align-items:center;gap:.5em 1em;margin:0;font-family:var(--ak-font-mono);font-size:.78rem;letter-spacing:.03em;color:var(--ak-color-text-muted)}
.ak-bench-summary strong{color:var(--ak-color-text);font-weight:600}
.ak-bench-tally{padding:.2em .75em;border-radius:999px;background:var(--ak-tint);color:var(--ak-color-text);border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-color-accent) 22%,var(--ak-color-border))}
.ak-bench-metric{display:block;overflow-wrap:anywhere}
.ak-bench-better{display:block;margin-top:.2em;${MONO_LABEL};font-size:.64rem;white-space:nowrap}
.ak-bench-delta{white-space:nowrap;font-weight:600}
.ak-bench-pct{display:block;margin-top:.15em;font-family:var(--ak-font-mono);font-size:.76em;font-weight:500;color:var(--ak-color-text-muted)}
.ak-bench tr[data-verdict="improved"] .ak-bench-delta{color:color-mix(in srgb,var(--ak-color-success) 78%,var(--ak-color-text))}
.ak-bench tr[data-verdict="regressed"] .ak-bench-delta{color:color-mix(in srgb,var(--ak-color-danger) 78%,var(--ak-color-text))}
.ak-bench-notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:${UNIT(1.5)} ${UNIT(3)};margin:0;padding-top:${UNIT(1.5)};border-top:var(--ak-border-width) solid var(--ak-color-border)}
.ak-bench-notes div{min-width:0}
.ak-bench-notes dt{${MONO_LABEL}}
.ak-bench-notes dd{margin:.35em 0 0;font-size:.92rem;color:var(--ak-color-text-muted);overflow-wrap:anywhere}
@media (max-width:560px){.ak-bench .ak-table-wrap table{min-width:0}.ak-bench thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.ak-bench tbody{display:block}.ak-bench tbody tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${UNIT(1)} ${UNIT(2)};padding:${UNIT(1.75)} ${UNIT(2)};border-bottom:var(--ak-border-width) solid var(--ak-color-border)}.ak-bench tbody tr:last-child{border-bottom:0}.ak-bench tbody tr > *{display:block;padding:0;border:0;text-align:left}.ak-bench tbody th{grid-column:1 / -1}.ak-bench td::before{content:attr(data-label);display:block;margin-bottom:.2em;${MONO_LABEL};font-size:.64rem}.ak-bench-delta{white-space:normal}}`;

const SERIES_RULES = Array.from(
  { length: BREAKDOWN_SERIES },
  (_, index) => `.ak-breakdown [data-series="${index}"]{--ak-part:var(--ak-c${index})}`,
).join('\n');

const BREAKDOWN_CSS = `.ak-breakdown{display:flex;flex-direction:column;gap:${UNIT(1.5)};--ak-c0:var(--ak-color-accent);--ak-c1:var(--ak-color-info);--ak-c2:var(--ak-color-success);--ak-c3:var(--ak-color-warning);--ak-c4:var(--ak-color-danger);--ak-c5:var(--ak-color-text-muted)}
@supports (color:oklch(from red l c h)){.ak-breakdown{--ak-c1:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 210));--ak-c2:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 120));--ak-c3:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 60));--ak-c4:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 290));--ak-c5:oklch(from var(--ak-color-accent) l max(c,.1) calc(h + 165))}}
${SERIES_RULES}
.ak-breakdown [data-tone="neutral"]{--ak-part:var(--ak-color-text-muted)}
.ak-breakdown [data-tone="info"]{--ak-part:var(--ak-color-info)}
.ak-breakdown [data-tone="success"]{--ak-part:var(--ak-color-success)}
.ak-breakdown [data-tone="warning"]{--ak-part:var(--ak-color-warning)}
.ak-breakdown [data-tone="danger"]{--ak-part:var(--ak-color-danger)}
.ak-breakdown-total{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.25em 1em;margin:0}
.ak-breakdown-total strong{font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.6);font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--ak-color-text)}
.ak-breakdown-bar{display:flex;height:14px;border-radius:999px;overflow:hidden;background:color-mix(in srgb,var(--ak-color-text) 7%,transparent);print-color-adjust:exact;-webkit-print-color-adjust:exact}
.ak-breakdown-seg{flex:none;box-sizing:border-box;height:100%;background-color:var(--ak-part);background-clip:padding-box}
.ak-breakdown-seg + .ak-breakdown-seg{border-left:2px solid transparent}
.ak-breakdown-seg[data-ak-pct="0"]{display:none}
${steppedRules('.ak-breakdown-seg', 'data-ak-pct', 'width', 1)}
.ak-breakdown [data-hatch] .ak-breakdown-swatch,.ak-breakdown-seg[data-hatch]{background-image:repeating-linear-gradient(135deg,transparent 0 3px,color-mix(in srgb,var(--ak-color-surface) 55%,transparent) 3px 5px)}
.ak-breakdown-list{list-style:none;margin:0;padding:0}
.ak-breakdown-list li{display:grid;grid-template-columns:auto minmax(0,1fr) auto 3.4em;align-items:baseline;gap:.75em;padding:.6em 0;border-bottom:var(--ak-border-width) solid var(--ak-color-border)}
.ak-breakdown-list li:last-child{border-bottom:0}
.ak-breakdown-swatch{align-self:center;width:.75em;height:.75em;border-radius:3px;background-color:var(--ak-part);print-color-adjust:exact;-webkit-print-color-adjust:exact}
.ak-breakdown-label{overflow-wrap:anywhere}
.ak-breakdown-value{font-variant-numeric:tabular-nums;text-align:right;font-weight:600}
.ak-breakdown-share{font-family:var(--ak-font-mono);font-size:.8rem;font-variant-numeric:tabular-nums;text-align:right;color:var(--ak-color-text-muted)}`;

const REFERENCES_CSS = `.ak-ref-list{margin:0;padding-left:2.4em;display:flex;flex-direction:column;gap:${UNIT(1.25)}}
.ak-ref{padding-left:.35em;border-radius:var(--ak-radius-small);scroll-margin-top:${UNIT(4)};${TRANSITION}}
.ak-ref::marker{font-family:var(--ak-font-mono);font-size:.8rem;color:var(--ak-color-text-muted)}
.ak-ref p{margin:0}
.ak-ref-title cite{font-style:normal;font-weight:600;color:var(--ak-color-text);overflow-wrap:anywhere}
.ak-ref .ak-ref-meta{margin-top:.2em;font-size:.84rem;color:var(--ak-color-text-muted);overflow-wrap:anywhere}
.ak-ref .ak-ref-note{margin-top:.3em;font-size:.92rem;color:var(--ak-color-text-muted);max-width:var(--ak-measure)}
.ak-ref:target{background:var(--ak-tint);box-shadow:0 0 0 ${UNIT(0.75)} var(--ak-tint)}
@media print{.ak-ref-title a[href^="http"]::after{content:" <" attr(href) ">";font-weight:400;font-size:.84em;overflow-wrap:anywhere}.ak-ref{break-inside:avoid}.ak-ref:target{background:none;box-shadow:none}}`;

export const EVIDENCE_CSS = [BENCHMARK_CSS, BREAKDOWN_CSS, REFERENCES_CSS].join('\n');

const PIN = `display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--ak-color-accent);color:var(--ak-color-accent-contrast);font-family:var(--ak-font-mono);font-size:.74rem;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;print-color-adjust:exact;-webkit-print-color-adjust:exact`;

export const ANNOTATED_IMAGE_CSS = `.ak-annotated{display:flex;flex-direction:column;gap:${UNIT(1.5)}}
.ak-annotated-stage{position:relative;align-self:flex-start;max-width:100%;overflow:hidden;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface-raised);box-shadow:var(--ak-elevation-card)}
.ak-annotated-stage img{display:block;max-width:100%;height:auto}
.ak-annotated-blocked{display:block;padding:${UNIT(2.5)}}
.ak-annotated-pins{position:absolute;inset:0;list-style:none;margin:0;padding:0;pointer-events:none}
.ak-pin{position:absolute;translate:-50% -50%;${PIN};box-shadow:0 0 0 2px var(--ak-color-accent-contrast),0 4px 12px color-mix(in srgb,var(--ak-color-text) 32%,transparent)}
${steppedRules('.ak-pin', 'data-x', 'left', PIN_STEP)}
${steppedRules('.ak-pin', 'data-y', 'top', PIN_STEP)}
.ak-annotated figcaption{font-size:.84rem;color:var(--ak-color-text-muted)}
.ak-annotated-notes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:${UNIT(1)}}
.ak-annotated-notes li{display:flex;align-items:flex-start;gap:.75em}
.ak-pin-number{flex:none;${PIN};width:22px;height:22px;font-size:.68rem;margin-top:.1em}
.ak-annotated-notes p{margin:0;min-width:0;overflow-wrap:anywhere;max-width:var(--ak-measure)}
.ak-annotated-notes strong{font-weight:600;color:var(--ak-color-text)}
@media (max-width:480px){.ak-pin{width:22px;height:22px;font-size:.66rem}}
@media print{.ak-annotated-stage{box-shadow:none;break-inside:avoid}.ak-annotated-notes li{break-inside:avoid}}`;
