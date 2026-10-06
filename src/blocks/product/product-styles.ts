/**
 * Feature sheets for the product blocks, one per feature so each is emitted
 * only when a page uses its block. Token-driven only: colours come from
 * `--ak-color-*` and `color-mix()`, spacing from the space unit, motion from
 * the motion token (0ms under reduced motion).
 */

import { EASE_OUT, MID, TRANSITION, UNIT } from '../../render/style-units.js';

const CARD = `border:var(--ak-border-width) solid var(--ak-color-border);background:var(--ak-fill);box-shadow:var(--ak-elevation-card)`;
const MONO_LABEL = `font-family:var(--ak-font-mono);font-size:.72rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase`;
const SR_ONLY = `position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0`;

/** The round avatar with its initials fallback; testimonial and people both use it. */
const AVATAR_CSS = `.ak-avatar{flex:none;display:block;width:44px;height:44px;border-radius:50%;object-fit:cover;border:var(--ak-border-width) solid var(--ak-color-border);background:var(--ak-color-surface-raised)}
.ak-avatar[data-initials]{display:inline-grid;place-items:center;font-family:var(--ak-font-heading);font-size:.95rem;font-weight:650;letter-spacing:.02em;color:var(--ak-color-text);background:radial-gradient(circle at 30% 25%,color-mix(in srgb,var(--ak-color-accent) 24%,var(--ak-color-surface)),color-mix(in srgb,var(--ak-color-accent) 9%,var(--ak-color-surface)))}`;

export const PRICING_CSS = `.ak-pricing{list-style:none;margin:0;padding:${UNIT(1.5)} 0 0;display:grid;gap:${UNIT(2)};grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));align-items:stretch}
.ak-plan{position:relative;display:flex;flex-direction:column;gap:${UNIT(1.5)};min-width:0;padding:${UNIT(3)};${CARD};border-radius:var(--ak-radius-large);transition:translate ${MID} ${EASE_OUT},box-shadow ${MID} ${EASE_OUT},border-color var(--ak-motion-duration) var(--ak-motion-easing)}
.ak-plan:hover{translate:0 -3px;box-shadow:var(--ak-elevation-popover);border-color:color-mix(in srgb,var(--ak-color-accent) 35%,var(--ak-color-border))}
.ak-plan[data-highlight]{border-color:color-mix(in srgb,var(--ak-color-accent) 62%,var(--ak-color-border));background:radial-gradient(120% 90% at 100% 0%,color-mix(in srgb,var(--ak-color-accent) 14%,transparent),transparent 60%),var(--ak-fill);box-shadow:0 0 0 var(--ak-border-width) color-mix(in srgb,var(--ak-color-accent) 40%,transparent),var(--ak-elevation-popover)}
.ak-plan-badge{position:absolute;top:0;left:${UNIT(3)};translate:0 -50%;margin:0;padding:.3em .85em;border-radius:999px;background:var(--ak-color-accent);color:var(--ak-color-accent-contrast);${MONO_LABEL};font-size:.66rem}
.ak-plan-name{margin:0;font-size:calc(var(--ak-font-size-base) * 1.12);letter-spacing:-.01em}
.ak-plan-price{display:flex;flex-wrap:wrap;align-items:baseline;gap:.35em;margin:0}
.ak-plan-amount{font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 2.4);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),4));font-weight:700;line-height:1;letter-spacing:-.04em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.ak-plan-period{color:var(--ak-color-text-muted);font-size:.9rem}
.ak-plan-summary{margin:0;color:var(--ak-color-text-muted)}
.ak-plan-features{flex:1 1 auto;list-style:none;margin:0;padding:${UNIT(1.75)} 0 0;border-top:var(--ak-border-width) solid var(--ak-color-border);display:flex;flex-direction:column;gap:.6em;font-size:.95rem}
.ak-plan-features li{position:relative;padding-left:1.65em;overflow-wrap:anywhere}
.ak-plan-features li::before{content:"";position:absolute;left:.2em;top:.42em;width:.68em;height:.36em;border-left:2px solid var(--ak-color-accent);border-bottom:2px solid var(--ak-color-accent);rotate:-45deg}
.ak-plan-cta{margin-top:auto;width:100%}
@media print{.ak-plan{box-shadow:none;break-inside:avoid}}`;

