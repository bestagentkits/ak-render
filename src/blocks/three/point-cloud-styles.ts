/** Token-driven CSS for `point-cloud-3d`: poster, legend ramp, overlay labels, selection and tables. */

import { COLOR_STEPS } from './scatter-ir.js';

/**
 * The cloud's ramp: info through accent to danger, mixed in oklch so the hue
 * turns instead of passing through grey. The runtime mixes the same way.
 */
export function cloudRampColor(step: number): string {
  const t = step / (COLOR_STEPS - 1);
  if (t <= 0.5) {
    const k = Math.round((t / 0.5) * 100);
    return `color-mix(in oklch,var(--ak-color-accent) ${k}%,var(--ak-color-info))`;
  }
  const k = Math.round(((t - 0.5) / 0.5) * 100);
  return `color-mix(in oklch,var(--ak-color-danger) ${k}%,var(--ak-color-accent))`;
}

const ramp = Array.from(
  { length: COLOR_STEPS },
  (_, i) => `.ak-pc .q${i}{--ak-pc-c:${cloudRampColor(i)}}`,
).join('\n');

export const POINT_CLOUD_CSS = `
${ramp}
.ak-pc-poster .ak-pc-frame line{stroke:color-mix(in oklab,var(--ak-color-border) 80%,transparent);stroke-width:.6}
.ak-pc-poster .ak-pc-frame line.e{stroke:color-mix(in oklab,var(--ak-color-text) 32%,transparent);stroke-width:.9}
.ak-pc-poster .ak-pc-dots circle{fill:var(--ak-pc-c,var(--ak-color-accent));fill-opacity:.82}
.ak-pc-poster .ak-pc-mark .halo{fill:none;stroke:var(--ak-color-text);stroke-width:1.5;stroke-opacity:.85}
.ak-pc-poster .ak-pc-mark .s{fill:var(--ak-pc-c);stroke:var(--ak-color-background);stroke-width:1.5}
.ak-pc-poster text{fill:var(--ak-color-text-muted);font:500 9px var(--ak-font-body,inherit);text-anchor:middle}
.ak-pc-poster text.t{fill:var(--ak-color-text);font-weight:650;font-size:10px}
@media (max-width:480px){.ak-pc-poster text{display:none}.ak-pc-poster text.t{display:inline;font-size:15px}}
.ak-pc-labels{position:absolute;inset:0;pointer-events:none;z-index:1;font:500 11px/1 var(--ak-font-body,inherit);color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
.ak-pc-labels span{position:absolute;left:0;top:0;white-space:nowrap;transform:translate(-50%,-50%)}
.ak-pc-labels .t{color:var(--ak-color-text);font-weight:650;font-size:12px;letter-spacing:.01em}
.ak-pc-tip{position:absolute;left:0;top:0;z-index:2;pointer-events:none;background:color-mix(in oklab,var(--ak-color-surface) 92%,transparent);backdrop-filter:blur(6px);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small);box-shadow:0 8px 24px -8px color-mix(in oklab,var(--ak-color-text) 30%,transparent);padding:6px 9px;font:500 12px/1.35 var(--ak-font-body,inherit);color:var(--ak-color-text);font-variant-numeric:tabular-nums;white-space:nowrap}
.ak-pc-tip b{display:block;font-weight:700}
.ak-pc-tip[hidden]{display:none}
.ak-pc-legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-variant-numeric:tabular-nums;color:var(--ak-color-text-muted)}
.ak-pc-key{font-weight:600;color:var(--ak-color-text);margin-right:4px}
.ak-pc-bar{display:inline-flex;height:10px;width:180px;border-radius:999px;overflow:hidden;box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--ak-color-text) 10%,transparent)}
.ak-pc-bar span{flex:1;background:var(--ak-pc-c)}
.ak-pc-status{margin:0;color:var(--ak-color-text-muted);font-size:.9em;font-variant-numeric:tabular-nums}
.ak-pc-pick{border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small);background:color-mix(in oklab,var(--ak-color-surface) 70%,transparent);padding:calc(var(--ak-space-unit)*1.25) calc(var(--ak-space-unit)*2);font-variant-numeric:tabular-nums}
.ak-pc-pick p{margin:0;color:var(--ak-color-text-muted);font-size:.9em}
.ak-pc-pick dl{display:flex;flex-wrap:wrap;gap:calc(var(--ak-space-unit)*.75) calc(var(--ak-space-unit)*3);margin:0}
.ak-pc-pick dt{font-size:.78em;color:var(--ak-color-text-muted);letter-spacing:.02em}
.ak-pc-pick dd{margin:0;font-weight:650;color:var(--ak-color-text)}
.ak-pc-pick .ak-pc-clip{margin-top:6px;display:inline-block}
.ak-pc-data{display:grid;gap:calc(var(--ak-space-unit)*2)}
.ak-pc-data table{width:100%;border-collapse:collapse;font-size:.85em;font-variant-numeric:tabular-nums}
.ak-pc-data caption{caption-side:top;text-align:left;padding:0 0 6px;color:var(--ak-color-text-muted);font-size:.95em}
.ak-pc-data th,.ak-pc-data td{padding:4px 10px;text-align:right;border-bottom:var(--ak-border-width) solid color-mix(in oklab,var(--ak-color-border) 60%,transparent)}
.ak-pc-data th[scope="row"],.ak-pc-data thead th:first-child{text-align:left;font-weight:600;white-space:nowrap}
.ak-pc-table{max-height:18rem;overflow:auto;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small)}
.ak-pc-table caption{padding:8px 10px 6px}
.ak-pc-table:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-pc-table thead th{position:sticky;top:0;background:var(--ak-color-surface);z-index:1}
.ak-pc-table tr[aria-selected="true"]{background:color-mix(in oklab,var(--ak-color-accent) 16%,transparent)}
.ak-pc-clip{margin-left:6px;padding:0 6px;border-radius:999px;font-size:.8em;font-weight:500;color:var(--ak-color-danger);background:color-mix(in oklab,var(--ak-color-danger) 12%,transparent)}
.ak-pc-tools{position:absolute;top:10px;left:10px;right:10px;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:6px;pointer-events:none}
.ak-pc-tools>*{pointer-events:auto}
.ak-pc-tools button,.ak-pc-tools label{min-height:36px;display:inline-flex;align-items:center;gap:8px;padding:0 12px;font:500 13px var(--ak-font-body,inherit);color:var(--ak-color-text);background:color-mix(in oklab,var(--ak-color-surface) 82%,transparent);backdrop-filter:blur(6px);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:999px}
.ak-pc-tools button{cursor:pointer}
.ak-pc-tools button:hover{border-color:color-mix(in oklab,var(--ak-color-accent) 60%,var(--ak-color-border))}
.ak-pc-tools input[type="range"]{width:110px;accent-color:var(--ak-color-accent)}
.ak-pc-tools output{min-width:4.5em;font-variant-numeric:tabular-nums;color:var(--ak-color-text-muted)}
.ak-pc-tools button:focus-visible,.ak-pc-tools input:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
[data-ak-3d-state="frozen"] .ak-pc-tools,[data-ak-3d-state="frozen"] .ak-pc-tip{display:none}
@media (max-width:480px){.ak-pc-labels{font-size:9px}.ak-pc-labels .t{font-size:10px}.ak-pc-tools button,.ak-pc-tools label{min-height:32px;font-size:12px;padding:0 10px}.ak-pc-tools input[type="range"]{width:80px}}
@media print{.ak-pc-labels,.ak-pc-tip,.ak-pc-tools{display:none}.ak-pc-table{max-height:none;overflow:visible;border:0}.ak-pc-table thead th{position:static}}
`;
