/**
 * Effects layer of the emitted stylesheet.
 *
 * Atmosphere and feedback shared by every page: a theme-tinted aurora behind the
 * hero, a word-by-word title reveal, a film-grain page texture, a pointer
 * spotlight on cards, and a shine on primary buttons. It also carries the window dots, which the terminal and the
 * frame feature share. Block styles belong in feature sheets, never here.
 *
 * Rules: no selector may contain a feature marker (see `verify.ts`); motion is
 * gated on `prefers-reduced-motion: no-preference`; nothing starts hidden unless
 * it is already on screen; print drops all of it.
 */

const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';

/** A 160px fractal-noise tile, inlined so the page stays offline and CSP-clean. */
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http%3A//www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .6 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E")`;

/** Title words rise one after another; words past the last step share its delay. */
const WORD_STEPS = Array.from(
  { length: 14 },
  (_, index) =>
    `.ak-word:nth-child(${index + 1}) > span{animation-delay:${(0.08 + index * 0.055).toFixed(3)}s}`,
).join('');

export const EFFECTS_CSS = `::selection{background:color-mix(in srgb,var(--ak-color-accent) 26%,transparent)}
body{position:relative}
body::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background-image:${GRAIN};background-size:160px;opacity:.05}
.ak-hero{position:relative;isolation:isolate}
.ak-hero::before{content:"";position:absolute;z-index:-1;top:-40%;right:0;width:min(820px,78%);aspect-ratio:1.3;pointer-events:none;background:radial-gradient(closest-side at 36% 48%,color-mix(in srgb,var(--ak-color-accent) 34%,transparent),transparent),radial-gradient(closest-side at 70% 34%,color-mix(in srgb,var(--ak-color-info) 24%,transparent),transparent),radial-gradient(closest-side at 58% 72%,color-mix(in srgb,var(--ak-color-success) 16%,transparent),transparent);filter:blur(28px);opacity:.8}
.ak-word{display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.12em;margin-bottom:-.12em}
.ak-word > span{display:inline-block}
@keyframes ak-aurora{50%{transform:translate(-5%,7%) rotate(-5deg) scale(1.07)}}
@keyframes ak-rise{from{transform:translateY(108%)}to{transform:none}}
@media (prefers-reduced-motion:no-preference){.ak-hero::before{animation:ak-aurora 18s ease-in-out infinite}.ak-hero > h1:has(.ak-word){animation:none}.ak-word > span{animation:ak-rise calc(var(--ak-motion-duration) * 5.5) ${EASE_OUT} both}${WORD_STEPS}}
.ak-card,.ak-tile{position:relative;isolation:isolate}
.ak-card::after,.ak-tile::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;background:radial-gradient(380px circle at var(--ak-mx,50%) var(--ak-my,-60%),color-mix(in srgb,var(--ak-color-accent) 13%,transparent),transparent 70%);opacity:0;transition:opacity calc(var(--ak-motion-duration) * 2) var(--ak-motion-easing)}
.ak-card:hover::after,.ak-tile:hover::after{opacity:1}
.ak-btn[data-variant="primary"]{position:relative;isolation:isolate;overflow:hidden}
.ak-btn[data-variant="primary"]::after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:linear-gradient(105deg,transparent 30%,color-mix(in srgb,var(--ak-color-accent-contrast) 34%,transparent) 50%,transparent 70%);translate:-110% 0;transition:translate .9s ${EASE_OUT}}
.ak-btn[data-variant="primary"]:hover::after{translate:110% 0}
.ak-hero[data-align="center"]{align-items:center;text-align:center}
.ak-hero[data-align="center"]::before{right:auto;left:50%;translate:-50% 0}
.ak-window-dots{display:inline-flex;flex:none;gap:6px}
.ak-window-dots > span{width:10px;height:10px;border-radius:50%;background:currentColor;opacity:.32}
@media print{body::before,.ak-hero::before{display:none}.ak-word > span{animation:none!important}}`;
