# Data table notes

Branch `gh10/wp3-data-table`. The code is in `src/blocks/data-table/`. The tests are `tests/unit/data-table.test.ts` and `tests/browser/data-table.spec.ts`.

## Changelog lines

- feat(blocks): New `data-table` block, a typed table bound to `dataRef` or inline `data`, with an optional `transform`.
  - Column types: `text`, `number`, `percent`, `currency`, `date`, `badge`, `link`, `progress` and `sparkline`. `percentage` is accepted as an alias of `percent`.
  - Every value is formatted through the shared value formatter.
  - Every column sorts. Search appears past 10 rows. The header sticks past 12 rows. On phones the rows become labelled cards.
  - Without scripts or in print the full table reads in its authored order, and the controls are hidden.
- feat(blocks): Unknown column keys, `hrefField` values and sparkline fields are reported at the column's path, with the fields that exist. A link value that is not a safe URL renders as plain text and raises a warning.

## DESIGN notes (to fold into DESIGN.md)

### Data table

The table reuses the base table frame (`.ak-table-wrap`, edge shades, `.ak-num`). Its feature sheet is `data-table`, marker `.ak-data-table`.

- **Columns.** The column `type` picks the value format and the alignment. Numeric types (number, percent, currency, progress, sparkline) align to the end. Typed cells and row headers do not wrap.
  - When no columns are authored, the first 8 data fields are shown. A field whose values are all numbers becomes a `number` column.
  - The first column is the row header (`<th scope="row">`), which is also the card title on phones.
- **Cells.**
  - A badge takes its tone from the authored `tones` map first, then from a built-in outcome map (`pass`/`passed`/`ok` success; `fail`/`failed`/`error` danger; `flaky` warning; `skipped` neutral), then from the shared `VALUE_TONES`.
  - Progress is a native `<meter>` (accent gradient, `aria-hidden`) beside the value text.
  - A sparkline is the KPI `sparkPaths` geometry drawn as an accent line over a 14% tint, plus a visually hidden list of its values.
- **Sorting.** The runtime turns each header into a `<button>`, so a page without scripts never shows a dead control.
  - Sorting compares the raw `data-sort` values: numeric when every value in the column is a number, otherwise by code unit. Ties keep their order, and empty cells sort last in both directions.
  - The sorted column has `aria-sort` and an accent arrow. Every change is announced, for example "Sorted by Saving, ascending".
  - The compiler marks a column as already sorted when the emitted rows run in one direction on it (at least 3 rows, no empty cell). The transform itself never reaches the IR, so this is read from the rows and is always true of them.
- **Search.** The search field appears past 10 rows, together with a row count. A row that does not match gets `data-ak-dt-miss`, not `hidden`.
  - A filter that toggles `hidden` on the same rows therefore composes with search.
  - The count and the live region read "N of M rows". An empty result shows a dashed "No rows match the search." note.
- **Sticky header.** A header sticks only above 560px and only on tables with more than 12 rows. It sticks to the page only when the table fits its frame: the runtime then switches the frame to `overflow:clip`, which is not a scroll container.
  - A table wider than the column keeps its sideways scroller, so its header does not stick.
- **Phones (≤560px).** Each row becomes a card.
  - Cells are flex rows labelled by `td::before{content:attr(data-label)}`.
  - Once the runtime is ready, the header becomes a wrapping row of 44px sort chips. Without scripts it is visually hidden.
- **Print.** The search bar, the empty note and the sort arrows are hidden, every row is shown (including search misses), the header is not sticky and rows do not break.

## Contract notes for other packages

- **Filter bar.** Rows carry `filterRowAttributes(row)` exactly: `data-ak-filter-item` plus the `data-ak-row` JSON of the materialized row.
  - Table search does not use `hidden`, so a filter bar may set `hidden` on these rows freely.
  - The table's row count updates only on its own search.
- **Runtime globals.** The table runtime defines `wireDataTables`, `sortDataTable`, `searchDataTable`, `fitDataTables`, `dtRows`, `dtHeads` and `DT_NUMBER`.
- **Validation fixture.** It lives at `fixtures/rejected/validation/data-table-unknown-field.yaml`, as the controller asked. `tests/unit/data-table.test.ts` asserts that it fails with `SPEC_VALIDATION_ERROR` at `$.blocks[0].columns[1].key`.

## Deviations from the plan

- **Alias.** `percentage` is accepted as an alias of `percent`, so the issue's example compiles with zero warnings.
- **Caption.** It is visually hidden only when it is missing or repeats the title. A caption that adds information beyond the title stays visible.
- **Derived columns.** They are typed `number` when every value is numeric, rather than always `text`.
- **Badge tones.** Badges gained the outcome-tone fallback described above.
  - Suggestion: fold `OUTCOME_TONES` into `src/render/tone.ts` later. That file was not in this package's ownership.
- **Warnings.** A type-only column prop on the wrong type is a warning, for example `tones` on a text column.
- **Progress `max`.** A `max` of 0 is an error.
