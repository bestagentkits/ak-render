/** Token-driven CSS for `scatter-3d`: poster marks, legend, overlay labels and the data table. */

import { COLOR_STEPS, SIZE_RANGE } from './scatter-ir.js';

const TONE_VARS: Record<string, string> = {
  accent: 'var(--ak-color-accent)',
  neutral: 'var(--ak-color-text-muted)',
  success: 'var(--ak-color-success)',
  warning: 'var(--ak-color-warning)',
  danger: 'var(--ak-color-danger)',
  info: 'var(--ak-color-info)',
};

/** The sequential ramp: info through accent to danger, mixed in oklab from theme tokens. */
export function rampColor(step: number): string {
  const t = step / (COLOR_STEPS - 1);
  if (t <= 0.5) {
    const k = Math.round((t / 0.5) * 100);
    return `color-mix(in oklab,var(--ak-color-accent) ${k}%,var(--ak-color-info))`;
  }
  const k = Math.round(((t - 0.5) / 0.5) * 100);
  return `color-mix(in oklab,var(--ak-color-danger) ${k}%,var(--ak-color-accent))`;
}

const tones = Object.entries(TONE_VARS)
  .map(
    ([tone, color]) =>
      `.ak-sc .t-${tone}{--ak-sc-c:${color}}.ak-sc .t-${tone}-deep{--ak-sc-c:color-mix(in oklab,${color} 55%,var(--ak-color-text))}`,
  )
  .join('\n');
const ramp = Array.from(
  { length: COLOR_STEPS },
  (_, i) => `.ak-sc .q${i}{--ak-sc-c:${rampColor(i)}}`,
).join('\n');
const [small, large] = SIZE_RANGE;
const mid = Math.sqrt((small * small + large * large) / 2);
const sizes = [small, mid, large]
  .map(
    (f, i) => `.ak-sc-size i.r${i}{width:${Math.round(f * 10)}px;height:${Math.round(f * 10)}px}`,
  )
  .join('\n');

