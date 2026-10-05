/**
 * Signature layer of the emitted stylesheet.
 *
 * The base sheet sets structure and tokens; this layer adds the details that
 * make an artifact feel art-directed: fluid display type, one orchestrated
 * hero entrance, drawn link underlines, and cards that lift and behave as a single target.
 *
 * Every motion is gated on `prefers-reduced-motion: no-preference` and scales
 * with the motion-duration token, so the reduced-motion override zeroes it.
 * Blocks below the fold never start hidden: a scroll-triggered reveal would leave
 * them blank in full-page captures, PDF exports and thumbnails, so only the
 * hero (always in view on load) animates in.
 *
 * Selectors here must not contain a feature marker (see `verify.ts`), because
 * this layer ships on every page.
 */

const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
const SLOW = 'calc(var(--ak-motion-duration) * 4)';

export const SIGNATURE_CSS = `h1,h2,h3,h4{text-wrap:balance}
p,li,dd,blockquote{text-wrap:pretty}
@media (min-width:769px){.ak-hero{padding-top:calc(var(--ak-space-unit) * 7);padding-bottom:calc(var(--ak-space-unit) * 4)}.ak-hero h1{max-width:17ch;font-size:max(calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),5)),min(6.2vw,calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),7.2))));line-height:.98;letter-spacing:-.045em}.ak-hero p:not(.ak-eyebrow){font-size:calc(var(--ak-font-size-base) * 1.28)}.ak-main > .ak-section > .ak-section-head h2{font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),2.6));letter-spacing:-.03em}.ak-stat dd{font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),4.4));letter-spacing:-.045em}}
@keyframes ak-enter{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:no-preference){.ak-hero > *{animation:ak-enter ${SLOW} ${EASE_OUT} both}.ak-hero > :nth-child(2){animation-delay:calc(var(--ak-motion-duration) * .5)}.ak-hero > :nth-child(3){animation-delay:var(--ak-motion-duration)}.ak-hero > :nth-child(n + 4){animation-delay:calc(var(--ak-motion-duration) * 1.5)}}
.ak-main :is(p,li,dd,td,figcaption) > a:not(.ak-btn){text-decoration:none;background-image:linear-gradient(currentColor,currentColor),linear-gradient(color-mix(in srgb,currentColor 32%,transparent),color-mix(in srgb,currentColor 32%,transparent));background-size:0 1.5px,100% 1px;background-position:0 100%,0 100%;background-repeat:no-repeat;padding-bottom:.1em;transition:background-size ${SLOW} ${EASE_OUT},color var(--ak-motion-duration) var(--ak-motion-easing)}
.ak-main :is(p,li,dd,td,figcaption) > a:not(.ak-btn):hover{background-size:100% 1.5px,100% 1px}
.ak-card{transition:translate calc(var(--ak-motion-duration) * 1.6) ${EASE_OUT},box-shadow calc(var(--ak-motion-duration) * 1.6) ${EASE_OUT},border-color var(--ak-motion-duration) var(--ak-motion-easing)}
.ak-card > .ak-caption{font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.04em;color:var(--ak-color-text-muted)}
.ak-card > .ak-caption:has(+ a:last-child){margin-top:auto;padding-top:var(--ak-space-unit)}
.ak-card > a:last-child:not(.ak-btn){align-self:flex-start;display:inline-flex;align-items:center;gap:.45em;margin-top:auto;font-weight:600;text-decoration:none}
.ak-card > .ak-caption + a:last-child:not(.ak-btn){margin-top:0}
.ak-card > a:last-child:not(.ak-btn)::after{content:"\\2192";transition:transform calc(var(--ak-motion-duration) * 1.6) ${EASE_OUT}}
.ak-card:has(> a:last-child:not(.ak-btn)):not(:has(button,input,select,textarea,summary,a:not(:last-child))){position:relative}
.ak-card:has(> a:last-child:not(.ak-btn)):not(:has(button,input,select,textarea,summary,a:not(:last-child))) > a:last-child::before{content:"";position:absolute;inset:0;border-radius:inherit}
.ak-card:has(> a:last-child:not(.ak-btn)):not(:has(button,input,select,textarea,summary,a:not(:last-child))):hover{translate:0 -3px;border-color:color-mix(in srgb,var(--ak-color-accent) 45%,var(--ak-color-border));box-shadow:var(--ak-elevation-popover)}
.ak-card:hover > a:last-child:not(.ak-btn)::after{transform:translateX(4px)}
.ak-card:has(> a:last-child:focus-visible){outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-btn[data-variant="primary"]{background-image:linear-gradient(180deg,color-mix(in srgb,var(--ak-color-accent-contrast) 12%,transparent),transparent)}
.ak-btn{transition:var(--ak-transition),translate var(--ak-motion-duration) ${EASE_OUT}}
.ak-btn:not(:disabled):hover{translate:0 -1px}
@media print{.ak-hero > *{animation:none!important}}`;
