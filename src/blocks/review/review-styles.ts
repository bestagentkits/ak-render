/**
 * The review sheet: decision cards, the feedback panel, and the pieces the
 * runtime adds (section Comment buttons, the selection button, the comment
 * editor and the bottom bar). Token-driven. Without scripts the inputs stay
 * disabled and a muted note says so; print keeps the questions, the chosen
 * answers and the comments, and hides every control.
 */

import { TRANSITION, UNIT } from '../../render/style-units.js';

const CARD = `background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);box-shadow:var(--ak-elevation-card)`;
const FIELD = `font:inherit;width:100%;min-height:44px;padding:.55em .85em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface);color:var(--ak-color-text);resize:vertical;${TRANSITION}`;
const POPUP = `position:absolute;z-index:40;${CARD};box-shadow:var(--ak-elevation-popover)`;

export const REVIEW_CSS = `.ak-decision{display:flex;flex-direction:column;gap:${UNIT(1.5)};min-width:0;margin-inline:0;padding:${UNIT(3)};${CARD}}
.ak-decision>legend{float:left;width:100%;padding:0;margin:0 0 ${UNIT(0.5)};font-weight:650;font-size:calc(var(--ak-font-size-base) * 1.12);letter-spacing:-.01em}
.ak-decision-context{margin:0;color:var(--ak-color-text-muted)}
.ak-decision-options{display:grid;gap:${UNIT(1)}}
.ak-decision-option{position:relative;display:flex;align-items:flex-start;gap:.75em;padding:.75em 1em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface);${TRANSITION}}
.ak-decision-option:has(input:checked){border-color:var(--ak-color-accent);background:var(--ak-tint)}
.ak-decision-option:has(input:not(:disabled)):hover{border-color:color-mix(in srgb,var(--ak-color-accent) 55%,var(--ak-color-border))}
.ak-decision-option input{position:relative;z-index:1;flex:none;width:1.15em;height:1.15em;margin:.2em 0 0;accent-color:var(--ak-color-accent)}
.ak-decision-option input:focus-visible{outline:0;box-shadow:var(--ak-ring)}
.ak-decision-option label{display:flex;flex-direction:column;gap:.2em;min-width:0;cursor:pointer}
.ak-decision-option label::after{content:"";position:absolute;inset:0}
.ak-decision-label{font-weight:600}
.ak-decision-label .ak-badge{margin-left:.5em;vertical-align:.1em}
.ak-decision-text{color:var(--ak-color-text-muted);font-size:.94em}
.ak-decision-note,.ak-feedback-general{display:flex;flex-direction:column;gap:.45em}
.ak-decision-note label,.ak-feedback-general label,.ak-review-editor label{font-weight:550}
.ak-decision textarea,.ak-feedback textarea,.ak-review-editor textarea{${FIELD}}
.ak-decision textarea:focus-visible,.ak-feedback textarea:focus-visible,.ak-review-editor textarea:focus-visible{outline:0;border-color:var(--ak-color-accent);box-shadow:var(--ak-ring)}
.ak-decision :disabled,.ak-feedback :disabled{opacity:.62;cursor:not-allowed}
.ak-review-nojs{margin:0;font-size:.8em;font-style:italic;color:var(--ak-color-text-muted)}
[data-ak-review-ready] .ak-review-nojs{display:none}
.ak-feedback{display:flex;flex-direction:column;gap:${UNIT(2)};padding:${UNIT(3)};${CARD};scroll-margin-top:${UNIT(3)}}
.ak-main>.ak-feedback>.ak-section-head{margin:0;padding:0;border:0}
.ak-main>.ak-feedback>.ak-section-head::before{display:none}
.ak-feedback-intro{margin:0;color:var(--ak-color-text-muted)}
.ak-feedback-list{display:grid;gap:${UNIT(1.5)};margin:0;padding:0;list-style:none}
.ak-feedback-item{display:flex;flex-direction:column;gap:.35em;padding:${UNIT(1.5)} ${UNIT(2)};border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface)}
.ak-feedback-text{margin:0;white-space:pre-wrap}
.ak-feedback-actions,.ak-feedback-item-actions,.ak-review-editor-actions{display:flex;flex-wrap:wrap;gap:${UNIT(1)}}
.ak-feedback-item-actions .ak-btn{min-height:32px;padding:.25em .6em;font-size:.84em}
.ak-review-where{margin:0;font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ak-color-text-muted)}
.ak-review-quote{margin:0;padding:.1em 0 .1em .85em;border-left:2px solid var(--ak-color-accent);color:var(--ak-color-text-muted);font-size:.94em}
.ak-review-add{position:absolute;right:0;top:${UNIT(2.5)};min-height:32px;padding:.3em .8em;font:inherit;font-family:var(--ak-font-mono);font-size:.68rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted);background:transparent;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:999px;cursor:pointer;${TRANSITION}}
.ak-review-add:hover{color:var(--ak-color-accent);border-color:color-mix(in srgb,var(--ak-color-accent) 45%,var(--ak-color-border));background:var(--ak-tint)}
.ak-review-add:focus-visible{outline:0;box-shadow:var(--ak-ring)}
.ak-main>.ak-section>.ak-section-head:has(>.ak-review-add)>h2{padding-right:7.5rem}
.ak-btn.ak-review-float[data-variant]{position:absolute;z-index:41;min-height:34px;padding:.3em .9em;font-size:.84em}
.ak-review-editor{${POPUP};display:flex;flex-direction:column;gap:${UNIT(1)};width:min(380px,calc(100vw - 16px));padding:${UNIT(2)}}
.ak-review-editor[hidden],.ak-review-float[hidden],.ak-review-bar[hidden],.ak-feedback-list[hidden]{display:none}
.ak-review-bar{position:fixed;z-index:39;right:${UNIT(2)};bottom:${UNIT(2)}}
.ak-review-bar .ak-btn{min-height:40px;padding:.45em 1.1em;border-radius:999px;box-shadow:var(--ak-elevation-popover)}
::highlight(ak-review){background-color:color-mix(in srgb,var(--ak-color-accent) 22%,transparent)}
@media (max-width:768px){.ak-review-add,.ak-feedback-item-actions .ak-btn,.ak-review-float{min-height:44px}.ak-review-editor{position:fixed;left:8px!important;right:8px;top:auto!important;bottom:8px;width:auto}}
@media print{.ak-review-add,.ak-review-float,.ak-review-editor,.ak-review-bar,.ak-feedback-actions,.ak-feedback-item-actions,.ak-review-nojs{display:none!important}.ak-decision,.ak-feedback{box-shadow:none}.ak-decision-option:not(:has(input:checked)){opacity:.6}}`;