export const FEATURE_MATRIX_CSS = `.ak-feature-matrix thead th:not(:first-child),.ak-feature-matrix td{text-align:center}
.ak-feature-matrix td{position:relative}
.ak-feature-matrix tbody th[scope="row"]{position:sticky;left:0;z-index:1;font-weight:500;background:var(--ak-color-surface)}
.ak-matrix-mark{display:inline-grid;place-items:center;width:1.5em;height:1.5em;border-radius:50%;vertical-align:middle}
.ak-matrix-mark::before,.ak-matrix-mark::after{content:"";grid-area:1/1}
.ak-feature-matrix td[data-value="yes"] .ak-matrix-mark{color:var(--ak-color-success);background:color-mix(in srgb,var(--ak-color-success) 15%,transparent)}
.ak-feature-matrix td[data-value="yes"] .ak-matrix-mark::before{width:.62em;height:.32em;margin-top:-.14em;border-left:2px solid currentColor;border-bottom:2px solid currentColor;rotate:-45deg}
.ak-feature-matrix td[data-value="no"] .ak-matrix-mark{color:var(--ak-color-text-muted)}
.ak-feature-matrix td[data-value="no"] .ak-matrix-mark::before,.ak-feature-matrix td[data-value="no"] .ak-matrix-mark::after{width:.7em;height:1.5px;background:currentColor;rotate:45deg}
.ak-feature-matrix td[data-value="no"] .ak-matrix-mark::after{rotate:-45deg}`;

export const TESTIMONIAL_CSS = `${AVATAR_CSS}
.ak-testimonial{position:relative;display:flex;flex-direction:column;gap:${UNIT(2)};min-width:0;margin:0}
.ak-testimonial blockquote{margin:0}
.ak-testimonial blockquote p{margin:0;text-wrap:pretty}
.ak-testimonial figcaption{display:flex;align-items:center;gap:${UNIT(1.5)};margin-top:auto;min-width:0}
.ak-testimonial-who{display:flex;flex-direction:column;min-width:0}
.ak-testimonial-name{font-weight:600;color:var(--ak-color-text)}
.ak-testimonial-role{font-size:.85rem;color:var(--ak-color-text-muted)}
.ak-testimonial-logo{display:block;margin-left:auto;width:auto;max-width:96px;max-height:28px;object-fit:contain;opacity:.8}
.ak-testimonial-block[data-layout="featured"] .ak-testimonial{padding:${UNIT(4.5)} ${UNIT(4)} ${UNIT(3.5)};${CARD};border-radius:var(--ak-radius-large);background:radial-gradient(110% 120% at 0 0,color-mix(in srgb,var(--ak-color-accent) 12%,transparent),transparent 58%),var(--ak-fill)}
.ak-testimonial-block[data-layout="featured"] .ak-testimonial::before{content:"\\201C";position:absolute;top:${UNIT(1)};right:${UNIT(3)};font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 7);line-height:1;color:color-mix(in srgb,var(--ak-color-accent) 32%,transparent);pointer-events:none}
.ak-testimonial-block[data-layout="featured"] blockquote p{max-width:40ch;font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.5);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),2));line-height:1.35;letter-spacing:-.018em;text-wrap:balance}
.ak-testimonial-block[data-layout="featured"] .ak-avatar{width:52px;height:52px}
.ak-testimonials{list-style:none;margin:0;padding:0;display:grid;gap:${UNIT(2)};grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))}
.ak-testimonials>li{display:flex;min-width:0}
.ak-testimonials .ak-testimonial{flex:1;padding:${UNIT(3)};${CARD};border-radius:var(--ak-radius-medium);${TRANSITION}}
.ak-testimonials .ak-testimonial::before{content:"\\201C";height:.45em;font-family:var(--ak-font-heading);font-size:2.6rem;line-height:.8;color:var(--ak-color-accent)}
.ak-testimonials .ak-testimonial:hover{border-color:color-mix(in srgb,var(--ak-color-accent) 35%,var(--ak-color-border))}
.ak-testimonials blockquote p{line-height:1.6}
@media (max-width:480px){.ak-testimonial-block[data-layout="featured"] .ak-testimonial{padding:${UNIT(3.5)} ${UNIT(2.5)} ${UNIT(2.5)}}}
@media print{.ak-testimonial{box-shadow:none!important;break-inside:avoid}}`;

