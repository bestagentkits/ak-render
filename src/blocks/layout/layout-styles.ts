/**
 * Feature sheets for the responsive layout blocks.
 *
 * All placement is static attribute CSS: the CSP forbids inline styles, so a
 * span is a `data-ak-span="8"` attribute matched by a rule generated here once
 * at module load. The loops run over fixed ranges, so the text is identical on
 * every run and output stays byte-deterministic.
 *
 * Three features, each emitted only when a page uses it:
 * - `layout-options`: grid columns 7–12 and `auto`, grid `gap`/`align`, stack
 *   `align`. A grid or stack opts in from its `check` only when it uses a
 *   non-default option, so existing pages keep their exact bytes.
 * - `layout-tracks`: the 12-track grid a `grid-item` turns on.
 * - `semantic-layout`: `sidebar-layout`, `main-aside` and `rail-layout`.
 *
 * The `visibleWhen` wrapper is matched as `[data-ak-when]`: its class is the
 * `state` feature's marker, which must not appear unless that feature is used.
 *
 * The base sheet collapses every grid to one column at ≤480px with
 * `!important`. A tracked grid keeps its 12 tracks through a more specific
 * `!important` rule here, and places its children with `mobileSpan` instead.
 */

import type { IrNode } from '../../ir.js';
import type { FeatureModule } from '../../registry/block-module.js';

export const LAYOUT_OPTIONS_FEATURE = 'layout-options';
export const LAYOUT_TRACKS_FEATURE = 'layout-tracks';
export const SEMANTIC_LAYOUT_FEATURE = 'semantic-layout';

/** Number of tracks in a grid that holds grid items. */
export const GRID_TRACKS = 12;

/** `minItemWidth` for `columns: auto`, in rem. */
export const MIN_ITEM_WIDTHS: Readonly<Record<string, string>> = {
  narrow: '12rem',
  medium: '16rem',
  wide: '22rem',
};

const GAPS: Readonly<Record<string, string>> = {
  tight: 'var(--ak-space-unit)',
  loose: 'calc(var(--ak-space-unit) * 3)',
};

const FLEX_ALIGN: Readonly<Record<string, string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

const TRACK_TEMPLATE = (count: number) => `repeat(${count},minmax(0,1fr))`;

/**
 * Adds a module feature to a node from its `check`. Normalization copies
 * `runtimeFeatures` from the definition and appends `state` for `visibleWhen`
 * the same way; this lets a long-standing block (grid, stack) opt in only when
 * a new option is actually used.
 */
export function useFeature(node: IrNode, feature: string): void {
  if (!node.runtimeFeatures.includes(feature)) node.runtimeFeatures.push(feature);
}

const WIDE_COLUMNS = range(7, 12);

const LAYOUT_OPTIONS_CSS = [
  ...Object.entries(GAPS).map(([gap, value]) => `.ak-grid[data-gap="${gap}"]{gap:${value}}`),
  ...['start', 'center', 'end'].map(
    (align) => `.ak-grid[data-align="${align}"]{align-items:${align}}`,
  ),
  ...Object.entries(FLEX_ALIGN).map(
    ([align, value]) => `.ak-stack[data-align="${align}"] > *{align-self:${value}}`,
  ),
  ...WIDE_COLUMNS.map(
    (count) =>
      `.ak-grid[data-ak-columns="${count}"]{grid-template-columns:${TRACK_TEMPLATE(count)}}`,
  ),
  // The base tablet rule names columns by attribute; restate it after the wide
  // column rules above, which would otherwise win by source order.
  `@media (max-width:768px){.ak-grid:is(${WIDE_COLUMNS.map((count) => `[data-ak-columns="${count}"]`).join(',')}){grid-template-columns:${TRACK_TEMPLATE(2)}}}`,
  ...Object.entries(MIN_ITEM_WIDTHS).map(
    ([width, value]) =>
      `.ak-grid[data-ak-columns="auto"][data-ak-min="${width}"]{grid-template-columns:repeat(auto-fit,minmax(min(100%,${value}),1fr))}`,
  ),
].join('\n');

/** A tracked grid's children that are not grid items, directly or inside a `visibleWhen` wrapper. */
const plainChildren = (grid: string) =>
  `${grid} > :not(.ak-grid-item,[data-ak-when]),${grid} > [data-ak-when] > :not(.ak-grid-item)`;

const TRACKED = '.ak-grid[data-ak-tracks]';

