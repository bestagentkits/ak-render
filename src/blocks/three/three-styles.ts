/** Token-driven CSS for the 3D blocks; emitted only on pages that use one. */

export const THREE_CSS = `
.ak-3d{margin:0;display:grid;gap:calc(var(--ak-space-unit)*2)}
.ak-3d-stage{position:relative;aspect-ratio:16/9;border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:radial-gradient(70% 60% at 50% 0%,color-mix(in oklab,var(--ak-color-accent) 9%,transparent),transparent 70%),radial-gradient(120% 90% at 50% 0%,var(--ak-color-surface-raised,var(--ak-color-surface)),color-mix(in oklab,var(--ak-color-background) 88%,var(--ak-color-text)));box-shadow:inset 0 1px 0 color-mix(in oklab,var(--ak-color-surface) 60%,transparent),inset 0 -40px 80px -40px color-mix(in oklab,var(--ak-color-text) 10%,transparent);overflow:hidden}
@media (max-width:480px){.ak-3d-stage{aspect-ratio:4/3}}
.ak-3d-poster{position:absolute;inset:0;width:100%;height:100%}
.ak-3d-mark{fill:var(--ak-3d-tone,var(--ak-color-accent));stroke:var(--ak-3d-tone,var(--ak-color-accent));fill-opacity:.82}
.ak-3d-mark .ak-3d-face{fill-opacity:1;stroke-linejoin:round;stroke-width:1.2;stroke:color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 70%,#000)}
.ak-3d-mark .ak-3d-sheen,.ak-3d-mark .ak-3d-shade{stroke:none}
.ak-3d-mark .ak-3d-shade{fill:#000}
.ak-3d-mark text{fill:var(--ak-color-text);stroke:none;fill-opacity:1;font:600 13px var(--ak-font-body,inherit);text-anchor:middle}
.ak-3d-mark[data-tone="neutral"]{--ak-3d-tone:var(--ak-color-text-muted)}
.ak-3d-mark[data-tone="success"]{--ak-3d-tone:var(--ak-color-success)}
.ak-3d-mark[data-tone="warning"]{--ak-3d-tone:var(--ak-color-warning)}
.ak-3d-mark[data-tone="danger"]{--ak-3d-tone:var(--ak-color-danger)}
.ak-3d-mark[data-tone="info"]{--ak-3d-tone:var(--ak-color-info)}
.ak-3d-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.ak-3d-canvas:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:-2px}
.ak-3d[data-ak-3d-state="ready"] .ak-3d-poster,.ak-3d[data-ak-3d-state="frozen"] .ak-3d-poster{visibility:hidden}
.ak-3d-frame{position:absolute;inset:0;width:100%;height:100%;display:block}
.ak-3d[data-ak-3d-state="frozen"] .ak-3d-canvas{visibility:hidden}
.ak-3d-caption{color:var(--ak-color-text-muted)}
.ak-3d-objects{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;align-items:stretch;gap:var(--ak-space-unit)}
.ak-3d-objects li{display:flex}
.ak-3d-objects li>*{flex:1}
.ak-3d-objects button,.ak-3d-objects li>span{display:grid;gap:2px;text-align:left;font:inherit;color:var(--ak-color-text);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small);padding:calc(var(--ak-space-unit)*.75) calc(var(--ak-space-unit)*1.25);min-height:44px}
.ak-3d-objects li>span{border-style:dashed;background:transparent;color:var(--ak-color-text-muted)}
.ak-3d-objects button:not([disabled]){cursor:pointer}
.ak-3d-objects button[aria-pressed="true"]{border-color:var(--ak-color-accent);box-shadow:inset 0 0 0 1px var(--ak-color-accent)}
.ak-3d-objects button:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-3d-objects .ak-3d-name{font-weight:600}
.ak-3d-note{color:var(--ak-color-text-muted);font-size:.875em}
.ak-bars-legend{display:flex;flex-wrap:wrap;gap:var(--ak-space-unit)}
.ak-bars-legend button{display:inline-flex;align-items:center;gap:calc(var(--ak-space-unit)*.75);font:inherit;font-size:.875em;color:var(--ak-color-text);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:999px;padding:calc(var(--ak-space-unit)*.5) calc(var(--ak-space-unit)*1.25);min-height:36px}
.ak-bars-legend button:not([disabled]){cursor:pointer}
.ak-bars-legend button[disabled]{opacity:1}
.ak-bars-legend button[aria-pressed="true"]:not([disabled]){border-color:var(--ak-color-accent);box-shadow:inset 0 0 0 1px var(--ak-color-accent)}
.ak-bars-legend button:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-bars-swatch{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--ak-3d-tone,var(--ak-color-accent))}
@supports (color:oklch(from red calc(clamp(.5,l,.62) + .14) max(c,.14) calc(h + 30))){.ak-bars .ak-3d-mark[data-series="0"]{--ak-3d-tone:oklch(from var(--ak-color-accent) clamp(.5,l,.62) max(c,.14) calc(h + 0))}.ak-bars .ak-3d-mark[data-series="1"]{--ak-3d-tone:oklch(from var(--ak-color-accent) clamp(.5,l,.62) max(c,.14) calc(h + 180))}.ak-bars .ak-3d-mark[data-series="2"]{--ak-3d-tone:oklch(from var(--ak-color-accent) clamp(.5,l,.62) max(c,.14) calc(h + 60))}.ak-bars .ak-3d-mark[data-series="3"]{--ak-3d-tone:oklch(from var(--ak-color-accent) clamp(.5,l,.62) max(c,.14) calc(h + 240))}.ak-bars .ak-3d-mark[data-series="4"]{--ak-3d-tone:oklch(from var(--ak-color-accent) clamp(.5,l,.62) max(c,.14) calc(h + 120))}.ak-bars .ak-3d-mark[data-series="5"]{--ak-3d-tone:oklch(from var(--ak-color-accent) clamp(.5,l,.62) max(c,.14) calc(h + 300))}.ak-bars .ak-3d-mark[data-series="6"]{--ak-3d-tone:oklch(from var(--ak-color-accent) calc(clamp(.5,l,.62) + .14) max(c,.14) calc(h + 30))}.ak-bars .ak-3d-mark[data-series="7"]{--ak-3d-tone:oklch(from var(--ak-color-accent) calc(clamp(.5,l,.62) + .14) max(c,.14) calc(h + 210))}.ak-bars .ak-3d-mark[data-series="8"]{--ak-3d-tone:oklch(from var(--ak-color-accent) calc(clamp(.5,l,.62) + .14) max(c,.14) calc(h + 90))}.ak-bars .ak-3d-mark[data-series="9"]{--ak-3d-tone:oklch(from var(--ak-color-accent) calc(clamp(.5,l,.62) + .14) max(c,.14) calc(h + 270))}.ak-bars .ak-3d-mark[data-series="10"]{--ak-3d-tone:oklch(from var(--ak-color-accent) calc(clamp(.5,l,.62) + .14) max(c,.14) calc(h + 150))}.ak-bars .ak-3d-mark[data-series="11"]{--ak-3d-tone:oklch(from var(--ak-color-accent) calc(clamp(.5,l,.62) + .14) max(c,.14) calc(h + 330))}}
@media (max-width:480px){.ak-bars .ak-3d-stage{aspect-ratio:16/10}.ak-bars-poster .ak-bars-tick,.ak-bars-poster .ak-bars-cat{font-size:28px}}
.ak-bars-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden;visibility:hidden}
.ak-3d[data-ak-3d-state="ready"] .ak-bars-labels{visibility:visible}
.ak-bars-label{position:absolute;left:0;top:0;white-space:nowrap;font:500 12px/1.2 var(--ak-font-body,inherit);color:var(--ak-color-text-muted);font-variant-numeric:lining-nums tabular-nums;text-shadow:0 0 3px var(--ak-color-surface),0 0 6px var(--ak-color-surface)}
.ak-bars-label-zero{color:var(--ak-color-text);font-weight:600}
.ak-bars-label-row{color:var(--ak-color-text)}
.ak-bars-grid{stroke:var(--ak-color-border);stroke-width:1}
.ak-bars-zero{stroke:var(--ak-color-text);stroke-width:1.5}
.ak-bars-tick{fill:var(--ak-color-text-muted);font:12px var(--ak-font-body,inherit);text-anchor:end;font-variant-numeric:lining-nums tabular-nums}
.ak-bars-cat{fill:var(--ak-color-text-muted);font:12px var(--ak-font-body,inherit);text-anchor:middle}
.ak-bars-poster .ak-3d-mark{stroke:none;fill-opacity:.9}
.ak-bars-data{max-height:22rem;overflow:auto}
.ak-bars-data td button{font:inherit;font-variant-numeric:tabular-nums;color:inherit;background:none;border:0;border-radius:var(--ak-radius-small);padding:2px 6px;min-height:28px;text-align:right}
.ak-bars-data td button:not([disabled]){cursor:pointer}
.ak-bars-data td button:not([disabled]):hover{background:color-mix(in oklab,var(--ak-color-accent) 10%,transparent)}
.ak-bars-data td button[aria-pressed="true"]{background:color-mix(in oklab,var(--ak-color-accent) 18%,transparent);box-shadow:inset 0 0 0 1px var(--ak-color-accent)}
.ak-bars-data td button:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:1px}
@media print{.ak-bars-data{max-height:none;overflow:visible}.ak-bars-labels{display:none}.ak-bars-legend [data-ak-bars-filter=""]{display:none}.ak-bars-legend button[aria-pressed="true"]:not([disabled]){box-shadow:none;border-color:var(--ak-color-border)}}
.ak-3d-pins{position:absolute;inset:0;pointer-events:none}
.ak-3d-pin{position:absolute;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid var(--ak-color-surface);background:var(--ak-color-accent);color:var(--ak-color-accent-contrast);font:700 12px/1 var(--ak-font-body,inherit);display:grid;place-items:center;cursor:pointer;pointer-events:auto;box-shadow:0 2px 10px color-mix(in oklab,var(--ak-color-text) 28%,transparent),0 0 0 4px color-mix(in oklab,var(--ak-color-accent) 22%,transparent)}
.ak-3d-pin[aria-pressed="true"]{background:var(--ak-color-text);color:var(--ak-color-surface);box-shadow:0 2px 10px color-mix(in oklab,var(--ak-color-text) 28%,transparent),0 0 0 6px color-mix(in oklab,var(--ak-color-accent) 45%,transparent)}
.ak-3d-pin[hidden]{display:none}
.ak-3d[data-ak-3d-state="frozen"] .ak-3d-pins{visibility:visible}
.ak-3d-controls{display:flex;flex-wrap:wrap;gap:calc(var(--ak-space-unit)*1.5) calc(var(--ak-space-unit)*3)}
.ak-3d-control{display:flex;flex-wrap:wrap;align-items:center;gap:var(--ak-space-unit)}
.ak-3d-control-label{font-size:.8125em;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ak-color-text-muted);margin-right:calc(var(--ak-space-unit)*.5)}
.ak-3d-control button{font:inherit;font-size:.9375em;min-height:44px;padding:0 calc(var(--ak-space-unit)*1.5);border-radius:999px;border:var(--ak-border-width) solid var(--ak-color-border);background:var(--ak-color-surface);color:var(--ak-color-text);text-transform:capitalize}
.ak-3d-control button:not([disabled]){cursor:pointer}
.ak-3d-control button[aria-pressed="true"]{background:var(--ak-color-accent);border-color:var(--ak-color-accent);color:var(--ak-color-accent-contrast)}
.ak-3d-control button:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-3d-hotspots{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.ak-3d-hotspots .ak-3d-name{display:flex;align-items:center;gap:calc(var(--ak-space-unit)*.75)}
.ak-3d-num{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--ak-color-accent);color:var(--ak-color-accent-contrast);font-size:.75em;font-weight:700;flex:none}
.ak-3d-error{position:absolute;left:50%;bottom:calc(var(--ak-space-unit)*2);transform:translateX(-50%);margin:0;padding:calc(var(--ak-space-unit)*.75) calc(var(--ak-space-unit)*1.5);border-radius:var(--ak-radius-small);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-danger);color:var(--ak-color-text);font-size:.875em}
img.ak-3d-poster{object-fit:contain}
@media print{.ak-3d-pins{display:none}.ak-3d[data-ak-3d-state="ready"] .ak-3d-poster{visibility:visible}.ak-3d-canvas{display:none}}
`;
