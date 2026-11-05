/** Token-driven CSS for the 3D blocks; emitted only on pages that use one. */

export const THREE_CSS = `
.ak-3d{margin:0;display:grid;gap:calc(var(--ak-space-unit)*2)}
.ak-3d-stage{position:relative;aspect-ratio:16/9;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:radial-gradient(120% 90% at 50% 0%,var(--ak-color-surface-raised,var(--ak-color-surface)),var(--ak-color-background));overflow:hidden}
.ak-3d-poster{position:absolute;inset:0;width:100%;height:100%}
.ak-3d-mark{fill:var(--ak-3d-tone,var(--ak-color-accent));stroke:var(--ak-3d-tone,var(--ak-color-accent));fill-opacity:.82}
.ak-3d-mark text{fill:var(--ak-color-text);stroke:none;fill-opacity:1;font:600 13px var(--ak-font-body,inherit);text-anchor:middle}
.ak-3d-mark[data-tone="neutral"]{--ak-3d-tone:var(--ak-color-text-muted)}
.ak-3d-mark[data-tone="success"]{--ak-3d-tone:var(--ak-color-success)}
.ak-3d-mark[data-tone="warning"]{--ak-3d-tone:var(--ak-color-warning)}
.ak-3d-mark[data-tone="danger"]{--ak-3d-tone:var(--ak-color-danger)}
.ak-3d-mark[data-tone="info"]{--ak-3d-tone:var(--ak-color-info)}
.ak-3d-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.ak-3d-canvas:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:-2px}
.ak-3d[data-ak-3d-state="ready"] .ak-3d-poster{visibility:hidden}
.ak-3d-caption{color:var(--ak-color-text-muted)}
.ak-3d-objects{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--ak-space-unit)}
.ak-3d-objects li{display:flex}
.ak-3d-objects button,.ak-3d-objects li>span{display:grid;gap:2px;text-align:left;font:inherit;color:var(--ak-color-text);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small);padding:calc(var(--ak-space-unit)*.75) calc(var(--ak-space-unit)*1.25);min-height:44px}
.ak-3d-objects button:not([disabled]){cursor:pointer}
.ak-3d-objects button[aria-pressed="true"]{border-color:var(--ak-color-accent);box-shadow:inset 0 0 0 1px var(--ak-color-accent)}
.ak-3d-objects button:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-3d-name{font-weight:600}
.ak-3d-note{color:var(--ak-color-text-muted);font-size:.875em}
@media print{.ak-3d[data-ak-3d-state="ready"] .ak-3d-poster{visibility:visible}.ak-3d-canvas{display:none}}
`;
