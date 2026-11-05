/** Token-driven CSS for `network-3d`; shipped with the 3D feature. */

export const NETWORK_CSS = `
.ak-net .ak-3d-stage{background:radial-gradient(55% 50% at 50% 45%,color-mix(in oklab,var(--ak-color-accent) 12%,transparent),transparent 72%),radial-gradient(120% 100% at 50% 0%,var(--ak-color-surface-raised,var(--ak-color-surface)),color-mix(in oklab,var(--ak-color-background) 84%,var(--ak-color-text)))}
.ak-net-links{fill:none;stroke:var(--ak-color-text-muted);stroke-opacity:.34;stroke-width:1;stroke-linecap:round}
.ak-net-links.ak-net-dense{stroke-opacity:.16;stroke-width:.6}
.ak-net-dot{stroke:color-mix(in oklab,var(--ak-color-background) 70%,transparent);stroke-width:.6;fill-opacity:.95}
.ak-net-labels text{fill:var(--ak-color-text);font:600 11px var(--ak-font-body,inherit);text-anchor:middle;paint-order:stroke;stroke:var(--ak-color-background);stroke-width:3px;stroke-opacity:.85}
.ak-net-swatch{display:inline-block;width:.7em;height:.7em;border-radius:50%;margin-right:.45em;background:var(--ak-3d-tone,var(--ak-color-accent));box-shadow:0 0 0 2px color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 22%,transparent);vertical-align:.05em}
.ak-net-swatch[data-tone="neutral"]{--ak-3d-tone:var(--ak-color-text-muted)}
.ak-net-swatch[data-tone="success"]{--ak-3d-tone:var(--ak-color-success)}
.ak-net-swatch[data-tone="warning"]{--ak-3d-tone:var(--ak-color-warning)}
.ak-net-swatch[data-tone="danger"]{--ak-3d-tone:var(--ak-color-danger)}
.ak-net-swatch[data-tone="info"]{--ak-3d-tone:var(--ak-color-info)}
.ak-net-dot[data-ak-net-shade="1"][data-tone="accent"]{fill:color-mix(in oklab,color-mix(in oklab,var(--ak-color-accent) 50%,var(--ak-color-danger)) 75%,var(--ak-color-background))}
.ak-net-swatch[data-ak-net-shade="1"][data-tone="accent"]{background:color-mix(in oklab,color-mix(in oklab,var(--ak-color-accent) 50%,var(--ak-color-danger)) 75%,var(--ak-color-background))}
.ak-net-dot[data-ak-net-shade="1"][data-tone="info"]{fill:color-mix(in oklab,color-mix(in oklab,var(--ak-color-info) 50%,var(--ak-color-danger)) 62%,var(--ak-color-background))}
.ak-net-swatch[data-ak-net-shade="1"][data-tone="info"]{background:color-mix(in oklab,color-mix(in oklab,var(--ak-color-info) 50%,var(--ak-color-danger)) 62%,var(--ak-color-background))}
.ak-net-dot[data-ak-net-shade="1"][data-tone="success"]{fill:color-mix(in oklab,color-mix(in oklab,var(--ak-color-success) 50%,var(--ak-color-warning)) 50%,var(--ak-color-background))}
.ak-net-swatch[data-ak-net-shade="1"][data-tone="success"]{background:color-mix(in oklab,color-mix(in oklab,var(--ak-color-success) 50%,var(--ak-color-warning)) 50%,var(--ak-color-background))}
.ak-net-dot[data-ak-net-shade="1"][data-tone="danger"]{fill:color-mix(in oklab,color-mix(in oklab,var(--ak-color-danger) 50%,var(--ak-color-text-muted)) 62%,var(--ak-color-background))}
.ak-net-swatch[data-ak-net-shade="1"][data-tone="danger"]{background:color-mix(in oklab,color-mix(in oklab,var(--ak-color-danger) 50%,var(--ak-color-text-muted)) 62%,var(--ak-color-background))}
.ak-net-dot[data-ak-net-shade="1"][data-tone="neutral"]{fill:color-mix(in oklab,color-mix(in oklab,var(--ak-color-text-muted) 50%,var(--ak-color-accent)) 75%,var(--ak-color-background))}
.ak-net-swatch[data-ak-net-shade="1"][data-tone="neutral"]{background:color-mix(in oklab,color-mix(in oklab,var(--ak-color-text-muted) 50%,var(--ak-color-accent)) 75%,var(--ak-color-background))}
.ak-net-dot[data-ak-net-shade="2"]{fill:color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 55%,var(--ak-color-background))}
.ak-net-swatch[data-ak-net-shade="2"]{background:color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 55%,var(--ak-color-background))}
.ak-net-dot[data-ak-net-shade="3"]{fill:color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 38%,var(--ak-color-text))}
.ak-net-swatch[data-ak-net-shade="3"]{background:color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 38%,var(--ak-color-text))}
.ak-net-dot[data-ak-net-shade="4"]{fill:color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 38%,var(--ak-color-background))}
.ak-net-swatch[data-ak-net-shade="4"]{background:color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 38%,var(--ak-color-background))}
.ak-net-legend{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--ak-space-unit)}
.ak-net-legend li>*{display:inline-flex;align-items:center;gap:.5em;font:inherit;font-size:.9em;color:var(--ak-color-text);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:999px;padding:.35em .9em;min-height:36px}
.ak-net-legend li>span{border-color:transparent;background:none;min-height:0;padding:.2em .4em}
.ak-net-legend button:not([disabled]){cursor:pointer}
.ak-net-legend button[aria-pressed="true"]{border-color:var(--ak-color-accent);background:color-mix(in oklab,var(--ak-color-accent) 12%,var(--ak-color-surface));box-shadow:inset 0 0 0 1px var(--ak-color-accent)}
.ak-net-legend button:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-net-legend .ak-net-swatch{margin:0}
.ak-net-table td:nth-child(2){white-space:nowrap}
.ak-net-count{color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
.ak-net-table{max-height:26rem;overflow:auto;background:linear-gradient(to left,transparent,var(--ak-color-surface) 70%) left/2.5rem 100% no-repeat local,linear-gradient(to right,transparent,var(--ak-color-surface) 70%) right/2.5rem 100% no-repeat local,linear-gradient(to left,transparent,color-mix(in oklab,var(--ak-color-text) 14%,transparent)) left/.9rem 100% no-repeat scroll,linear-gradient(to right,transparent,color-mix(in oklab,var(--ak-color-text) 14%,transparent)) right/.9rem 100% no-repeat scroll,var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium)}
.ak-net-table:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-net-table table{width:100%;border-collapse:collapse;font-size:.9em}
.ak-net-table caption{text-align:left;padding:calc(var(--ak-space-unit)*1) calc(var(--ak-space-unit)*1.5);color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
.ak-net-table th,.ak-net-table td{padding:calc(var(--ak-space-unit)*.6) calc(var(--ak-space-unit)*1.5);border-top:var(--ak-border-width) solid var(--ak-color-border);text-align:left;vertical-align:top}
.ak-net-table thead th{position:sticky;top:0;background:var(--ak-color-surface);font-weight:600;color:var(--ak-color-text-muted);font-size:.85em;letter-spacing:.02em;z-index:1}
.ak-net-table td:nth-child(3){font-variant-numeric:tabular-nums}
.ak-net-table tbody th{font-weight:400}
.ak-net-table tbody th button{display:grid;gap:2px;text-align:left;font:inherit;color:var(--ak-color-text);background:none;border:0;border-radius:var(--ak-radius-small);padding:2px 6px;margin:-2px -6px;min-height:32px}
.ak-net-table tbody th button:not([disabled]){cursor:pointer}
.ak-net-table tbody th button:not([disabled]):hover{background:color-mix(in oklab,var(--ak-color-accent) 8%,transparent)}
.ak-net-table tbody th button:focus-visible{outline:2px solid var(--ak-color-accent)}
.ak-net-table .ak-3d-name{font-weight:600}
.ak-net-table tr:has(button[aria-pressed="true"]){background:color-mix(in oklab,var(--ak-color-accent) 12%,transparent)}
.ak-net-table tr[data-ak-net-near]{background:color-mix(in oklab,var(--ak-color-accent) 5%,transparent)}
.ak-net-table tr[data-ak-net-out]{display:none}
.ak-net-none{color:var(--ak-color-text-muted)}
.ak-net-tag{position:absolute;left:0;top:0;pointer-events:none;transform:translate(-50%,calc(-100% - 12px));padding:.3em .7em;border-radius:var(--ak-radius-small);background:color-mix(in oklab,var(--ak-color-surface) 88%,transparent);border:var(--ak-border-width) solid color-mix(in oklab,var(--ak-color-accent) 45%,var(--ak-color-border));color:var(--ak-color-text);font-size:.85em;font-weight:600;white-space:nowrap;box-shadow:0 6px 18px -8px color-mix(in oklab,var(--ak-color-text) 40%,transparent);backdrop-filter:blur(6px)}
.ak-net-tag[hidden]{display:none}
.ak-net-tag small{display:block;font-weight:400;color:var(--ak-color-text-muted)}
@media print{.ak-net-table{max-height:none;overflow:visible}.ak-net-table tr[data-ak-net-out]{display:table-row}.ak-net-tag{display:none}}
`;
