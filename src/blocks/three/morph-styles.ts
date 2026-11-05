/**
 * Token-driven CSS for `morph-3d`: the poster's shade steps, the stage, the
 * target buttons with their drawings, and the pause control. Shade steps mix
 * the target's theme tone toward black and white, so the drawing follows the
 * theme in either scheme.
 */

const TONE = 'var(--ak-3d-tone,var(--ak-color-accent))';
/** Shade steps 0 to `LIT_STEPS - 1` run from shadow through the tone to lit; the last is the highlight. */
export const SHADE_STEPS = 24;
const LIT_STEPS = SHADE_STEPS - 1;
/** The share of the lit range below the bare tone: these steps mix toward ink, the rest toward white. */
const TONE_AT = 0.42;
function shadeFill(step: number): string {
  if (step === LIT_STEPS) return `color-mix(in oklab,${TONE} 32%,#fff)`;
  const t = step / (LIT_STEPS - 1);
  if (t <= TONE_AT)
    return `color-mix(in oklab,${TONE} ${Math.round(58 + (t / TONE_AT) * 42)}%,#000)`;
  return `color-mix(in oklab,${TONE} ${Math.round(100 - ((t - TONE_AT) / (1 - TONE_AT)) * 26)}%,#fff)`;
}
const shades = Array.from({ length: SHADE_STEPS }, (_, step) => {
  const fill = shadeFill(step);
  return `.ak-mo-surface [data-l="${step}"]{fill:${fill};stroke:${fill}}`;
}).join('\n');

export const MORPH_CSS = `
${shades}
.ak-mo-surface path{stroke-width:.6;stroke-linejoin:round;fill-opacity:1}
.ak-mo .ak-3d-stage{background:radial-gradient(40% 46% at 50% 44%,color-mix(in oklab,var(--ak-color-accent) 16%,transparent),transparent 72%),radial-gradient(60% 30% at 50% 100%,color-mix(in oklab,var(--ak-color-accent) 10%,transparent),transparent 70%),radial-gradient(120% 95% at 50% 0%,var(--ak-color-surface-raised,var(--ak-color-surface)),color-mix(in oklab,var(--ak-color-background) 90%,var(--ak-color-text)))}
.ak-mo-outline{mask-type:alpha}
.ak-mo-shadow stop{stop-color:color-mix(in oklab,var(--ak-color-background) 25%,#000)}
.ak-mo-meta{display:block;margin-top:2px;color:var(--ak-color-text-muted);font-size:.85em}
.ak-mo-targets{counter-reset:ak-mo}
.ak-mo-targets li{position:relative}
.ak-mo-targets button{grid-template-columns:auto 1fr;align-items:center;column-gap:calc(var(--ak-space-unit)*1.25);padding-left:calc(var(--ak-space-unit)*.75);transition:border-color var(--ak-motion-duration),box-shadow var(--ak-motion-duration),background-color var(--ak-motion-duration)}
.ak-mo-targets button[aria-pressed="true"]{background:color-mix(in oklab,var(--ak-color-accent) 8%,var(--ak-color-surface))}
.ak-mo-targets button:not([disabled]):hover{border-color:color-mix(in oklab,var(--ak-color-accent) 55%,var(--ak-color-border))}
.ak-mo-text{display:grid;gap:2px}
.ak-mo-glyph{width:40px;height:40px;display:block;filter:drop-shadow(0 3px 4px color-mix(in oklab,var(--ak-color-text) 18%,transparent))}
.ak-mo-pause{position:absolute;right:10px;bottom:10px;z-index:2;min-height:36px;min-width:44px;padding:0 14px;font:500 13px var(--ak-font-body,inherit);color:var(--ak-color-text);background:color-mix(in oklab,var(--ak-color-surface) 72%,transparent);backdrop-filter:blur(6px);border:1px solid color-mix(in oklab,var(--ak-color-text) 20%,transparent);border-radius:999px;cursor:pointer}
.ak-mo-pause:hover{border-color:color-mix(in oklab,var(--ak-color-text) 45%,transparent)}
.ak-mo-pause:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
[data-ak-3d-state="frozen"] .ak-mo-pause{display:none}
@media (max-width:480px){.ak-mo-targets{flex-direction:column}.ak-mo-targets button{flex:1;width:100%}}
@media print{.ak-mo-pause{display:none}.ak-mo-targets button{box-shadow:none}}
`;
