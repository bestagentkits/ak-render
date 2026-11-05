/**
 * Token-driven CSS for `terrain-3d`: the stage's sky, the drawing's contour
 * runs, floor shadow and pins, the elevation legend, the place list, the live
 * pins' name tag and the flyover's pause control. Ground colours are data (the
 * ramp) and live on the drawn cells; everything around them follows the theme.
 */

const TONES = ['success', 'warning', 'danger', 'info', 'neutral'] as const;
const toneVars = TONES.map(
  (tone) =>
    `.ak-tr [data-tone="${tone}"]{--ak-3d-tone:var(--ak-color-${tone === 'neutral' ? 'text-muted' : tone})}`,
).join('\n');

export const TERRAIN_CSS = `
.ak-tr .ak-3d-stage{background:radial-gradient(70% 55% at 50% 38%,color-mix(in oklab,var(--ak-color-accent) 12%,transparent),transparent 72%),radial-gradient(55% 28% at 50% 100%,color-mix(in oklab,var(--ak-color-text) 7%,transparent),transparent 70%),linear-gradient(180deg,color-mix(in oklab,var(--ak-color-surface-raised,var(--ak-color-surface)) 90%,var(--ak-color-info)) 0%,var(--ak-color-surface-raised,var(--ak-color-surface)) 46%,color-mix(in oklab,var(--ak-color-background) 88%,var(--ak-color-text)) 100%)}
${toneVars}
.ak-tr-ground path[stroke]{stroke-width:.8;stroke-linejoin:round}
.ak-tr-rim{fill:none;stroke:#fff;stroke-opacity:.4;stroke-width:1;stroke-linejoin:round}
.ak-tr-c{fill:none;stroke:#1b1712;stroke-opacity:.24;stroke-width:.55;stroke-linecap:round}
.ak-tr-ci{stroke-opacity:.5;stroke-width:.95}
.ak-tr-shadow stop{stop-color:color-mix(in oklab,var(--ak-color-background) 25%,#000)}
.ak-tr-pin path{stroke:var(--ak-color-text);stroke-width:1.5;stroke-opacity:.8}
.ak-tr-pin .ak-tr-foot{fill:var(--ak-color-text);stroke:none;fill-opacity:.85}
.ak-tr-pin circle:not(.ak-tr-foot){fill:var(--ak-3d-tone,var(--ak-color-accent));fill-opacity:1;stroke:var(--ak-color-surface);stroke-width:2}
.ak-3d-mark.ak-tr-pin text{fill:var(--ak-color-accent-contrast);font:700 12px var(--ak-font-body,inherit)}
.ak-tr .ak-3d-num{background:var(--ak-3d-tone,var(--ak-color-accent))}
.ak-tr .ak-3d-pin{background:var(--ak-3d-tone,var(--ak-color-accent))}
.ak-tr .ak-3d-pin[aria-pressed="true"]{background:var(--ak-color-text)}
.ak-tr .ak-3d-pin[data-ak-back]{opacity:.45}
.ak-tr-stems{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.ak-tr-stems line{stroke:var(--ak-color-text);stroke-width:1.5;stroke-opacity:.8}
.ak-tr-stems line[data-ak-back]{stroke-opacity:.3}
.ak-tr-tag{position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;padding:5px 10px;border-radius:999px;font:600 12.5px/1.2 var(--ak-font-body,inherit);color:var(--ak-color-text);background:color-mix(in oklab,var(--ak-color-surface) 84%,transparent);backdrop-filter:blur(6px);border:1px solid color-mix(in oklab,var(--ak-color-text) 16%,transparent);box-shadow:0 4px 14px color-mix(in oklab,var(--ak-color-text) 16%,transparent)}
.ak-tr-tag span{margin-left:8px;font-weight:500;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
.ak-tr-tag[hidden]{display:none}
.ak-tr-legend{display:grid;gap:2px}
.ak-tr-ramp{display:block;width:100%;max-width:22rem;height:auto;overflow:visible}
.ak-tr-ramp line{stroke:var(--ak-color-text-muted);stroke-width:1}
.ak-tr-ramp text{fill:var(--ak-color-text-muted);font:12px var(--ak-font-body,inherit);font-variant-numeric:lining-nums tabular-nums}
.ak-tr-facts{margin:0;color:var(--ak-color-text-muted);font-size:.875em}
.ak-tr-marks .ak-3d-name{width:100%}
.ak-tr-elev{margin-left:auto;padding-left:calc(var(--ak-space-unit)*1);font-weight:500;color:var(--ak-color-text-muted);font-variant-numeric:lining-nums tabular-nums;white-space:nowrap}
.ak-tr-marks button{transition:border-color var(--ak-motion-duration),box-shadow var(--ak-motion-duration),background-color var(--ak-motion-duration)}
.ak-tr-marks button[aria-pressed="true"]{background:color-mix(in oklab,var(--ak-color-accent) 8%,var(--ak-color-surface))}
.ak-tr-marks button:not([disabled]):hover{border-color:color-mix(in oklab,var(--ak-color-accent) 55%,var(--ak-color-border))}
.ak-tr-pause{position:absolute;right:10px;bottom:10px;z-index:2;min-height:36px;min-width:44px;padding:0 14px;font:500 13px var(--ak-font-body,inherit);color:var(--ak-color-text);background:color-mix(in oklab,var(--ak-color-surface) 72%,transparent);backdrop-filter:blur(6px);border:1px solid color-mix(in oklab,var(--ak-color-text) 20%,transparent);border-radius:999px;cursor:pointer}
.ak-tr-pause:hover{border-color:color-mix(in oklab,var(--ak-color-text) 45%,transparent)}
.ak-tr-pause:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
[data-ak-3d-state="frozen"] .ak-tr-pause{display:none}
@media print{.ak-tr-pause,.ak-tr-tag,.ak-tr-stems{display:none}.ak-tr-marks button{box-shadow:none}}
`;
