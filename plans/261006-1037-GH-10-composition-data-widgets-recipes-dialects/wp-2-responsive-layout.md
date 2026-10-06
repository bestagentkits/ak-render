# WP2 — Responsive layout: grid-item, semantic layouts, grid/stack options

Issue phase 2. Depends on W0. Branch `gh10/wp2-layout`. Estimate 6h.

## Goal

Authors get explicit spans and semantic page layouts without touching CSS. All placement is static
data-attribute CSS. Inline styles are never used, because the CSP forbids them.

## Context

- After W0, grid, stack and split live in `src/blocks/layout/`. The grid CSS is in `src/render/styles.ts:70-86`
  and `:215-220`.
- Media queries are at `styles.ts:258-259`:
  - at ≤768, `.ak-grid:not([data-ak-columns="1"])` collapses to 2 columns;
  - at ≤480, `.ak-grid,.ak-gallery{grid-template-columns:1fr!important}`.

  The `!important` would override span tracks, so grids with grid-items must be exempted.
- `grid.columns` is currently 1–6.

## Files

| Ownership | File |
| --- | --- |
| exclusive | `src/blocks/layout/*`, `src/render/styles.ts` |
| create | `src/blocks/layout/{grid-item,sidebar-layout,main-aside,rail-layout}.ts`, `src/blocks/layout/layout-styles.ts` (feature CSS for new layouts), `tests/unit/responsive-layout.test.ts`, `fixtures/pages/responsive-layouts.yaml` |
| notes | `reports/wp2-notes.md` |

`styles.ts` is in DESIGN.md's read-first list. Read DESIGN.md before you edit it. New block CSS goes in the
feature CSS of `layout-styles.ts`, not in BASE_CSS. Only the existing grid, stack and gallery rules in BASE change.

## Contracts

```yaml
- type: grid
  columns: 12            # 1..12 | auto   (existing 1..6 unchanged)
  minItemWidth: medium   # narrow|medium|wide, only with columns: auto (→ 12rem/16rem/22rem)
  gap: normal            # tight|normal|loose   → --ak-space tokens
  align: stretch         # start|center|end|stretch
  blocks:
    - type: grid-item    # parents: [grid]
      span: 8            # 1..12, default 12/columns-equivalent 1 track
      tabletSpan: 12     # applies ≤768
      mobileSpan: 12     # applies ≤480 (default: full width)
      rowSpan: 2         # 1..4
      start: 1           # 1..12
      align: start       # start|center|end|stretch
      blocks: [ ... ]    # children
- type: stack
  align: center          # start|center|end|stretch (new), gap tight|normal|loose (new if absent)
- type: sidebar-layout   # main = blocks; sidebar slot (kind blocks, max 8); side: start|end (default start)
  sidebar: [ ... ]
  blocks: [ ... ]
- type: main-aside       # aside slot (max 6); aside sticks on ≥1024 with position:sticky
  aside: [ ... ]
  blocks: [ ... ]
- type: rail-layout      # rail slot (max 8) renders as a compact vertical nav/rail; ≤768 becomes a top strip
  rail: [ ... ]
  blocks: [ ... ]
```

- `grid-item` is not a container on its own. Its definition has `parents: ['grid']`, which W0 enforces.
- A grid containing at least one grid-item renders `data-ak-tracks="12"`, and every child gets a span. A plain
  child in such a grid behaves as `span: 12/columns`. This is the documented default.
- CSS is static and covers the full matrix:
  - `[data-ak-span="1"]`…`[data-ak-span="12"]`
  - tablet and mobile variants inside the media queries
  - `rowSpan` 1–4
  - `start` 1–12
  - columns 7–12

  That is about 60 short rules. Generate them in TS with a loop at module load. The output stays deterministic.
- In the `≤480` rule, `.ak-grid:not([data-ak-tracks])` keeps the `1fr` collapse. A tracked grid uses mobileSpan
  (default 12).

## Steps

1. Widen `grid.columns` to `oneOf(1..12 number, 'auto')`. Add `minItemWidth`, `gap` and `align`. Add stack
   `align` and `gap`. Add a check: `minItemWidth` without `columns: auto` is a warning.
2. Add the grid-item module and the tracked-grid rendering.
3. Add the three semantic layouts. Use semantic HTML: `<aside>` for sidebar and aside, `<nav aria-label>` only
   when the rail contains only links/toolbar, otherwise a `<div role="region">`. DOM order is main-first for
   main-aside and sidebar-first for sidebar-layout, matching the visual order at every width.
4. Add the CSS (feature `layout-tracks`, marker `.ak-grid[data-ak-tracks]`; feature `semantic-layout`). The
   `split` behavior is unchanged.
5. Add the fixture `responsive-layouts.yaml`: an 8/4 dashboard grid, auto-fit cards, sidebar-layout,
   main-aside with a sticky aside, a rail-layout, and a grid item with a rowSpan.

## Tests

- **Unit.**
  - Each new block validates and renders the expected data attributes.
  - A `grid-item` outside a grid is rejected with its path.
  - `span: 13` is rejected.
  - `columns: 4` output for existing fixtures is byte-identical.
  - The emitted CSS contains no `style=`.
- **Browser** (W2-B matrix, plus a local check here). At 320 and 375 there is no horizontal overflow, and at
  1440 the 8/4 grid geometry ratio holds within ±2px.

## Acceptance

- [ ] Existing grids, stacks and splits are byte-identical.
- [ ] `pnpm snapshots:check` diffs are limited to the new fixture after regeneration.
- [ ] CSS for `layout-tracks` and `semantic-layout` is emitted only when used, and the `verify.ts` marker check
  passes.

## Risks

| Risk | Mitigation |
| --- | --- |
| The `!important` collapse overrides spans | The `:not([data-ak-tracks])` exemption, plus a 375 browser check |
| Sticky aside overlap in print | `@media print{position:static}` |
| CSS bloat from the static span matrix | Emitted only when a tracked grid is present |

Rollback: revert and regenerate. No other WP depends on these blocks. W2 fixtures that use them must then drop
them.
