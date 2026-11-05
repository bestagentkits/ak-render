/** Token-driven CSS for `product-3d`: finish dropdown, plan, pins, the hotspot card and print. */

export const PRODUCT_CSS = `
.ak-3d-mark[data-tone="dark"]{--ak-3d-tone:color-mix(in oklab,var(--ak-color-text-muted) 42%,black)}
.ak-3d-mark[data-tone="light"]{--ak-3d-tone:color-mix(in oklab,var(--ak-color-surface) 18%,white)}
.ak-product .ak-3d-stage{background:radial-gradient(46% 38% at 50% 8%,color-mix(in oklab,var(--ak-color-surface) 70%,transparent),transparent 72%),radial-gradient(60% 50% at 50% 100%,color-mix(in oklab,var(--ak-color-accent) 10%,transparent),transparent 70%),radial-gradient(120% 90% at 50% 0%,var(--ak-color-surface-raised,var(--ak-color-surface)),color-mix(in oklab,var(--ak-color-background) 84%,var(--ak-color-text)))}
.ak-product-swatch{position:absolute;width:1px;height:1px;overflow:hidden;background:var(--ak-3d-tone,var(--ak-color-accent));pointer-events:none;opacity:0}
.ak-product-poster .ak-product-part{stroke:color-mix(in oklab,var(--ak-color-text) 20%,transparent);stroke-width:1;fill-opacity:.95}
.ak-product-shadow{fill:var(--ak-color-text);opacity:.1}
.ak-product-pin circle{fill:var(--ak-color-accent);stroke:var(--ak-color-surface);stroke-width:2}
.ak-product-pin text{fill:var(--ak-color-accent-contrast);font:700 11px var(--ak-font-body,inherit);text-anchor:middle}
.ak-product .ak-3d-pin[data-ak-back]{opacity:.4}
.ak-product-variant select{font:inherit;font-size:.9375em;min-height:44px;padding:0 calc(var(--ak-space-unit)*1.5);border-radius:999px;border:var(--ak-border-width) solid var(--ak-color-border);background:var(--ak-color-surface);color:var(--ak-color-text)}
.ak-product-variant select:not([disabled]){cursor:pointer}
.ak-product-variant select:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-product-detail{position:absolute;left:calc(var(--ak-space-unit)*2);bottom:calc(var(--ak-space-unit)*2);max-width:min(22rem,calc(100% - var(--ak-space-unit)*4));margin:0;display:grid;gap:2px;padding:calc(var(--ak-space-unit)*1.25) calc(var(--ak-space-unit)*1.75);border-radius:var(--ak-radius-medium);border:var(--ak-border-width) solid color-mix(in oklab,var(--ak-color-border) 70%,transparent);background:color-mix(in oklab,var(--ak-color-surface) 84%,transparent);backdrop-filter:blur(12px) saturate(1.2);box-shadow:0 12px 32px -12px color-mix(in oklab,var(--ak-color-text) 35%,transparent);color:var(--ak-color-text);font-size:.9375em;pointer-events:none}
.ak-product-detail[hidden]{display:none}
.ak-product-detail strong{display:flex;align-items:center;gap:calc(var(--ak-space-unit)*.75)}
.ak-product-detail span{color:var(--ak-color-text-muted);font-size:.9em}
.ak-product-finishes{display:none;flex-wrap:wrap;align-items:center;gap:var(--ak-space-unit)}
.ak-product-finishes ul{display:flex;flex-wrap:wrap;gap:calc(var(--ak-space-unit)*.5) calc(var(--ak-space-unit)*1.5);margin:0;padding:0;list-style:none}
.ak-product-finishes li[aria-current="true"]{font-weight:600}
.ak-product[data-ak-3d-state="static"] .ak-product-finishes,.ak-product[data-ak-3d-state="unsupported"] .ak-product-finishes,.ak-product[data-ak-3d-state="error"] .ak-product-finishes{display:flex}
@media (max-width:480px){.ak-product-detail{font-size:.875em;left:var(--ak-space-unit);bottom:var(--ak-space-unit);max-width:calc(100% - var(--ak-space-unit)*2)}}
@media (prefers-reduced-motion:no-preference){.ak-product-detail{animation:ak-product-card var(--ak-motion-duration,.2s) ease-out}@keyframes ak-product-card{from{opacity:0;transform:translateY(6px)}}}
@media print{.ak-product .ak-3d-controls,.ak-product-detail{display:none}.ak-product .ak-product-finishes{display:flex}}
`;
