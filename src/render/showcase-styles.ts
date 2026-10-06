/**
 * Stylesheets for the showcase blocks.
 *
 * Each entry is a feature sheet: the compiler emits it only when a block on the
 * page declares the feature, and `verify.ts` checks the marker selector in both
 * directions. Only the window dots, which the terminal and the frame share, and
 * the page-wide effects live in the base sheet.
 *
 * Motion follows the signature layer's rules: gated on
 * `prefers-reduced-motion: no-preference`, never hiding content that has not
 * been revealed by an observer, and switched off in print.
 */

import { BENTO_CSS } from '../blocks/composition/composition-styles.js';
import type { RuntimeFeature } from '../registry/roster.js';
import { EASE_OUT, MID, SLOW, UNIT } from './style-units.js';

/**
 * Stagger for terminal lines; lines past the last step share its delay.
 *
 * A line waiting for its turn is invisible, so the whole session must settle
 * fast: the last line starts by 0.88s and every line is drawn by about 1.4s.
 * A longer cascade left the last lines blank in captures taken after a scroll.
 */
const TERMINAL_STEP_COUNT = 12;
const TERMINAL_STEPS = Array.from({ length: TERMINAL_STEP_COUNT }, (_, index) => {
  const nth = index === TERMINAL_STEP_COUNT - 1 ? `n + ${TERMINAL_STEP_COUNT}` : String(index + 1);
  return `.ak-terminal[data-ak-inview] .ak-term-line:nth-child(${nth}){animation-delay:${(index * 0.08).toFixed(2)}s}`;
}).join('');

/** Each KPI card's sparkline draws a beat after the previous one. */
const KPI_STEPS = [2, 3, 4]
  .map((position) => {
    const nth = position === 4 ? 'n + 4' : String(position);
    const lead = (position - 1) * 0.12;
    return `.ak-kpis[data-ak-inview] .ak-kpi-card:nth-child(${nth}) .ak-kpi-line{animation-delay:${lead.toFixed(2)}s}.ak-kpis[data-ak-inview] .ak-kpi-card:nth-child(${nth}) .ak-kpi-area{animation-delay:${(lead + 0.5).toFixed(2)}s}`;
  })
  .join('');

