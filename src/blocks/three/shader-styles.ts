/**
 * Token-driven CSS for `shader-3d`: the poster's facet shades, the night stage
 * and the controls. Facet classes name a tone step (`k`), a light step (`s`),
 * a white step (`w`) and, on see-through presets, an opacity step (`o`); the
 * fill is mixed from theme tokens in oklab. The poster carries the stage's sky
 * itself, so it reads the same inside the page and as an exported SVG.
 */

import { TONES } from './scene-ir.js';

const TONE_VARS: Record<(typeof TONES)[number], string> = {
  accent: 'var(--ak-color-accent)',
  neutral: 'var(--ak-color-text-muted)',
  success: 'var(--ak-color-success)',
  warning: 'var(--ak-color-warning)',
  danger: 'var(--ak-color-danger)',
  info: 'var(--ak-color-info)',
};

const P = '.ak-sh-poster';
const tones = TONES.map(
  (tone) =>
    `${P}[data-a="${tone}"]{--ak-sh-a:color-mix(in oklab,${TONE_VARS[tone]},#fff var(--ak-sh-lift-a))}${P}[data-b="${tone}"]{--ak-sh-b:color-mix(in oklab,${TONE_VARS[tone]},#fff var(--ak-sh-lift-b))}`,
).join('\n');
const steps = [
  Array.from(
    { length: 9 },
    (_, k) =>
      `${P} .k${k}{--ak-sh-t:color-mix(in oklab,var(--ak-sh-b) ${k * 12.5}%,var(--ak-sh-a))}`,
  ),
  Array.from({ length: 21 }, (_, s) => `${P} .s${s}{--ak-sh-s:${s * 5}%}`),
  [0, 1, 2, 3, 4].map((w) => `${P} .w${w}{--ak-sh-w:${w * 15}%}`),
  [0, 1, 2, 3, 4, 5].map(
    (o) =>
      `${P} .o${o}{fill-opacity:${(0.08 + o * 0.16).toFixed(2)};stroke-opacity:${(0.08 + o * 0.16).toFixed(2)}}`,
  ),
]
  .flat()
  .join('\n');

/**
 * The stage is night in either scheme, as the particle stage is: a light theme
 * darkens its text toward info, a dark theme deepens its background toward accent.
 */
export function shaderSchemeVars(scheme: 'light' | 'dark'): string {
  return scheme === 'dark'
    ? '--ak-sh-night:color-mix(in oklab,var(--ak-color-background) 90%,var(--ak-color-accent));--ak-sh-ink:var(--ak-color-text);--ak-sh-lift-a:0%;--ak-sh-lift-b:0%'
    : '--ak-sh-night:color-mix(in oklab,var(--ak-color-text) 90%,var(--ak-color-info));--ak-sh-ink:var(--ak-color-background);--ak-sh-lift-a:15%;--ak-sh-lift-b:40%';
}

export const SHADER_CSS = `
${tones}
${steps}
.ak-sh{${shaderSchemeVars('light')}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .ak-sh{${shaderSchemeVars('dark')}}}
:root[data-theme="dark"] .ak-sh{${shaderSchemeVars('dark')}}
.ak-sh .ak-3d-stage,${P}{background:radial-gradient(50% 60% at 50% 50%,color-mix(in oklab,var(--ak-color-accent) 20%,transparent),transparent 72%),radial-gradient(130% 110% at 50% 0%,color-mix(in oklab,var(--ak-sh-night) 84%,var(--ak-sh-ink)),var(--ak-sh-night) 64%)}
.ak-sh .ak-3d-stage{border-color:color-mix(in oklab,var(--ak-sh-night) 80%,var(--ak-color-border));box-shadow:inset 0 0 120px -30px color-mix(in oklab,var(--ak-sh-night) 70%,transparent)}
.ak-sh-mesh path{--ak-sh-f:color-mix(in oklab,color-mix(in oklab,var(--ak-sh-t) var(--ak-sh-s),var(--ak-sh-night)) calc(100% - var(--ak-sh-w)),#fff);fill:var(--ak-sh-f);stroke:var(--ak-sh-f);stroke-width:.9;stroke-linejoin:round}
.ak-sh-additive path{mix-blend-mode:screen}
.ak-sh-lines{opacity:.42}
${P} pattern rect{fill:var(--ak-sh-night)}
.ak-sh-grain{opacity:.09;mix-blend-mode:overlay}
${P} defs stop{stop-color:var(--ak-sh-night)}
.ak-sh-meta{display:block;margin-top:2px;color:var(--ak-color-text-muted);font-size:.85em;font-variant-numeric:tabular-nums}
.ak-sh .ak-3d-canvas{cursor:grab}
.ak-sh-controls{display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--ak-space-unit)*1.5) calc(var(--ak-space-unit)*3)}
.ak-sh-presets{display:flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:var(--ak-radius-medium);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border)}
.ak-sh-presets button{font:inherit;font-size:.875em;font-weight:500;color:var(--ak-color-text-muted);background:transparent;border:0;border-radius:999px;padding:0 14px;min-height:36px;min-width:44px}
.ak-sh-presets button:not([disabled]){cursor:pointer}
.ak-sh-presets button:not([disabled]):hover{color:var(--ak-color-text)}
.ak-sh-presets button[aria-pressed="true"]{color:var(--ak-color-text);background:color-mix(in oklab,var(--ak-color-accent) 16%,var(--ak-color-surface));box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--ak-color-accent) 55%,transparent)}
.ak-sh-presets button:focus-visible,.ak-sh-control input:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-sh-control{display:flex;align-items:center;gap:calc(var(--ak-space-unit)*1);font-size:.875em;color:var(--ak-color-text-muted)}
.ak-sh-control label{display:flex;align-items:center;gap:calc(var(--ak-space-unit)*1)}
.ak-sh-control input{accent-color:var(--ak-color-accent);width:clamp(96px,14vw,160px);min-height:36px;margin:0}
.ak-sh-control input:not([disabled]){cursor:pointer}
.ak-sh-control output{min-width:3ch;color:var(--ak-color-text);font-variant-numeric:tabular-nums}
.ak-sh-pause{position:absolute;right:10px;bottom:10px;z-index:2;min-height:36px;min-width:44px;padding:0 14px;font:500 13px var(--ak-font-body,inherit);color:var(--ak-sh-ink);background:color-mix(in oklab,var(--ak-sh-night) 62%,transparent);backdrop-filter:blur(6px);border:1px solid color-mix(in oklab,var(--ak-sh-ink) 28%,transparent);border-radius:999px;cursor:pointer}
.ak-sh-pause:hover{border-color:color-mix(in oklab,var(--ak-sh-ink) 60%,transparent)}
.ak-sh-pause:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
[data-ak-3d-state="frozen"] .ak-sh-pause{display:none}
@media print{.ak-sh-pause{display:none}.ak-sh .ak-3d-stage,${P}{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