const LAYOUT_TRACKS_CSS = [
  `${TRACKED}{grid-template-columns:${TRACK_TEMPLATE(GRID_TRACKS)}!important}`,
  '.ak-grid-item{display:flex;flex-direction:column;gap:var(--ak-gap);min-width:0}',
  '.ak-grid-item > .ak-block,.ak-grid-item > [data-ak-when] > .ak-block{margin-top:0}',
  // A plain child takes the width it had in an untracked grid: 12 / columns.
  ...range(1, 12).map(
    (columns) =>
      `${plainChildren(`${TRACKED}[data-ak-columns="${columns}"]`)}{grid-column-end:span ${Math.max(1, Math.floor(GRID_TRACKS / columns))}}`,
  ),
  ...range(1, 12).map(
    (span) => `.ak-grid-item[data-ak-span="${span}"]{grid-column-end:span ${span}}`,
  ),
  ...range(1, 12).map(
    (start) => `.ak-grid-item[data-ak-start="${start}"]{grid-column-start:${start}}`,
  ),
  ...range(1, 4).map(
    (rows) => `.ak-grid-item[data-ak-row-span="${rows}"]{grid-row-end:span ${rows}}`,
  ),
  ...['start', 'center', 'end', 'stretch'].map(
    (align) => `.ak-grid-item[data-align="${align}"]{align-self:${align}}`,
  ),
  // Tablet: plain children pair up as the untracked grid does; explicit starts
  // are dropped so a narrower span never pushes past the last track.
  `@media (max-width:768px){${plainChildren(`${TRACKED}:not([data-ak-columns="1"])`)}{grid-column-end:span 6}.ak-grid-item[data-ak-start]{grid-column-start:auto}${range(
    1,
    12,
  )
    .map((span) => `.ak-grid-item[data-ak-tablet-span="${span}"]{grid-column-end:span ${span}}`)
    .join('')}}`,
  // Mobile: everything is full width unless the author set mobileSpan.
  `@media (max-width:480px){${plainChildren(`${TRACKED}[data-ak-columns]`)}{grid-column-end:span 12}.ak-grid-item[data-ak-span]{grid-column-end:span 12}.ak-grid-item[data-ak-row-span]{grid-row-end:auto}${range(
    1,
    12,
  )
    .map((span) => `.ak-grid-item[data-ak-mobile-span="${span}"]{grid-column-end:span ${span}}`)
    .join('')}}`,
].join('\n');

/** Children of a layout region, directly or inside a `visibleWhen` wrapper. */
const regionChildren = (region: string) => `${region} > *,${region} > [data-ak-when] > *`;

const SEMANTIC_LAYOUT_CSS = [
  '.ak-sidebar-layout,.ak-main-aside,.ak-rail-layout{display:grid;gap:calc(var(--ak-space-unit) * 3);grid-template-columns:minmax(0,1fr)}',
  '.ak-layout-main,.ak-layout-side{min-width:0}',
  `${regionChildren('.ak-layout-side')}{margin-top:0}`,
  '.ak-layout-side{display:flex;flex-direction:column;gap:var(--ak-gap)}',
  '.ak-rail{display:flex;gap:var(--ak-space-unit);overflow-x:auto;padding-bottom:var(--ak-space-unit)}',
  `${regionChildren('.ak-rail')}{flex:0 0 auto;max-width:85%;margin-top:0}`,
  `.ak-rail > a,.ak-rail > [data-ak-when] > a{display:inline-flex;align-items:center;min-height:44px;padding:0 .85em;border-radius:var(--ak-radius-small);color:var(--ak-color-text);text-decoration:none;font-weight:550}`,
  `.ak-rail > a:hover,.ak-rail > [data-ak-when] > a:hover{background:var(--ak-tint)}`,
  '@media (min-width:769px){.ak-sidebar-layout{grid-template-columns:minmax(12rem,1fr) minmax(0,3fr)}.ak-sidebar-layout[data-side="end"]{grid-template-columns:minmax(0,3fr) minmax(12rem,1fr)}.ak-main-aside{grid-template-columns:minmax(0,2fr) minmax(14rem,1fr)}.ak-rail-layout{grid-template-columns:minmax(9rem,13rem) minmax(0,1fr)}' +
    `.ak-rail{flex-direction:column;overflow-x:visible;padding-bottom:0}${regionChildren('.ak-rail')}{flex:none;max-width:none}.ak-rail .ak-toolbar{flex-direction:column;align-items:stretch}.ak-rail .ak-toolbar > a{margin-left:0}}`,
  '@media screen and (min-width:1024px) and (min-height:640px){.ak-main-aside > .ak-layout-side,.ak-rail-layout > .ak-rail{position:sticky;top:calc(var(--ak-space-unit) * 4);align-self:start}}',
  `@media print{.ak-sidebar-layout,.ak-main-aside,.ak-rail-layout{display:block}.ak-layout-side,.ak-rail{position:static;overflow:visible;flex-wrap:wrap;margin:var(--ak-gap) 0}}`,
].join('\n');

export const LAYOUT_FEATURES: readonly FeatureModule[] = [
  { name: LAYOUT_OPTIONS_FEATURE, marker: '.ak-grid[data-gap="tight"]', css: LAYOUT_OPTIONS_CSS },
  { name: LAYOUT_TRACKS_FEATURE, marker: TRACKED, css: LAYOUT_TRACKS_CSS },
  { name: SEMANTIC_LAYOUT_FEATURE, marker: '.ak-sidebar-layout', css: SEMANTIC_LAYOUT_CSS },
];
