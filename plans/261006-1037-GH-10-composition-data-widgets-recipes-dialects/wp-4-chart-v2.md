# WP4 — Chart v2: data encodings, new kinds, markers, annotations

Issue phase 4. Depends on W0. Branch `gh10/wp4-chart`. Estimate 9h.

## Goal

Charts can bind to datasets with `x`, `y`, `series` and `value` encodings. Nine new kinds ship. Every chart keeps
its accessible table fallback and its text summary, and existing v1 charts render byte-identically.

## Context (verified)

- `src/render/charts.ts` (500 lines):
  - `ChartInput {kind,id,labels,series,title,description}` at `:25`
  - frames at `:61-63`; `barChart` `:186`, `lineChart` `:240`, `radialChart` `:317`, `progressChart` `:381`
  - `legend` `:413`, `dataTable` `:426`, `textSummary` `:441`, `chartBody` `:452`, `renderChart` `:474`
- `CHART_KINDS` = bar, line, area, pie, donut, sparkline, progress. After W0 it lives in
  `src/blocks/chart/chart-kinds.ts` and `roster.ts` re-exports it.
- Class names used by the CSS must stay:
  - `ak-chart-area`, `-axis`, `-bar`, `-canvas`, `-grid`, `-label`, `-label--row`, `-legend`, `-line`, `-point`
  - `-stop(--bar/--end)`, `-swatch`, `-table`, `-total`, `-track`, `-value`, `ak-chart-s<N>`
- The v1 series-length check moved into `src/blocks/chart/chart.ts` `check()` during W0.

## Files

| Ownership | File |
| --- | --- |
| exclusive | `src/render/charts.ts` (split if >200 lines added: `src/render/chart-kinds-cartesian.ts`, `chart-kinds-composite.ts`, `chart-scales.ts`), `src/blocks/chart/*` |
| exclusive (edit) | `tests/unit/catalog-coverage.test.ts` (the CHART_KINDS assertion only), existing chart unit tests (`tests/unit/*chart*.test.ts`) |
| create | `tests/unit/chart-v2.test.ts`, `fixtures/pages/charts-v2.yaml`, `fixtures/rejected/chart-unknown-encoding-field.yaml` |
| notes | `reports/wp4-notes.md` |

## Contracts

```yaml
- type: chart
  kind: stacked-bar     # + scatter|histogram|stacked-bar|stacked-bar-100|heatmap|waterfall|funnel|gauge|treemap
  dataRef: usage        # definition.data.required = false (v1 labels/series still valid)
  transform: { groupBy: ... }
  x: { field: month, label: Month }                  # category or numeric (scatter, histogram)
  y: { field: tokens, label: Tokens, format: compact, min: 0, max: 100 }   # FORMAT_FIELDS
  series: { field: model }        # oneOf: v1 list [{label, values}] | { field } (pivot by field)
  value: { field: score }         # heatmap/treemap/gauge/funnel magnitude
  bins: 10                        # histogram only, 2..30
  markers: [{ x: Mar, label: Launch }]          # ≤6, vertical rule + label on cartesian kinds
  annotations: [{ x: Mar, y: 420, text: Peak }] # ≤8, numbered callouts + listed under chart
  sort: none                      # none|ascending|descending (bar, funnel, treemap)
  target: 90                      # gauge target, optional
```

Rules:

- With data bound, `labels` and `series` are derived: x values in first-seen order, and either one series per
  distinct `series.field` value or one series named after `y.label`. Mixing `dataRef` with inline
  `labels`/`series` is an error.
- `oneOf` on `series` relies on W0's shape discrimination (array means v1, object means encoding), so the
  diagnostics stay precise.
- Kind requirements are enforced in `check()` with paths:
  - scatter needs numeric x and y;
  - heatmap needs x, y and value;
  - gauge needs exactly one value in 0–max;
  - waterfall values may be negative, and the total is computed;
  - funnel is monotonic or warns;
  - treemap needs ≤40 cells.
- Treemap uses a deterministic squarified layout with fixed precision via `round()`.
- Every kind renders `<figure>`, SVG with `role="img"` and an `aria-labelledby` title and desc, the legend
  (compiler-placed), the fallback `<table class="ak-chart-table">` built from the materialized rows, and
  `textSummary`.
- Colour comes only from the series classes and tokens. Heatmap intensity uses 5 quantized classes
  (`ak-chart-h0..h4`) with opacity steps in CSS, never inline fill.

## Steps

1. Extend `ChartInput` with an optional `encoded?: {x,y,value,rows,bins,markers,annotations,sort,target}`.
   v1 code paths are untouched when it is absent, which guarantees byte-identical output.
2. Add the scales module: linear (shared with `niceBounds`) and band.
3. Implement the kinds in order of reuse: stacked-bar / stacked-bar-100 (from barChart), histogram (bin then
   bar), waterfall, funnel, scatter, heatmap, gauge (from radial), and treemap.
4. Add markers and annotations to the cartesian kinds. Annotations also go in the summary list, because motion
   and colour never carry the information alone.
5. Write the definition updates in `src/blocks/chart/chart.ts`, then `check()` and the CSS additions in
   `chart-styles.ts` (new classes only).
6. Write the fixture `charts-v2.yaml` with every new kind, a dataset-bound line chart using `series.field`, and a
   v1 chart.

## Tests

- **Unit.**
  - Every kind renders a figure, the table fallback and the summary.
  - A golden SVG `d` attribute for one stacked-bar and one treemap.
  - An unknown encoding field gives a path and the allowed fields.
  - v1 charts in existing fixtures are byte-identical.
  - The histogram bin edges are deterministic.
  - `CHART_KINDS` has 16 entries (update `catalog-coverage.test.ts`).
- **Browser.** No overflow at 320 for every kind. The legend wraps.

## Acceptance

- [ ] The issue's chart examples (dataset-bound stacked bar, scatter, heatmap) compile with zero warnings.
- [ ] No inline `style`, and no `fill=` colour literals outside `currentColor`/`url(#gradient)` that already exist.
- [ ] The chart describe JSON stays ≤ 1,500 bytes in compact mode (WP10 measures it).

## Risks

| Risk | Mitigation |
| --- | --- |
| Floating-point drift in layout | All coordinates go through `round()`, and golden tests catch drift |
| charts.ts grows past 1,000 lines | Split per the files table |
| Describe bloat for chart | Keep descriptions terse; WP10's budget test |

Rollback: revert and regenerate. Fixtures in W2 using v2 kinds would need replacing.