export const SHOWCASE_CSS: Readonly<Partial<Record<RuntimeFeature, string>>> = {
  bento: BENTO_CSS,

  marquee: `.ak-marquee{--ak-marquee-time:42s;padding:${UNIT(2.25)} 0;border-block:var(--ak-border-width) solid var(--ak-color-border)}
.ak-marquee[data-speed="slow"]{--ak-marquee-time:70s}
.ak-marquee[data-speed="fast"]{--ak-marquee-time:24s}
.ak-marquee-viewport{display:flex;overflow:hidden}
.ak-marquee-track{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;align-items:center;row-gap:.4em}
.ak-marquee-track[aria-hidden="true"]{display:none}
.ak-marquee li{display:inline-flex;align-items:center;gap:${UNIT(3)};padding-right:${UNIT(3)};font-family:var(--ak-font-heading);font-size:clamp(1.3rem,2.8vw,2.3rem);font-weight:650;line-height:1.15;letter-spacing:-.03em;white-space:nowrap}
.ak-marquee li::after{content:"";flex:none;width:.34em;height:.34em;border-radius:2px;background:var(--ak-color-accent);rotate:45deg}
@supports (-webkit-text-stroke:1px black){.ak-marquee li:nth-child(even){color:transparent;-webkit-text-stroke:1.2px var(--ak-color-text)}}
@keyframes ak-marquee{to{transform:translateX(-100%)}}
@media (prefers-reduced-motion:no-preference){.ak-marquee-viewport{-webkit-mask-image:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent);mask-image:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent)}.ak-marquee-track{flex:none;flex-wrap:nowrap;animation:ak-marquee var(--ak-marquee-time) linear infinite}.ak-marquee-track[aria-hidden="true"]{display:flex}.ak-marquee:hover .ak-marquee-track{animation-play-state:paused}}
@media print{.ak-marquee-track{animation:none!important;flex-wrap:wrap}.ak-marquee-track[aria-hidden="true"]{display:none!important}}`,

  terminal: `.ak-terminal{--ak-term-bg:color-mix(in srgb,var(--ak-color-accent) 7%,#0b0d12);--ak-term-bar:color-mix(in srgb,var(--ak-color-accent) 6%,#151821);--ak-term-text:#e8eaf0;--ak-term-muted:#8f96a8;align-self:start;margin:0;overflow:hidden;border-radius:var(--ak-radius-large);background:var(--ak-term-bg);color:var(--ak-term-text);border:var(--ak-border-width) solid color-mix(in srgb,#fff 9%,var(--ak-term-bg));box-shadow:0 1px 0 color-mix(in srgb,#fff 8%,transparent) inset,var(--ak-elevation-popover)}
.ak-terminal-bar{display:flex;align-items:center;gap:${UNIT(1.5)};padding:.55em .75em .55em 1em;background:var(--ak-term-bar);border-bottom:var(--ak-border-width) solid color-mix(in srgb,#fff 7%,transparent)}
.ak-terminal .ak-window-dots{color:var(--ak-term-muted)}
.ak-terminal-title{flex:1;margin:0;text-align:center;font-family:var(--ak-font-mono);font-size:.74rem;letter-spacing:.04em;color:var(--ak-term-muted)}
.ak-terminal .ak-code-copy{color:var(--ak-term-muted);border-color:color-mix(in srgb,#fff 12%,transparent);background:transparent}
.ak-terminal .ak-code-copy::before{box-shadow:2.5px -2.5px 0 -1px var(--ak-term-bar),2.5px -2.5px 0 .5px currentColor}
.ak-terminal .ak-code-copy:hover{color:var(--ak-term-text);background:color-mix(in srgb,#fff 8%,transparent)}
.ak-terminal-body{margin:0;padding:${UNIT(2.5)} ${UNIT(3)} ${UNIT(3)};overflow-x:auto;background:transparent;border:0;border-radius:0;font-family:var(--ak-font-mono);font-size:.86rem;line-height:1.75;color:var(--ak-term-text);white-space:pre-wrap;word-break:break-word}
.ak-term-line{display:inline-block;max-width:100%;vertical-align:top}
.ak-term-line[data-kind="command"]{color:var(--ak-term-text);font-weight:600}
.ak-term-line[data-kind="command"]::before{content:"\\276F\\00a0\\00a0";content:"\\276F\\00a0\\00a0" / "";color:color-mix(in srgb,var(--ak-color-accent) 55%,#fff);font-weight:700}
.ak-term-line[data-kind="output"]{color:color-mix(in srgb,var(--ak-term-text) 82%,var(--ak-term-bg))}
.ak-term-line[data-kind="comment"]{color:var(--ak-term-muted);font-style:italic}
.ak-term-line[data-kind="success"]{color:#8fe3ad}
.ak-term-line[data-kind="success"]::before{content:"\\2713\\00a0";content:"\\2713\\00a0" / ""}
.ak-term-line[data-kind="error"]{color:#ffa3a3}
.ak-term-line[data-kind="error"]::before{content:"\\2717\\00a0";content:"\\2717\\00a0" / ""}
.ak-terminal-body::after{content:"";display:inline-block;width:.55em;height:1.15em;margin-left:.2em;vertical-align:-.2em;border-radius:1px;background:color-mix(in srgb,var(--ak-color-accent) 70%,#fff)}
@keyframes ak-type{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes ak-line-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@keyframes ak-caret{50%{opacity:0}}
@media (prefers-reduced-motion:no-preference){.ak-terminal[data-ak-inview] .ak-term-line{animation:ak-line-in calc(var(--ak-motion-duration) * 2) ${EASE_OUT} both}.ak-terminal[data-ak-inview] .ak-term-line[data-kind="command"]{animation:ak-type .5s steps(22,end) both}.ak-terminal-body::after{animation:ak-caret 1.1s steps(1) infinite}${TERMINAL_STEPS}}
@media print{.ak-terminal{box-shadow:none}.ak-terminal .ak-code-copy{display:none}.ak-term-line{animation:none!important}}`,

  tree: `.ak-tree-panel{padding:${UNIT(2.5)} ${UNIT(3)};border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:var(--ak-fill);box-shadow:var(--ak-elevation-card);font-family:var(--ak-font-mono);font-size:.84rem}
.ak-tree-summary{list-style:none;display:flex;flex-wrap:wrap;gap:.5em;margin:0 0 ${UNIT(2)};padding:0 0 ${UNIT(2)};border-bottom:var(--ak-border-width) solid var(--ak-color-border)}
.ak-tree-summary li,.ak-tree-status{display:inline-flex;align-items:center;gap:.45em;padding:.2em .7em;border-radius:999px;background:color-mix(in srgb,var(--ak-status) 13%,transparent);color:color-mix(in srgb,var(--ak-status) 78%,var(--ak-color-text));font-size:.72rem;letter-spacing:.05em}
.ak-tree-summary li::before{content:"";width:.45em;height:.45em;border-radius:50%;background:var(--ak-status)}
.ak-tree-block [data-status]{--ak-status:var(--ak-color-text-muted)}
.ak-tree-block [data-status="added"]{--ak-status:var(--ak-color-success)}
.ak-tree-block [data-status="modified"]{--ak-status:var(--ak-color-warning)}
.ak-tree-block [data-status="deleted"]{--ak-status:var(--ak-color-danger)}
.ak-tree-block [data-status="renamed"]{--ak-status:var(--ak-color-info)}
.ak-tree,.ak-tree ul{list-style:none;margin:0;padding:0}
.ak-tree ul{margin-left:.5em;padding-left:1.15em;border-left:var(--ak-border-width) solid var(--ak-color-border)}
.ak-tree li[data-status]{display:flex;flex-wrap:wrap;align-items:center;gap:.25em .7em;padding:.28em .45em;margin-left:-.45em;border-radius:var(--ak-radius-small);${'transition:background var(--ak-motion-duration) var(--ak-motion-easing)'}}
.ak-tree li[data-status]:hover{background:var(--ak-tint)}
.ak-tree summary{list-style:none;display:flex;align-items:center;gap:.5em;padding:.28em .45em;margin-left:-.45em;border-radius:var(--ak-radius-small);cursor:pointer;font-weight:600}
.ak-tree summary::-webkit-details-marker{display:none}
.ak-tree summary::before{content:"";width:.38em;height:.38em;margin-right:.1em;border-right:1.5px solid var(--ak-color-text-muted);border-bottom:1.5px solid var(--ak-color-text-muted);rotate:-45deg;transition:rotate var(--ak-motion-duration) var(--ak-motion-easing)}
.ak-tree details[open] > summary::before{rotate:45deg}
.ak-tree summary:hover{background:var(--ak-tint);color:var(--ak-color-accent)}
.ak-tree-name{display:inline-flex;align-items:center;gap:.5em}
.ak-tree-name::before{content:"";flex:none;display:inline-block}
.ak-tree-name[data-kind="folder"]::before{width:1.05em;height:.82em;border-radius:2px;background:linear-gradient(180deg,color-mix(in srgb,var(--ak-color-accent) 78%,#fff),var(--ak-color-accent));clip-path:polygon(0 0,42% 0,52% 16%,100% 16%,100% 100%,0 100%)}
.ak-tree-name[data-kind="file"]::before{width:.8em;height:1em;background:color-mix(in srgb,var(--ak-color-text) 22%,transparent);clip-path:polygon(0 0,64% 0,100% 30%,100% 100%,0 100%)}
.ak-tree li[data-status]:not([data-status="unchanged"]) .ak-tree-name[data-kind="file"]::before{background:var(--ak-status)}
.ak-tree li[data-status="deleted"] .ak-tree-name{text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--ak-color-danger) 60%,transparent);color:var(--ak-color-text-muted)}
.ak-tree-status{padding:.05em .55em;font-size:.66rem;text-transform:uppercase;letter-spacing:.08em}
.ak-tree-note{margin-left:auto;font-family:var(--ak-font-body);font-size:.8rem;color:var(--ak-color-text-muted)}
@media (max-width:560px){.ak-tree-panel{padding:${UNIT(2)}}.ak-tree-note{flex-basis:100%;margin-left:1.5em}}`,

  'before-after': `.ak-ba{margin:0;display:flex;flex-direction:column;gap:${UNIT(1.5)}}
.ak-ba-stage{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:${UNIT(1.5)}}
.ak-ba-pane{position:relative;overflow:hidden;margin:0;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:var(--ak-color-surface-raised)}
.ak-ba-pane img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
.ak-ba-pane .ak-caption{padding:${UNIT(2)}}
.ak-ba-label{position:absolute;top:12px;left:12px;z-index:1;padding:.35em .8em;border-radius:999px;font-family:var(--ak-font-mono);font-size:.68rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ak-color-text);background:color-mix(in srgb,var(--ak-color-background) 80%,transparent);border:var(--ak-border-width) solid color-mix(in srgb,var(--ak-color-text) 12%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.ak-ba-handle,.ak-ba-range{display:none}
.ak-ba[data-ak-ready] .ak-ba-stage{grid-template-columns:1fr;gap:0;overflow:hidden;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);box-shadow:var(--ak-elevation-popover);touch-action:pan-y}
.ak-ba[data-ak-ready] .ak-ba-pane{grid-area:1 / 1;border:0;border-radius:0}
.ak-ba[data-ak-ready] .ak-ba-pane[data-side="after"]{clip-path:inset(0 0 0 var(--ak-split,50%))}
.ak-ba[data-ak-ready] .ak-ba-pane[data-side="after"] .ak-ba-label{left:auto;right:12px}
.ak-ba[data-ak-ready] .ak-ba-handle{display:block;position:absolute;top:0;bottom:0;left:var(--ak-split,50%);z-index:2;width:2px;margin-left:-1px;pointer-events:none;background:var(--ak-color-background);box-shadow:0 0 0 1px color-mix(in srgb,var(--ak-color-text) 14%,transparent),0 0 28px color-mix(in srgb,var(--ak-color-text) 30%,transparent)}
.ak-ba-handle::after{content:"\\2039\\2002\\203A";content:"\\2039\\2002\\203A" / "";position:absolute;top:50%;left:50%;display:grid;place-items:center;width:46px;height:46px;translate:-50% -50%;border-radius:50%;background:var(--ak-color-background);color:var(--ak-color-text);font-size:1.2rem;font-weight:700;line-height:1;box-shadow:0 0 0 1px var(--ak-color-border),var(--ak-elevation-popover);transition:scale ${MID} ${EASE_OUT}}
.ak-ba-stage:hover .ak-ba-handle::after{scale:1.08}
.ak-ba-stage:has(.ak-ba-range:focus-visible) .ak-ba-handle::after{outline:2px solid var(--ak-color-accent);outline-offset:3px}
.ak-ba[data-ak-ready] .ak-ba-range{display:block;position:absolute;inset:0;z-index:3;width:100%;height:100%;margin:0;opacity:0;cursor:ew-resize;touch-action:pan-y}
@media (max-width:560px){.ak-ba-stage{grid-template-columns:1fr}}`,

  kpi: `.ak-kpi-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:${UNIT(2)}}
.ak-kpi-card{--ak-verdict:var(--ak-color-accent);position:relative;isolation:isolate;overflow:hidden;display:flex;flex-direction:column;gap:.5em;min-width:0;padding:${UNIT(2.75)} ${UNIT(2.75)} 0;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:var(--ak-fill);box-shadow:var(--ak-elevation-card);transition:translate ${MID} ${EASE_OUT},box-shadow ${MID} ${EASE_OUT}}
.ak-kpi-card:hover{translate:0 -3px;box-shadow:var(--ak-elevation-popover)}
.ak-kpi-card[data-verdict="good"]{--ak-verdict:var(--ak-color-success)}
.ak-kpi-card[data-verdict="bad"]{--ak-verdict:var(--ak-color-danger)}
.ak-kpi-card > p{margin:0}
.ak-kpi-label{font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ak-color-text-muted)}
.ak-kpi-value{font-family:var(--ak-font-heading);font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),4));font-weight:700;line-height:1;letter-spacing:-.045em;font-variant-numeric:tabular-nums}
.ak-kpi-delta{align-self:flex-start;display:inline-flex;align-items:center;gap:.35em;padding:.2em .65em;border-radius:999px;font-family:var(--ak-font-mono);font-size:.76rem;font-weight:600;color:color-mix(in srgb,var(--ak-verdict) 80%,var(--ak-color-text));background:color-mix(in srgb,var(--ak-verdict) 13%,transparent)}
.ak-kpi-card[data-verdict="neutral"] .ak-kpi-delta{color:var(--ak-color-text-muted);background:color-mix(in srgb,var(--ak-color-text) 7%,transparent)}
.ak-kpi-card > .ak-caption{color:var(--ak-color-text-muted);font-size:.82rem}
.ak-kpi-card:not(:has(.ak-kpi-spark)){padding-bottom:${UNIT(2.75)}}
.ak-kpi-spark{display:block;order:9;width:calc(100% + ${UNIT(5.5)});height:64px;margin:auto ${UNIT(-2.75)} 0;padding-top:${UNIT(1)};overflow:visible}
.ak-kpi-line{fill:none;stroke:var(--ak-verdict);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.ak-kpi-stop{stop-color:var(--ak-verdict);stop-opacity:.3}
.ak-kpi-stop--end{stop-opacity:0}
@keyframes ak-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes ak-fade{from{opacity:0}}
@media (prefers-reduced-motion:no-preference){.ak-kpis[data-ak-inview] .ak-kpi-line{stroke-dasharray:1;animation:ak-draw 1.6s ${EASE_OUT} both}.ak-kpis[data-ak-inview] .ak-kpi-area{animation:ak-fade 1.2s .5s ease-out both}${KPI_STEPS}}`,

  showcase: `.ak-showcase{position:relative;isolation:isolate;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);align-items:center;gap:${UNIT(4)} ${UNIT(7)};padding:${UNIT(3)} 0}
.ak-showcase::before{content:"";position:absolute;z-index:-1;inset:8% 0 8% 38%;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--ak-color-accent) 22%,transparent),transparent);filter:blur(48px);pointer-events:none}
.ak-showcase[data-align="media-left"]{grid-template-columns:minmax(0,7fr) minmax(0,5fr)}
.ak-showcase[data-align="media-left"]::before{inset:8% 38% 8% 0}
.ak-showcase[data-align="media-left"] .ak-showcase-media{order:-1}
.ak-showcase-copy{display:flex;flex-direction:column;align-items:flex-start;gap:${UNIT(1.75)}}
.ak-showcase-copy > *{margin:0}
.ak-showcase-copy .ak-eyebrow{color:var(--ak-color-accent)}
.ak-showcase h2{font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),3.4));line-height:1.04;letter-spacing:-.04em}
.ak-showcase-text{font-size:calc(var(--ak-font-size-base) * 1.1);line-height:1.6;color:var(--ak-color-text-muted);max-width:44ch}
.ak-showcase-points{list-style:none;padding:0;display:flex;flex-direction:column;gap:.7em}
.ak-showcase-points li{display:flex;align-items:flex-start;gap:.75em}
.ak-showcase-points li::before{content:"";flex:none;width:1.25em;height:1.25em;margin-top:.12em;border-radius:50%;background:radial-gradient(circle,var(--ak-color-accent) 0 28%,transparent 31%),color-mix(in srgb,var(--ak-color-accent) 16%,transparent)}
.ak-showcase-media{position:relative;margin:0;overflow:hidden;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:var(--ak-color-surface);box-shadow:0 1px 0 color-mix(in srgb,#fff 50%,transparent) inset,0 2px 6px color-mix(in srgb,var(--ak-color-text) 6%,transparent),0 32px 64px -24px color-mix(in srgb,var(--ak-color-text) 34%,transparent);transition:transform ${SLOW} ${EASE_OUT},box-shadow ${SLOW} ${EASE_OUT}}
@keyframes ak-drift{from{translate:0 -3.5%}to{translate:0 3.5%}}
@supports (animation-timeline:view()){@media (prefers-reduced-motion:no-preference){.ak-showcase-media .ak-frame-view img{scale:1.08;animation:ak-drift linear both;animation-timeline:view();animation-range:cover}}}
@media (prefers-reduced-motion:no-preference) and (hover:hover){.ak-showcase:hover .ak-showcase-media{transform:perspective(1800px) rotateY(-3deg) rotateX(1.5deg) translateY(-4px)}.ak-showcase[data-align="media-left"]:hover .ak-showcase-media{transform:perspective(1800px) rotateY(3deg) rotateX(1.5deg) translateY(-4px)}}
@media (max-width:900px){.ak-showcase,.ak-showcase[data-align="media-left"]{grid-template-columns:1fr}.ak-showcase[data-align="media-left"] .ak-showcase-media{order:0}.ak-showcase::before,.ak-showcase[data-align="media-left"]::before{inset:30% 0 0 0}}
@media print{.ak-showcase-media .ak-frame-view img{animation:none!important;scale:none}}`,
  cta: `.ak-cta{display:flex;flex-direction:column;align-items:flex-start;gap:${UNIT(2.5)};padding:${UNIT(11)} ${UNIT(7)}}
.ak-main > .ak-cta{margin-top:calc(var(--ak-gap) * 3)}
.ak-cta > *{margin:0}
.ak-cta .ak-eyebrow{color:var(--ak-color-accent)}
.ak-cta-title{max-width:15ch;font-size:clamp(2.5rem,1.2rem + 5.4vw,5.75rem);line-height:.96;letter-spacing:-.048em;font-weight:700}
@supports (-webkit-background-clip:text) or (background-clip:text){.ak-cta-title{background:linear-gradient(180deg,var(--ak-color-text) 35%,color-mix(in srgb,var(--ak-color-text) 52%,var(--ak-color-accent)));-webkit-background-clip:text;background-clip:text;color:transparent}}
@media (forced-colors:active){.ak-cta-title{background:none;color:CanvasText}}
.ak-cta-text{max-width:50ch;font-size:calc(var(--ak-font-size-base) * 1.15);line-height:1.6;color:var(--ak-color-text-muted)}
.ak-cta-actions{display:flex;flex-wrap:wrap;gap:${UNIT(1.5)};margin-top:${UNIT(1.5)}}
.ak-cta-actions .ak-btn{min-height:48px;padding:.8em 1.5em;font-size:1rem;text-decoration:none;border-radius:999px}
.ak-cta-actions .ak-btn[data-variant="secondary"]{background:color-mix(in srgb,var(--ak-color-text) 6%,transparent);border-color:color-mix(in srgb,var(--ak-color-text) 18%,transparent)}
.ak-cta::after{content:"";position:absolute;z-index:-1;right:-12%;bottom:-40%;width:min(640px,70%);aspect-ratio:1;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--ak-color-accent) 40%,transparent),transparent);filter:blur(40px);pointer-events:none}
@media (prefers-reduced-motion:no-preference){.ak-cta::after{animation:ak-aurora 16s ease-in-out infinite}}
@media (max-width:768px){.ak-cta{padding:${UNIT(7)} ${UNIT(3.5)}}}
@media print{.ak-cta::after{display:none}.ak-cta-title{background:none;color:inherit}}`,
  // Browser chrome around a capture: the hero shot and the showcase spotlight.
  frame: `.ak-frame-bar{display:flex;align-items:center;gap:calc(var(--ak-space-unit) * 1.5);padding:.6em .9em;border-bottom:var(--ak-border-width) solid var(--ak-color-border);background:color-mix(in srgb,var(--ak-color-text) 4%,var(--ak-color-surface))}
.ak-frame-bar .ak-window-dots{color:var(--ak-color-text-muted)}
.ak-frame-address{flex:0 1 52%;margin:0 auto;padding:.28em 1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;border-radius:999px;font-family:var(--ak-font-mono);font-size:.7rem;color:var(--ak-color-text-muted);background:var(--ak-color-background);border:var(--ak-border-width) solid var(--ak-color-border)}
.ak-frame-view{overflow:hidden}
.ak-frame-view img{display:block;width:100%;height:auto}
.ak-frame-view .ak-caption{padding:calc(var(--ak-space-unit) * 3)}
.ak-hero[data-media]{padding-bottom:0}
.ak-hero-media{position:relative;align-self:stretch;margin:calc(var(--ak-space-unit) * 5) 0 0;perspective:1600px}
.ak-hero-media::before{content:"";position:absolute;z-index:-1;inset:6% 4% -6%;border-radius:40px;background:linear-gradient(120deg,color-mix(in srgb,var(--ak-color-accent) 46%,transparent),color-mix(in srgb,var(--ak-color-info) 30%,transparent) 50%,color-mix(in srgb,var(--ak-color-success) 26%,transparent));filter:blur(56px);opacity:.55;pointer-events:none}
.ak-hero-stage{overflow:hidden;text-align:start;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:calc(var(--ak-radius-large) * 1.4);background:var(--ak-color-surface);box-shadow:0 1px 0 color-mix(in srgb,#fff 50%,transparent) inset,0 2px 8px color-mix(in srgb,var(--ak-color-text) 6%,transparent),0 48px 96px -32px color-mix(in srgb,var(--ak-color-text) 38%,transparent);transform-origin:50% 0}
@keyframes ak-tilt{from{transform:rotateX(16deg) scale(.95)}to{transform:none}}
@supports (animation-timeline:view()){@media (prefers-reduced-motion:no-preference){.ak-hero-stage{animation:ak-tilt linear both;animation-timeline:view();animation-range:cover 0% cover 48%}}}
@media print{.ak-hero-media::before{display:none}.ak-hero-stage{animation:none!important}}`,

  checklist: `.ak-checklist{padding:calc(var(--ak-space-unit) * 3);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-large);background:var(--ak-fill);box-shadow:var(--ak-elevation-card)}
.ak-checklist-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.5em calc(var(--ak-space-unit) * 2)}
.ak-checklist-head h2{margin:0;font-size:calc(var(--ak-font-size-base) * pow(var(--ak-font-scale),1.6));letter-spacing:-.02em}
.ak-checklist-count{margin:0;font-family:var(--ak-font-mono);font-size:.76rem;letter-spacing:.04em;color:var(--ak-color-text-muted)}
.ak-checklist-count strong{font-size:1.15em;color:var(--ak-color-text)}
.ak-checklist-meter{-webkit-appearance:none;appearance:none;display:block;width:100%;height:6px;margin:calc(var(--ak-space-unit) * 1.75) 0 calc(var(--ak-space-unit) * .5);border:0;border-radius:999px;overflow:hidden;background:color-mix(in srgb,var(--ak-color-text) 8%,var(--ak-color-surface))}
.ak-checklist-meter::-webkit-progress-bar{background:transparent}
.ak-checklist-meter::-webkit-progress-value{border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb,var(--ak-color-accent) 60%,var(--ak-color-surface)),var(--ak-color-accent))}
.ak-checklist-meter::-moz-progress-bar{border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb,var(--ak-color-accent) 60%,var(--ak-color-surface)),var(--ak-color-accent))}
.ak-checklist ul{list-style:none;margin:0;padding:0}
.ak-checklist li{display:flex;align-items:flex-start;gap:.85em;padding:.75em 0;border-top:var(--ak-border-width) solid var(--ak-color-border)}
.ak-checklist li:first-child{border-top:0}
.ak-check{position:relative;flex:none;width:1.25em;height:1.25em;margin-top:.12em;border-radius:6px;border:1.5px solid color-mix(in srgb,var(--ak-color-text) 28%,transparent)}
.ak-checklist li[data-state="done"] .ak-check{background:var(--ak-color-accent);border-color:var(--ak-color-accent)}
.ak-checklist li[data-state="done"] .ak-check::after{content:"";position:absolute;left:36%;top:16%;width:26%;height:50%;border:solid var(--ak-color-accent-contrast);border-width:0 2px 2px 0;rotate:45deg}
.ak-checklist li[data-state="done"] .ak-check-text{color:var(--ak-color-text-muted)}
@media print{.ak-checklist{box-shadow:none}}`,
};
