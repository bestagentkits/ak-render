/**
 * Token-driven CSS for `text-3d`: the poster's face gradient, extrusion and
 * edge per material, the neon night stage and the pause control. Every rule
 * is scoped to the poster or the block, so an exported poster carries the
 * same picture.
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

const tones = TONES.map(
  (tone) =>
    `.ak-tx[data-tone="${tone}"],.ak-tx-poster[data-tone="${tone}"]{--ak-tx-tone:${TONE_VARS[tone]}}`,
).join('\n');

const mix = (a: string, pct: number, b: string) => `color-mix(in oklab,${a} ${pct}%,${b})`;
const T = 'var(--ak-tx-tone)';

/** Face stops (top, above the horizon, below it, bottom), side and edge color for each finish. */
const FINISHES: Record<
  string,
  {
    stops: [string, string, string, string];
    side: string;
    back: string;
    edge: string;
    edgeOpacity: number;
    faceOpacity?: number;
    sideOpacity?: number;
  }
> = {
  satin: {
    stops: [mix(T, 45, '#fff'), mix(T, 62, '#fff'), mix(T, 78, '#fff'), mix(T, 92, '#fff')],
    side: mix(T, 72, '#000'),
    back: mix(T, 30, '#000'),
    edge: mix(T, 30, '#fff'),
    edgeOpacity: 0.55,
  },
  metal: {
    stops: [mix(T, 40, '#fff'), mix(T, 78, '#000'), mix(T, 70, '#fff'), mix(T, 70, '#000')],
    side: mix(T, 45, '#000'),
    back: mix(T, 22, '#000'),
    edge: mix(T, 25, '#fff'),
    edgeOpacity: 0.8,
  },
  chrome: {
    stops: ['#fbfcfe', mix(T, 4, '#d4d7dd'), mix(T, 4, '#5a5f68'), mix(T, 4, '#b4b8c0')],
    side: mix(T, 4, '#5a5f68'),
    back: mix(T, 4, '#2a2d33'),
    edge: '#ffffff',
    edgeOpacity: 0.9,
  },
  glass: {
    stops: [mix(T, 70, '#fff'), mix(T, 85, '#fff'), T, mix(T, 85, '#000')],
    side: T,
    back: mix(T, 70, '#000'),
    edge: mix(T, 15, '#fff'),
    edgeOpacity: 0.95,
    faceOpacity: 0.88,
    sideOpacity: 0.8,
  },
  neon: {
    stops: [mix(T, 55, '#fff'), mix(T, 75, '#fff'), mix(T, 80, '#fff'), mix(T, 90, '#fff')],
    side: mix(T, 40, '#05060a'),
    back: mix(T, 20, '#05060a'),
    edge: mix(T, 60, '#fff'),
    edgeOpacity: 1,
  },
};

const finishes = Object.entries(FINISHES)
  .map(([name, f]) => {
    const p = `.ak-tx-poster[data-material="${name}"]`;
    return [
      ...f.stops.map((stop, i) => `${p} .ak-tx-s${i}{stop-color:${stop}}`),
      `${p} .ak-tx-side{fill:${f.side}${f.sideOpacity ? `;fill-opacity:${f.sideOpacity}` : ''}}`,
      `${p} .ak-tx-back{fill:${f.back}}`,
      `${p} .ak-tx-edge{stroke:${f.edge};stroke-opacity:${f.edgeOpacity}}`,
      f.faceOpacity ? `${p} .ak-tx-face{fill-opacity:${f.faceOpacity}}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  })
  .join('\n');

/** Night behind neon in either scheme, so the glow reads; ink stays the light end. */
const NEON_NIGHT = `radial-gradient(60% 70% at 50% 45%,color-mix(in oklab,var(--ak-tx-tone,var(--ak-color-accent)) 20%,transparent),transparent 72%),radial-gradient(130% 110% at 50% 0%,color-mix(in oklab,var(--ak-color-info) 22%,#141826),#07080d 66%)`;

export const TEXT_CSS = `
${tones}
${finishes}
.ak-tx-poster .ak-tx-edge{fill:none;stroke-width:1.1;stroke-linejoin:round}
.ak-tx-poster .ak-tx-shadow{fill:color-mix(in oklab,var(--ak-color-text) 70%,var(--ak-tx-tone));opacity:.28}
.ak-tx-poster .ak-tx-glow{fill:none;stroke:none}
.ak-tx-poster[data-material="neon"] .ak-tx-glow{fill:var(--ak-tx-tone);opacity:.85}
.ak-tx-poster[data-material="neon"] .ak-tx-shadow{fill:var(--ak-tx-tone);opacity:.35}
.ak-tx-poster[data-material="neon"]{background:${NEON_NIGHT}}
.ak-tx[data-material="neon"] .ak-3d-stage{background:${NEON_NIGHT};border-color:#1c2030}
.ak-tx .ak-3d-canvas{cursor:grab}
.ak-tx[data-material="neon"] .ak-3d-canvas,.ak-tx[data-material="neon"] .ak-3d-frame{filter:drop-shadow(0 0 6px var(--ak-tx-tone)) drop-shadow(0 0 22px color-mix(in oklab,var(--ak-tx-tone) 70%,transparent))}
.ak-tx-ground{position:absolute;height:34px;margin-top:-17px;pointer-events:none;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.34),transparent);filter:blur(6px);visibility:hidden}
.ak-tx[data-material="neon"] .ak-tx-ground{background:radial-gradient(closest-side,color-mix(in oklab,var(--ak-tx-tone) 40%,transparent),transparent)}
.ak-3d[data-ak-3d-state="ready"] .ak-tx-ground,.ak-3d[data-ak-3d-state="frozen"] .ak-tx-ground{visibility:visible}
.ak-tx-copy{display:block;color:var(--ak-color-text);font-weight:600}
.ak-tx-pause{position:absolute;right:10px;bottom:10px;z-index:2;min-height:36px;min-width:44px;padding:0 14px;font:500 13px var(--ak-font-body,inherit);color:var(--ak-color-text);background:color-mix(in oklab,var(--ak-color-surface) 70%,transparent);backdrop-filter:blur(6px);border:1px solid color-mix(in oklab,var(--ak-color-text) 22%,transparent);border-radius:999px;cursor:pointer}
.ak-tx[data-material="neon"] .ak-tx-pause{color:#f4f5fa;background:rgba(10,12,20,.55);border-color:rgba(255,255,255,.22)}
.ak-tx-pause:hover{border-color:color-mix(in oklab,var(--ak-color-text) 55%,transparent)}
.ak-tx-pause:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
[data-ak-3d-state="frozen"] .ak-tx-pause{display:none}
@media print{.ak-tx-pause{display:none}.ak-tx .ak-3d-stage,.ak-tx-poster{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
