# WP3 — data-table

Issue phases 3–4 (the table half of data binding). Depends on W0. Branch `gh10/wp3-data-table`. Estimate 7h.

## Goal

A typed, sortable, searchable and filterable table bound to a dataset. It reads as a real `<table>` with JS off
and in print, and as cards on small screens.

## Files

| Ownership | File |
| --- | --- |
| exclusive | `src/blocks/data-table/*` (`data-table.ts`, `data-table-cells.ts`, `data-table-styles.ts`, `data-table-runtime.ts`, `index.ts`) |
| create | `tests/unit/data-table.test.ts`, `fixtures/pages/data-tables.yaml`, `fixtures/rejected/data-table-unknown-field.yaml` |
| notes | `reports/wp3-notes.md` |

Do not touch the existing `table` block. It stays the small, static table.

## Contracts

```yaml
- type: data-table
  title: Benchmark runs              # optional
  dataRef: runs                      # or data: [rows]; definition.data.required = true
  transform: { sort: { by: p95, direction: asc }, limit: 50 }
  columns:                           # 1..12; omitted → derived from data.fields (first 8), type text
    - key: model                     # must be a data field (W0 reportUnknownField)
      label: Model                   # default: key
      type: text                     # text|number|percent|currency|date|badge|link|progress|sparkline
      format: compact                # FORMAT_FIELDS from src/data/format-value.ts (number-ish types)
      align: start                   # start|end|center; default end for numeric types
      hrefField: url                 # link: field holding a URL (validated as url; remote needs nothing—links are not fetched)
      max: 100                       # progress: scale max (default 100)
      fields: [w1, w2, w3, w4]       # sparkline: 2..24 numeric fields, rendered via sparkPaths()
      tones: { pass: success, fail: danger }   # badge: value→tone map (VALUE_TONES), ≤12
  caption: optional                  # visually hidden when title present
  filterable: true (definition flag) # rows carry filterRowAttributes(row)
```

Compiler-owned behaviors (no knobs):

- Sorting is always available on every column through `<button>` in `<th aria-sort>`.
- Search appears when there are more than 10 rows.
- The header is sticky when there are more than 12 rows.
- At ≤560px the table reflows to labelled cards using `td::before{content:attr(data-label)}`.
- With JS off, rows keep the authored and transformed order. Search and sort controls are hidden until
  `data-ak-table-ready` is set.

Sort runtime: compare `data-sort` raw values (numbers numeric, otherwise code-unit), stable. Announce
"Sorted by X, ascending" via the live region (`announces: true`).

## Steps

1. Write the definition with `category: 'data'`, tags `[table, dataset, sort, filter, metrics]` and a summary of
   at most 110 characters.
2. In `check()`, every column `key`, `hrefField` and sparkline field must exist in `node.data.fields`
   (`reportUnknownField`). A link `hrefField` value is validated per row as a safe URL; invalid rows render text
   and add a warning.
3. Write the cell renderers per type using `formatValue`. `progress` is a native `<meter>` plus the value text.
   A sparkline is an inline SVG through the exported `sparkPaths` (`src/render/showcase-blocks.ts:320`; import it,
   do not edit the file). A badge uses `toneBadge` from `src/render/tone.ts`.
4. Write the runtime `wireDataTables()` (ES5): sort buttons, search input filtering `[data-ak-filter-item]` by
   text, the row count, and the empty state.
5. Write the CSS (feature `data-table`, marker `.ak-data-table`): token-driven, tabular numbers, the sticky
   header, the card reflow, and print that hides the controls.
6. Write the fixture `data-tables.yaml`: a dataset of 24 rows that exercises every column type, plus a second
   small inline `data` table with derived columns.

## Tests

- **Unit.**
  - Every column type renders.
  - An unknown column key gives a diagnostic at `$.blocks[n].columns[i].key` with the allowed fields.
  - transform plus dataRef produces the expected order.
  - The search control is absent at 10 rows and present at 11.
  - `th scope` and `aria-sort` are present (verify.ts already checks `th scope`).
  - Deterministic output ×3.
  - A row value of `"<script>"` is escaped.
- **Browser** (local, then W2-B). Click-sort toggles `aria-sort`. Keyboard Enter on a header works. Search
  narrows rows and the live region updates. At 375 the card reflow has no overflow.

## Acceptance

- [ ] The issue's data-table example compiles with zero warnings.
- [ ] Script-off shows the complete table.
- [ ] Print hides the controls and shows all rows.
- [ ] `filterable: true` rows follow the W0 row contract exactly (WP8 depends on it).

## Risks

| Risk | Mitigation |
| --- | --- |
| `data-ak-row` duplicates bytes for 200 rows | Accepted. Measured in the W2-B benchmark |
| Sorting dates as strings | Use raw ISO strings, which sort correctly by code unit |
| Sticky header plus card reflow conflict | Sticky applies only at >560px |

Rollback: revert and regenerate. WP8's filter-bar accepts any `filterable` block, so it keeps working against
the other filterable blocks. Its fixture would need its target changed.