export const SCATTER_CSS = `
${tones}
${ramp}
.ak-sc-poster .ak-sc-grid line{stroke:var(--ak-color-border);stroke-width:.6}
.ak-sc-poster .ak-sc-grid line.e{stroke:color-mix(in oklab,var(--ak-color-text) 35%,transparent);stroke-width:.9}
.ak-sc-poster circle{fill:var(--ak-sc-c,var(--ak-color-accent));fill-opacity:.85}
.ak-sc-poster circle.s{stroke:var(--ak-color-text);stroke-width:1.5;fill-opacity:1}
.ak-sc-poster text{fill:var(--ak-color-text-muted);font:500 9px var(--ak-font-body,inherit);text-anchor:middle}
.ak-sc-poster text.t{fill:var(--ak-color-text);font-weight:650;font-size:10px}
.ak-sc-labels{position:absolute;inset:0;pointer-events:none;z-index:1;font:500 11px/1 var(--ak-font-body,inherit);color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
.ak-sc-labels span{position:absolute;left:0;top:0;white-space:nowrap;transform:translate(-50%,-50%)}
.ak-sc-labels .t{color:var(--ak-color-text);font-weight:650;font-size:12px;letter-spacing:.01em}
.ak-sc-tip{position:absolute;left:0;top:0;z-index:2;pointer-events:none;transform:translate(-50%,calc(-100% - 12px));background:color-mix(in oklab,var(--ak-color-surface) 92%,transparent);backdrop-filter:blur(6px);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small);box-shadow:0 8px 24px -8px color-mix(in oklab,var(--ak-color-text) 30%,transparent);padding:6px 9px;font:500 12px/1.35 var(--ak-font-body,inherit);color:var(--ak-color-text);font-variant-numeric:tabular-nums;white-space:nowrap}
.ak-sc-tip b{display:block;font-weight:700}
.ak-sc-tip[hidden]{display:none}
.ak-sc-brush{position:absolute;z-index:2;pointer-events:none;border:1px solid var(--ak-color-accent);background:color-mix(in oklab,var(--ak-color-accent) 14%,transparent);border-radius:2px}
.ak-sc-brush[hidden]{display:none}
.ak-sc-legend{display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--ak-space-unit)*1.5) calc(var(--ak-space-unit)*3)}
.ak-sc-groups{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--ak-space-unit)}
.ak-sc-groups button{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 calc(var(--ak-space-unit)*1.5);font:inherit;color:var(--ak-color-text);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:999px}
.ak-sc-groups button:not([disabled]){cursor:pointer}
.ak-sc-groups button[aria-pressed="false"]{color:var(--ak-color-text-muted);background:transparent}
.ak-sc-groups button[aria-pressed="false"] .ak-sc-swatch{opacity:.3}
.ak-sc-groups button:focus-visible,.ak-sc-tools button:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-sc-swatch{width:12px;height:12px;border-radius:50%;background:var(--ak-sc-c);box-shadow:0 0 0 3px color-mix(in oklab,var(--ak-sc-c) 22%,transparent)}
.ak-sc-count{color:var(--ak-color-text-muted);font-size:.85em;font-variant-numeric:tabular-nums}
.ak-sc-key{font-weight:600;margin-right:4px}
.ak-sc-ramp,.ak-sc-sizes{display:inline-flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums;color:var(--ak-color-text-muted)}
.ak-sc-ramp .ak-sc-key,.ak-sc-sizes .ak-sc-key{color:var(--ak-color-text)}
.ak-sc-bar{display:inline-flex;height:10px;width:160px;border-radius:999px;overflow:hidden}
.ak-sc-bar span{flex:1;background:var(--ak-sc-c)}
.ak-sc-size{display:inline-flex;align-items:center;gap:5px}
.ak-sc-size i{display:inline-block;border-radius:50%;background:color-mix(in oklab,var(--ak-color-text-muted) 55%,transparent)}
${sizes}
.ak-sc-tools{position:absolute;top:10px;left:10px;z-index:2;display:flex;gap:6px}
.ak-sc-tools button{min-height:36px;min-width:44px;padding:0 12px;font:500 13px var(--ak-font-body,inherit);color:var(--ak-color-text);background:color-mix(in oklab,var(--ak-color-surface) 82%,transparent);backdrop-filter:blur(6px);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:999px;cursor:pointer}
.ak-sc-tools button:hover{border-color:color-mix(in oklab,var(--ak-color-accent) 60%,var(--ak-color-border))}
.ak-sc-tools button[aria-pressed="true"]{color:var(--ak-color-accent);border-color:var(--ak-color-accent);box-shadow:inset 0 0 0 1px var(--ak-color-accent)}
.ak-sc-status{margin:0;color:var(--ak-color-text-muted);font-size:.9em;font-variant-numeric:tabular-nums}
.ak-sc-table{max-height:20rem;overflow:auto;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small)}
.ak-sc-table:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-sc-table table{width:100%;border-collapse:collapse;font-size:.85em;font-variant-numeric:tabular-nums}
.ak-sc-table th,.ak-sc-table td{padding:4px 10px;text-align:right;border-bottom:var(--ak-border-width) solid color-mix(in oklab,var(--ak-color-border) 60%,transparent)}
.ak-sc-table th[scope="row"],.ak-sc-table thead th:first-child{text-align:left;font-weight:600;white-space:nowrap}
.ak-sc-clip{margin-left:6px;padding:0 6px;border-radius:999px;font-size:.8em;font-weight:500;color:var(--ak-color-danger);background:color-mix(in oklab,var(--ak-color-danger) 12%,transparent)}
.ak-sc-table thead th{position:sticky;top:0;background:var(--ak-color-surface);z-index:1}
.ak-sc-table tr[aria-selected="true"]{background:color-mix(in oklab,var(--ak-color-accent) 16%,transparent)}
[data-ak-3d-state="frozen"] .ak-sc-tools,[data-ak-3d-state="frozen"] .ak-sc-tip{display:none}
@media (max-width:480px){.ak-sc-labels{font-size:9px}.ak-sc-labels .t{font-size:10px}.ak-sc-tools button{min-height:32px;font-size:12px;padding:0 10px}}
@media print{.ak-sc-labels,.ak-sc-tip,.ak-sc-brush,.ak-sc-tools{display:none}.ak-sc-table{max-height:none;overflow:visible;border:0}.ak-sc-table thead th{position:static}}
`;