export const LOGO_CLOUD_CSS = `.ak-logo-cloud{list-style:none;margin:0;padding:0;display:grid;gap:${UNIT(1.5)};grid-template-columns:repeat(auto-fit,minmax(min(100%,9rem),1fr))}
.ak-logo-cloud>li{display:flex;align-items:center;justify-content:center;min-width:0;min-height:84px;padding:${UNIT(2)};border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-fill);${TRANSITION}}
.ak-logo-cloud>li:hover{border-color:color-mix(in srgb,var(--ak-color-accent) 35%,var(--ak-color-border))}
.ak-logo-cloud a{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;color:inherit;text-decoration:none}
.ak-logo-cloud img{display:block;width:auto;height:auto;max-width:100%;max-height:40px;object-fit:contain;filter:grayscale(1);opacity:.75;${TRANSITION}}
.ak-logo-cloud>li:hover img{filter:none;opacity:1}
.ak-logo-name{font-family:var(--ak-font-heading);font-size:1.05rem;font-weight:650;letter-spacing:-.01em;text-align:center;color:var(--ak-color-text-muted);overflow-wrap:anywhere}
@media print{.ak-logo-cloud img{filter:none;opacity:1}}`;

export const PEOPLE_CSS = `${AVATAR_CSS}
.ak-people{list-style:none;margin:0;padding:0;display:grid;gap:${UNIT(2)};grid-template-columns:repeat(auto-fill,minmax(min(100%,14rem),1fr))}
.ak-person{display:flex;flex-direction:column;align-items:flex-start;gap:.35em;min-width:0;padding:${UNIT(2.5)};${CARD};border-radius:var(--ak-radius-medium);${TRANSITION}}
.ak-person:hover{border-color:color-mix(in srgb,var(--ak-color-accent) 35%,var(--ak-color-border))}
.ak-person .ak-avatar{width:56px;height:56px;margin-bottom:${UNIT(1)}}
.ak-person h3{margin:0;font-size:calc(var(--ak-font-size-base) * 1.08);letter-spacing:-.01em;overflow-wrap:anywhere}
.ak-person-role{margin:0;${MONO_LABEL};font-size:.68rem;color:var(--ak-color-text-muted)}
.ak-person-bio{margin:.35em 0 0;font-size:.92rem;color:var(--ak-color-text-muted)}
.ak-person-links{list-style:none;margin:auto 0 0;padding:${UNIT(1)} 0 0;display:flex;flex-wrap:wrap;gap:.2em 1em;font-size:.88rem}
.ak-person-links a{display:inline-flex;align-items:center;min-height:32px}
@media (max-width:768px){.ak-person-links a{min-height:44px}}
@media print{.ak-person{box-shadow:none;break-inside:avoid}}`;

export const CALENDAR_CSS = `.ak-calendar-caption{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:${UNIT(1)};margin:0 0 ${UNIT(1.5)};font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * 1.2);font-weight:650;letter-spacing:-.015em}
.ak-calendar-count{${MONO_LABEL};color:var(--ak-color-text-muted)}
.ak-calendar-weekdays,.ak-calendar-days{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.ak-calendar-weekdays li{padding:0 .6em .5em;${MONO_LABEL};font-size:.68rem;color:var(--ak-color-text-muted)}
.ak-calendar-days{gap:var(--ak-border-width);overflow:hidden;background:var(--ak-color-border);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);box-shadow:var(--ak-elevation-card)}
.ak-calendar-days>li{display:flex;flex-direction:column;gap:.35em;min-width:0;min-height:92px;padding:.45em .5em .6em;background:var(--ak-color-surface)}
.ak-calendar-days>li[data-weekend]{background:color-mix(in srgb,var(--ak-color-text) 2.5%,var(--ak-color-surface))}
.ak-calendar-days>.ak-calendar-pad{background:color-mix(in srgb,var(--ak-color-text) 5%,var(--ak-color-surface))}
.ak-calendar-day time{font-variant-numeric:tabular-nums}
.ak-calendar-num{font-size:.85rem;font-weight:600;color:var(--ak-color-text-muted)}
.ak-calendar-day[data-events] .ak-calendar-num{color:var(--ak-color-text)}
.ak-calendar-dow{${SR_ONLY}}
.ak-calendar-events{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.ak-calendar-events li{--ak-tone:var(--ak-color-accent);padding:.2em .45em;border-radius:var(--ak-radius-small);background:color-mix(in srgb,var(--ak-tone) 11%,var(--ak-color-surface));font-size:.76rem;line-height:1.35;color:var(--ak-color-text);overflow-wrap:anywhere}
.ak-calendar-events li::before{content:"";display:inline-block;width:.45em;height:.45em;margin-right:.4em;border-radius:50%;background:var(--ak-tone);vertical-align:.08em}
.ak-calendar-events li[data-tone="info"]{--ak-tone:var(--ak-color-info)}
.ak-calendar-events li[data-tone="success"]{--ak-tone:var(--ak-color-success)}
.ak-calendar-events li[data-tone="warning"]{--ak-tone:var(--ak-color-warning)}
.ak-calendar-events li[data-tone="danger"]{--ak-tone:var(--ak-color-danger)}
.ak-calendar-time{font-family:var(--ak-font-mono);font-size:.92em;color:var(--ak-color-text-muted)}
.ak-calendar-empty{margin:${UNIT(1.5)} 0 0;color:var(--ak-color-text-muted)}
@media (max-width:560px){.ak-calendar-weekdays{display:none}.ak-calendar[data-empty] .ak-calendar-days{display:none}.ak-calendar-days{display:flex;flex-direction:column}.ak-calendar-days>li:not([data-events]){display:none}.ak-calendar-days>li{flex-direction:row;align-items:flex-start;gap:${UNIT(1.75)};min-height:0;padding:${UNIT(1.5)} ${UNIT(2)}}.ak-calendar-day time{display:flex;flex-direction:column;align-items:center;flex:none;width:2.75rem}.ak-calendar-dow{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;white-space:normal;${MONO_LABEL};font-size:.66rem;color:var(--ak-color-text-muted)}.ak-calendar-num{font-size:1.35rem;line-height:1.2;color:var(--ak-color-text)}.ak-calendar-events{flex:1;min-width:0;gap:.4em}.ak-calendar-events li{font-size:.9rem;padding:.35em .6em}}
@media print{.ak-calendar-days{box-shadow:none}}`;

