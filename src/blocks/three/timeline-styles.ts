/**
 * Token-driven CSS for `timeline-3d`: the drawn path, the narrative card over
 * the stage, the step and scrub controls and the milestone rail. Milestones
 * after the current one fade, so the drawing reads as progress along the path.
 */

export const TIMELINE_CSS = `
.ak-tl-view{position:relative;display:grid;gap:var(--ak-space-unit)}
.ak-tl .ak-3d-stage{background:radial-gradient(55% 45% at 50% 58%,color-mix(in oklab,var(--ak-color-accent) 13%,transparent),transparent 72%),radial-gradient(80% 40% at 50% 100%,color-mix(in oklab,var(--ak-color-info) 8%,transparent),transparent 70%),radial-gradient(120% 95% at 50% 0%,var(--ak-color-surface-raised,var(--ak-color-surface)),color-mix(in oklab,var(--ak-color-background) 88%,var(--ak-color-text)))}
.ak-tl-poster .ak-tl-seg{fill:none;stroke-linecap:round;stroke-opacity:.9}
.ak-tl-poster .ak-tl-dot{fill-opacity:1;stroke:color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 70%,#000);stroke-width:.8}
.ak-tl-poster [data-ak-future]{fill-opacity:.38;stroke-opacity:.32}
.ak-tl-poster .ak-tl-dot[data-ak-future]{fill:color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 45%,var(--ak-color-surface));fill-opacity:1;stroke-opacity:.4}
.ak-tl-stem{stroke:color-mix(in oklab,var(--ak-color-text) 22%,transparent);stroke-width:.8}
.ak-tl-shadow{fill:color-mix(in oklab,var(--ak-color-text) 16%,transparent)}
.ak-tl-halo{fill:color-mix(in oklab,var(--ak-color-accent) 14%,transparent);stroke:var(--ak-color-accent);stroke-width:1.5;stroke-opacity:.8}
.ak-tl-tag text{fill:var(--ak-color-text-muted);font:600 11px var(--ak-font-body,inherit);letter-spacing:.04em;text-anchor:middle;paint-order:stroke;stroke:var(--ak-color-surface);stroke-width:3px;stroke-linejoin:round;font-variant-numeric:tabular-nums}
.ak-tl-tag[data-ak-current] text{fill:var(--ak-color-accent)}
.ak-tl-tag .ak-tl-tag-name{fill:var(--ak-color-text);font:650 13px var(--ak-font-heading,var(--ak-font-body,inherit));letter-spacing:0}
.ak-tl-card{display:grid;gap:2px;align-content:start;padding:calc(var(--ak-space-unit)*1.5) calc(var(--ak-space-unit)*2);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);background:var(--ak-color-surface);box-shadow:0 10px 30px -18px color-mix(in oklab,var(--ak-color-text) 45%,transparent)}
.ak-tl-step{font:600 .75em/1.4 var(--ak-font-mono,ui-monospace,monospace);letter-spacing:.08em;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
.ak-tl-card .ak-tl-date{font-weight:650;color:var(--ak-color-accent);font-variant-numeric:tabular-nums}
.ak-tl-title{font:650 1.125em/1.25 var(--ak-font-heading,var(--ak-font-body,inherit));color:var(--ak-color-text);text-wrap:balance}
.ak-tl-text{color:var(--ak-color-text-muted);font-size:.9375em;line-height:1.45}
.ak-tl-card{border-left:3px solid var(--ak-color-accent)}
@media (min-width:720px){.ak-tl-card{grid-template-columns:minmax(7.5rem,auto) 1fr;column-gap:calc(var(--ak-space-unit)*3)}.ak-tl-card .ak-tl-step,.ak-tl-card .ak-tl-date{grid-column:1}.ak-tl-card .ak-tl-title,.ak-tl-card .ak-tl-text{grid-column:2}.ak-tl-card .ak-tl-title{grid-row:1}.ak-tl-card .ak-tl-text{grid-row:2 / span 2}}
.ak-tl-tags{position:absolute;inset:0;pointer-events:none;overflow:hidden;visibility:hidden}
.ak-3d[data-ak-3d-state="ready"] .ak-tl-tags,.ak-3d[data-ak-3d-state="frozen"] .ak-tl-tags{visibility:visible}
.ak-tl-tag-live{position:absolute;left:0;top:0;margin-top:-30px;white-space:nowrap;translate:-50% 0;font:600 11px/1.2 var(--ak-font-body,inherit);letter-spacing:.04em;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums;padding:3px 8px;border-radius:999px;background:color-mix(in oklab,var(--ak-color-surface) 80%,transparent);border:1px solid color-mix(in oklab,var(--ak-color-text) 12%,transparent);backdrop-filter:blur(6px)}
.ak-tl-tag-live[data-ak-current]{margin-top:-38px;color:var(--ak-color-text);border-color:var(--ak-color-accent);font-size:12px;box-shadow:0 6px 18px -10px color-mix(in oklab,var(--ak-color-text) 50%,transparent)}
.ak-tl-tag-live[hidden]{display:none}
.ak-tl-nav{flex-wrap:nowrap}
.ak-tl-nav button{text-transform:none;flex:none}
.ak-tl-nav button[aria-pressed="true"]{background:var(--ak-color-surface);color:var(--ak-color-text);border-color:var(--ak-color-border)}
.ak-tl-nav button[data-ak-tl-overview][aria-pressed="false"]:not([disabled]){border-color:var(--ak-color-accent);color:var(--ak-color-accent)}
.ak-tl-scrub{flex:1;min-width:0;min-height:44px;margin:0;accent-color:var(--ak-color-accent);cursor:pointer}
.ak-tl-scrub[disabled]{cursor:default}
.ak-tl-scrub:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-tl-list{position:relative;list-style:none;margin:0;padding:2px 2px calc(var(--ak-space-unit)*1);display:grid;grid-auto-flow:column;grid-auto-columns:minmax(13rem,16rem);gap:var(--ak-space-unit);overflow-x:auto;scroll-snap-type:x proximity;overscroll-behavior-x:contain;counter-reset:ak-tl}
.ak-tl-list li{display:flex;scroll-snap-align:center}
.ak-tl-list button{flex:1;display:grid;grid-template-columns:auto 1fr;align-content:start;column-gap:calc(var(--ak-space-unit)*.75);row-gap:2px;text-align:left;font:inherit;color:var(--ak-color-text);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-small);padding:calc(var(--ak-space-unit)*.9) calc(var(--ak-space-unit)*1.25);min-height:44px}
.ak-tl-list button>*:not(.ak-tl-swatch){grid-column:2}
.ak-tl-list .ak-tl-date{font-size:.8125em;font-weight:600;color:var(--ak-color-text-muted);font-variant-numeric:tabular-nums}
.ak-tl-list .ak-3d-name{font-weight:600}
.ak-tl-swatch{grid-row:1 / span 3;width:10px;height:10px;margin-top:.35em;border-radius:50%;background:var(--ak-3d-tone,var(--ak-color-accent));box-shadow:0 0 0 3px color-mix(in oklab,var(--ak-3d-tone,var(--ak-color-accent)) 22%,transparent)}
.ak-tl-list button:not([disabled]){cursor:pointer}
.ak-tl-list button:not([disabled]):hover{border-color:color-mix(in oklab,var(--ak-color-accent) 55%,var(--ak-color-border))}
.ak-tl-list button[aria-pressed="true"]{border-color:var(--ak-color-accent);box-shadow:inset 0 0 0 1px var(--ak-color-accent);background:color-mix(in oklab,var(--ak-color-accent) 7%,var(--ak-color-surface))}
.ak-tl-list button:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
@media print{.ak-tl-nav{display:none}.ak-tl-card{position:static;max-width:none;backdrop-filter:none;box-shadow:none}.ak-tl-list{display:block;overflow:visible;columns:2;column-gap:calc(var(--ak-space-unit)*2)}.ak-tl-list li{break-inside:avoid;margin-bottom:var(--ak-space-unit)}.ak-tl-list button{box-shadow:none}}
`;
