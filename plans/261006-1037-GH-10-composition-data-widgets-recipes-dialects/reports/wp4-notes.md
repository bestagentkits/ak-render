# Chart v2 notes

Branch `gh10/wp4-chart-v2`.

## Changelog lines

- feat(chart): Nine new chart kinds: `scatter`, `histogram`, `stacked-bar`, `stacked-bar-100`, `heatmap`, `waterfall`, `funnel`, `gauge` and `treemap`.
- feat(chart): A chart can bind rows with `dataRef` or `data` and read them through the `x`, `y`, `series: { field }` and `value` encodings. Each encoding takes `label`, the shared value formats, and `min`/`max`.
- feat(chart): `markers` (up to 6) draw labelled vertical rules. `annotations` (up to 8) draw numbered callouts, which are also listed under the chart and in its summary. `sort` reorders bar, stacked-bar, funnel and treemap categories. `target` marks a gauge goal.
- feat(chart): A waterfall computes its total. A funnel states each stage's conversion from the first stage. A gauge reads its range from `value.min`/`value.max` (default 0–100).
- feat(chart): Bound charts build their fallback table from the bound rows, formatted like the axes.
- Unchanged: v1 `labels`/`series` charts render byte-identical markup. `labels` is now optional in the schema; the chart check still requires it for inline charts, with the same message and path as before.

## DESIGN notes (to fold into DESIGN.md, Charts)

- Charts that bind data, or use a later kind or an overlay, are labelled by their own `<title>` and `<desc>` through `aria-labelledby`. The original charts keep `aria-label`.
- Encoded cartesian charts reserve room for axis titles: the y title sits above the value ticks and the x title is centred under the categories, in mono uppercase. The frame is 800×300 with a 68px left margin.
- When the author sets bounds, value ticks follow `y.min`/`y.max`. Out-of-range marks are clamped to the plot edge, and the check warns about them. Whole-number currency ticks drop their cents.
- Stacked bars use flat series fills, not the bar gradient, so segments do not band. `stacked-bar-100` shows each segment's share and its raw value in the title.
- Histogram bins snap to a clean step (1, 2, 2.5 or 5 × 10ⁿ) whose bin count is closest to `bins` (default 10). Bins are [a, b), and the last bin is closed. X ticks sit on clean multiples, not on every edge.
- Waterfall colours carry meaning, so the legend always shows Increase (success), Decrease (danger) and Total (ink: text mixed into the surface). Dashed connectors join consecutive running totals.
- Heatmap intensity uses five quantized classes, `ak-chart-h0`…`h4`. They set `--ak-heat` (.16, .34, .52, .74, 1), which becomes the fill-opacity of the accent. There is no inline fill. Missing cells show the track colour. The legend lists the five ranges.
- Treemap: a squarified layout in category order (descending by default). Cells are tinted with their series colour (22% over the surface) and stroked with it. Label text uses the text tokens, so contrast does not depend on the hue. Cells smaller than 64×34 show no text; their values are in the title and the table. There is no legend, because colour only separates neighbours.
- Funnel: centred bars, with the stage label on the left and value · conversion on the right.
- Gauge: a 180° band on the track colour with the value arc in the accent. The target tick and label use the text colour. The big value uses `ak-chart-total`.
- Markers: a dashed muted rule with a mono uppercase label. Annotations: an accent dot holding its number in `accent-contrast`. The `ol.ak-chart-notes` list sits under the legend.
- Labels drawn over filled marks (stacked segments, heat cells) carry `ak-chart-value--halo`, a surface-coloured paint-order stroke.
- New kinds that draw on a wide plot (scatter, histogram, stacked bars, waterfall, heatmap, funnel, treemap) keep the 560px canvas minimum and scroll sideways on a phone.

## Contract changes

- `CHART_KINDS` has 16 entries. `ChartKind`, `V1_CHART_KINDS`, `CARTESIAN_KINDS`, `NUMERIC_X_KINDS`, `SINGLE_SERIES_KINDS`, `SORTABLE_KINDS`, `DATA_ONLY_KINDS` and `MAX_TREEMAP_CELLS` are exported from `src/blocks/chart/chart-kinds.ts`.
- Chart definition:
  - `data: { required: false }`;
  - `labels` is optional in the schema;
  - `series` is `oneOf` (the v1 list, or `{ field }`);
  - new props: `x`, `y`, `value`, `bins`, `markers`, `annotations`, `sort`, `target`.
- `ChartInput.encoded` is optional. When it is absent, the original renderer runs unchanged. The chart types live in `src/render/chart-types.ts`, and `charts.ts` re-exports `ChartInput` and `ChartSeries`.
- `checkSeriesLengths` keeps its signature (frozen `normalize.ts` imports it for `progress`). It now skips when `labels` is empty, because `labels` defaults to `[]`.
- The shared primitives moved from `charts.ts` to `src/render/chart-scales.ts` and `src/render/chart-svg-parts.ts` with identical output.

## Check rules (paths)

- With data bound:
  - `labels` and an inline `series` are errors at their own paths.
  - Each kind's required encodings need `field`, reported at `<enc>.field` with `details.allowed`:
    - scatter: numeric x and y;
    - heatmap: x, y and numeric value;
    - histogram: numeric x;
    - gauge: value or y;
    - other kinds: x plus the magnitude.
  - An unknown field uses `reportUnknownField`.
  - A non-numeric magnitude is an error naming the row.
- Without data:
  - `<enc>.field` and `series.field` are errors.
  - scatter and heatmap report an error at `dataRef`.
  - A missing `labels` or `series` keeps the old "required value is missing" message.
- Kind rules:
  - Gauge: exactly one value inside min–max is an error otherwise. A target outside the range is a warning.
  - Funnel: a rising stage is a warning.
  - Treemap: more than 40 cells is `SPEC_BOUNDS_ERROR`. Negative values are an error.
  - `stacked-bar-100`: negative values are an error.
  - `y.max <= y.min` is an error.
  - Values clipped by y bounds are a warning.
  - A pivot that repeats or misses an (x, series) pair is a warning (values are summed, or drawn as 0).
  - An overlay x that is not on the axis is a warning with `details.allowed`.
  - Misplaced `bins`, `target`, `sort`, `markers` or `annotations` is a warning.

## Deviations

- The rejected fixture is at `fixtures/rejected/validation/chart-unknown-encoding-field.yaml`, per the controller. The injection loop reads only top-level files, so it ignores the subfolder. The code and path are asserted in `tests/unit/chart-v2.test.ts`.
- The issue example writes `format: ms` and `format: usd`. The fixture uses the shared formats `duration` and `currency` (with `currency: USD`).
- The single-series kinds accept either `value` or `y` as the magnitude, to be lenient with authors. Heatmap requires `value`.
- Default `sort` for a treemap is descending, because the layout reads best that way. `sort: none` keeps the authored order.
- CHART_CSS gained new rules, so any page with a chart has a longer stylesheet. Only the chart markup of v1 charts is byte-identical. The figure check compares against the committed gallery.
- Expected failure until merge: `tests/unit/backward-compat.test.ts` fails on the new `charts-v2.yaml` (it declares `datasets`). This is fixed on integration.
- `describe chart --json` is about 9.2 kB, because `x`, `y` and `value` each spell out the format and currency enums. Text describe is 632 bytes. WP10's compact mode should collapse the repeated encoding schema to stay within 1,500 bytes.