export const LIGHTBOX_CSS = `.ak-lightbox-thumb{display:block;border-radius:var(--ak-radius-medium);cursor:zoom-in}
.ak-lightbox-thumb img{transition:translate ${MID} ${EASE_OUT},box-shadow ${MID} ${EASE_OUT}}
.ak-lightbox-thumb:hover img{translate:0 -2px;box-shadow:var(--ak-elevation-popover)}
.ak-lightbox-figure{display:none;margin:0}
.ak-lightbox-figure img{display:block;max-width:100%;max-height:calc(100vh - 11rem);width:auto;height:auto;object-fit:contain;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface-raised);box-shadow:var(--ak-elevation-popover)}
.ak-lightbox-figure figcaption{max-width:var(--ak-measure);text-align:center;font-size:.9rem;color:var(--ak-color-text-muted)}
.ak-lightbox-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:var(--ak-space-unit);margin:0}
.ak-lightbox-count{min-width:4ch;font-family:var(--ak-font-mono);font-size:.78rem;letter-spacing:.08em;font-variant-numeric:tabular-nums;color:var(--ak-color-text-muted)}
.ak-lightbox-bar a{display:inline-flex;align-items:center;min-height:40px;padding:.45em 1em;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:999px;background:var(--ak-color-surface);color:var(--ak-color-text);font-size:.9rem;font-weight:550;text-decoration:none;${TRANSITION}}
.ak-lightbox-bar a:hover{border-color:color-mix(in srgb,var(--ak-color-accent) 55%,var(--ak-color-border));background:var(--ak-tint)}
[data-ak-lightbox-root]:not([data-ak-lightbox-ready]) .ak-lightbox-figure:target{position:fixed;inset:0;z-index:80;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${UNIT(1.5)};padding:${UNIT(3)} ${UNIT(2)};background:color-mix(in srgb,var(--ak-color-background) 92%,transparent);backdrop-filter:blur(10px)}
dialog.ak-lightbox-dialog{width:min(1100px,calc(100vw - 32px));max-width:none;max-height:calc(100vh - 32px);padding:${UNIT(2)};border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:var(--ak-fill);color:var(--ak-color-text);box-shadow:var(--ak-elevation-popover)}
dialog.ak-lightbox-dialog::backdrop{background:color-mix(in srgb,var(--ak-color-background) 72%,transparent);backdrop-filter:blur(8px) saturate(.9)}
.ak-lightbox-dialog .ak-lightbox-figure:not([hidden]){display:flex;flex-direction:column;align-items:center;gap:${UNIT(1.5)}}
@media (prefers-reduced-motion:no-preference){dialog.ak-lightbox-dialog[open]{transition:opacity calc(var(--ak-motion-duration) * 1.5) var(--ak-motion-easing),transform calc(var(--ak-motion-duration) * 1.5) var(--ak-motion-easing)}@starting-style{dialog.ak-lightbox-dialog[open]{opacity:0;transform:scale(.97)}}}
@media (max-width:768px){.ak-lightbox-bar a{min-height:44px}}
@media print{.ak-lightbox,.ak-lightbox-dialog{display:none!important}}`;
