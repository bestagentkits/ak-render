# W2-B notes: required fixtures, composition matrix, spec compression

Branch `gh10/w2-fixtures`.

## Changelog lines

- test(fixtures): Six required composition fixtures:
  - `complex-dashboard`: data-console, a 12-track grid, KPIs, stacked and line charts from one dataset, a data table, main-aside;
  - `benchmark-report`: benchmark comparison, a waterfall, a data table with percent and sparkline columns, tabs, references;
  - `research-report`: research-notebook, a sidebar layout, an annotated image, a metric breakdown, a rich accordion, references;
  - `product-case-study`: product-studio, a hero, a testimonial, pricing, a feature matrix, a gallery with lightbox, a logo cloud, people;
  - `interactive-data-explorer`: state, a filter-bar over a data table, a `visibleWhen` metric switcher, charts on the same dataset;
  - `incident-report`: executive-report, a timeline, a log viewer, test results, an API endpoint, a kanban, a roadmap.

  Every fixture validates with zero warnings and compiles to identical bytes three times.
- test(browser): `composition-matrix.spec.ts` checks every fixture page for:
  - no horizontal overflow at 320, 375, 768 and 1440 in light and dark;
  - no running animation under reduced motion;
  - script-off readability of tabs, accordion, carousel and the initial `visibleWhen` view;
  - visible panels in print;
  - Tab reaching every control, each with a visible focus change;
  - zero network requests;
  - no critical axe violation.
- build(deps): `@axe-core/playwright` is a devDependency (controller decision 7).
- feat(benchmarks): `pnpm bench:spec` writes `docs/artifacts/spec-compression.{json,md}`. Per required fixture it records the spec bytes, the bytes with every `dataRef` inlined, the HTML bytes, the catalog bytes and the compact-describe bytes. The output is deterministic.
- fix(benchmarks): `agent-token-cost.mjs` now reads block types from the compiler IR. The old line regex also picked up data-table column `type:` values, so it crashed on `data-tables.yaml`.
- feat(benchmarks): `agent-token-cost.mjs` gains `--legacy-from <artifact.json>`, which refreshes the artifact from recorded legacy rows without the private corpus. It also reports a second typical-task row for the compact workflow.
- fix(data-table): A data table that a filter-bar targets no longer renders its own search box, row count or "no match" note. The bar owns filtering, so two filters no longer fight over the same rows.
- fix(render): Blocks inside or after a `visibleWhen` wrapper keep the normal block gap and the section-break gaps.

## DESIGN notes (to fold into DESIGN.md)

- **`visibleWhen` spacing.** The wrapper stays `display:contents`, so the base `.ak-block + .ak-block` gap skips it.
  - `FEATURE_CSS.state` restores `--ak-gap` for a block inside a wrapper, and for a block after one, whenever a visible block or wrapper comes earlier. It also restores the 1.75× (titled block in a section) and 2.5× (top-level section) breaks.
  - The selectors use `:where()` for the sibling part, so their specificity stays at or below the base container resets. The new `:where(.ak-stack,.ak-grid,.ak-split) > .ak-when > .ak-block{margin-top:0}` reset keeps flex and grid gaps in charge.
  - The controls sheet keeps only `.ak-filter-controls>[data-ak-when]>.ak-block{margin-top:0}`. Its general workaround was removed.
- **Filter-bar and table search.** Decided at compile time: the table renderer checks the IR for a `filter-bar` whose `target` is the table's id.

## Measured numbers (compiler 0.2.0, this branch)

- **`agent-token-cost`, typical task.**
  - Full `describe <type> --json` row: 47.5k → 16.1k tokens (−66%). It was 12.7k (−73%) before 26 fixtures and the larger contracts.
  - Compact `describe <types...> --compact` row: 11.5k (−76%).
  - `README.md:246` quotes the old row. The controller updates it after merge.
- **`spec-compression`.** Across the six required fixtures, shared datasets save 6.8 kB of 39.6 kB written inline (17%). The catalog text is 7.2 kB.

## Deviations

- **`benchmarks/agent-token-cost.mjs` was edited, although it is not in the W2-B file list.** The brief asked for its artifacts to be refreshed, and that is impossible without the private legacy corpus and with the block-type crash in place.
  - New file `benchmarks/spec-block-types.mjs`, shared by both benchmarks.
- **`tests/unit/data-table.test.ts`** gained the unit test for the filter-bar decision. The brief asked for a unit test.
- **`tests/unit/fixtures.test.ts`** now also asserts zero warnings and a ×3 compile with the same hash for every fixture. This is controller gate 3; `render-determinism.test.ts` does not iterate fixtures.
- **Composition matrix interpretation.**
  - Script-off: native `<details>` is opened by clicking its summary before the text check. That works without scripts, and it is the only way nested accordion content renders.
  - Reduced motion: scroll-driven animations (the reading progress rail, `animation-timeline: scroll()`) are not counted, because they only track the scroll position.
  - Focus ring: a stop passes when its outline, shadow, border or fill (or that of one of three ancestors) differs between focused and at rest.

## Observed, not fixed (outside this package)

- A line chart thins its x labels on narrow canvases. In `complex-dashboard` at ≤375, and in a 4-span column at 1440, the last category label ("W39") is dropped. Chart owner.
