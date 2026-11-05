/** Token-driven CSS for `particles-3d`: the poster's color stops, the night stage and the pause control. */

import { TONES } from './scene-ir.js';

const TONE_VARS: Record<(typeof TONES)[number], string> = {
  accent: 'var(--ak-color-accent)',
  neutral: 'var(--ak-color-text-muted)',
  success: 'var(--ak-color-success)',
  warning: 'var(--ak-color-warning)',
  danger: 'var(--ak-color-danger)',
  info: 'var(--ak-color-info)',
};

/** Poster marks name two stops and a mix step; the color is mixed from theme tokens in oklab. */
const stops = TONES.map(
  (tone) =>
    `.ak-pt-poster [data-a="${tone}"]{--ak-pt-a:${TONE_VARS[tone]}}.ak-pt-poster [data-b="${tone}"]{--ak-pt-b:${TONE_VARS[tone]}}`,
).join('\n');
const mixes = [0, 1, 2, 3, 4]
  .map(
    (k) =>
      `.ak-pt-poster [data-k="${k}"]{fill:color-mix(in oklab,color-mix(in oklab,var(--ak-pt-b) ${k * 25}%,var(--ak-pt-a)) 72%,var(--ak-pt-ink))}`,
  )
  .join('\n');
const opacity = [0, 1, 2, 3]
  .map((o) => `.ak-pt-marks [data-o="${o}"]{fill-opacity:${(0.35 + o * 0.2).toFixed(2)}}`)
  .join('\n');

export const PARTICLES_CSS = `
${stops}
${mixes}
${opacity}
.ak-pt{--ak-pt-night:color-mix(in oklab,var(--ak-color-text) 90%,var(--ak-color-info));--ak-pt-ink:var(--ak-color-background)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .ak-pt{--ak-pt-night:color-mix(in oklab,var(--ak-color-background) 92%,var(--ak-color-accent));--ak-pt-ink:var(--ak-color-text)}}
:root[data-theme="dark"] .ak-pt{--ak-pt-night:color-mix(in oklab,var(--ak-color-background) 92%,var(--ak-color-accent));--ak-pt-ink:var(--ak-color-text)}
.ak-pt .ak-3d-stage{background:radial-gradient(55% 65% at 50% 48%,color-mix(in oklab,var(--ak-color-accent) 22%,transparent),transparent 74%),radial-gradient(130% 110% at 50% 0%,color-mix(in oklab,var(--ak-pt-night) 86%,var(--ak-pt-ink)),var(--ak-pt-night) 62%);border-color:color-mix(in oklab,var(--ak-pt-night) 80%,var(--ak-color-border));box-shadow:inset 0 0 120px -30px color-mix(in oklab,var(--ak-pt-night) 70%,transparent)}
.ak-pt .ak-3d-canvas{cursor:grab}
.ak-pt-glow{mix-blend-mode:screen}
.ak-pt-glow g{fill-opacity:.5}
.ak-pt-meta{display:block;margin-top:2px;color:var(--ak-color-text-muted);font-size:.85em;font-variant-numeric:tabular-nums}
.ak-pt-pause{position:absolute;right:10px;bottom:10px;z-index:2;min-height:36px;min-width:44px;padding:0 14px;font:500 13px var(--ak-font-body,inherit);color:var(--ak-pt-ink);background:color-mix(in oklab,var(--ak-pt-night) 62%,transparent);backdrop-filter:blur(6px);border:1px solid color-mix(in oklab,var(--ak-pt-ink) 28%,transparent);border-radius:999px;cursor:pointer}
.ak-pt-pause:hover{border-color:color-mix(in oklab,var(--ak-pt-ink) 60%,transparent)}
.ak-pt-pause:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
[data-ak-3d-state="frozen"] .ak-pt-pause{display:none}
@media print{.ak-pt-pause{display:none}.ak-pt .ak-3d-stage{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
