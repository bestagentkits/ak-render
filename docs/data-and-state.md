# Data and state

A page that shows the same numbers in a chart, a table and a metric should
carry those numbers once. A page that lets a reader switch a view should do it
without a line of authored script. Datasets and state cover both, and both stay
data: there is no expression language, no query string and no event handler in
a spec.

Block props are owned by `ak-render describe <type> --compact`; this page
explains how the pieces fit and why they are bounded.

## Datasets

Declare flat tables once under the top-level `datasets`, then point blocks at
them with `dataRef`. A block that takes data may instead carry rows inline under
`data`, never both. `describe` marks every block that takes data, and whether
the binding is required.

```yaml
datasets:
  runs:
    - { model: alpha, provider: north, cost: 0.42, latency: 840, share: 87 }
    - { model: beta, provider: north, cost: 0.31, latency: 910, share: 64 }
    - { model: gamma, provider: south, cost: 0.55, latency: 620, share: 92 }
blocks:
  - type: data-table
    id: runs-table
    dataRef: runs
    columns:
      - { key: model, label: Model }
      - { key: cost, label: Cost, type: currency }
      - { key: latency, label: Latency, format: duration }
      - { key: share, label: Pass rate, type: percent }
```

- Cells are scalars only: a string, a finite number, a boolean or `null`.
  Nested objects and lists are rejected, so a dataset is always a table.
- Field names are identifiers that may contain dashes (`FIELD_KEY_PATTERN` in
  [`src/data/dataset-types.ts`](../src/data/dataset-types.ts)). `__proto__`, `constructor` and `prototype` are refused,
  because a row is a plain object and those names would reach its prototype
  instead of naming a cell.
- The number of datasets, rows, fields and string length is bounded
  (`DATA_LIMITS` in [`src/data/dataset-types.ts`](../src/data/dataset-types.ts)).
  A bound is an error at the dataset's path, not a silent truncation.
- A field a block names that the rows do not have is a `SPEC_VALIDATION_ERROR`
  at the path the author wrote, with `details.allowed` listing the fields that
  exist. This is the repair loop agents rely on.
- `dataRef` is the cheaper spec: the
  [spec compression artifact](./artifacts/spec-compression.md), produced by
  `pnpm bench:spec`, compares bound specs against the same data inlined.

## Transforms

`transform` reshapes a block's rows before it renders. It is a fixed pipeline,
not an expression: the stages always run in the order filter → groupBy → derive
→ sort → select → limit, whatever order the spec writes them in. A
`data-table` may add `rollup`, which totals the rows that remain.

```yaml
- type: chart
  kind: bar
  title: Mean cost by provider
  dataRef: runs
  transform:
    groupBy: { field: provider, aggregate: mean, value: cost }
    sort: { by: cost, direction: desc }
  x: { field: provider }
  y: { field: cost, format: currency }
```

The stage shapes and their bounds live in
[`src/data/transform-pipeline.ts`](../src/data/transform-pipeline.ts). A fixed
order keeps a transform readable and keeps every result reproducible: filters
are ANDed, sorting is stable with nulls last, and comparison never consults a
locale.

### Derived fields

`derive` adds up to eight numeric fields from a closed list of operations, in
the order written; a later one may read an earlier one, and `sort`, `select`
and `rollup` see them all. There is no expression language: an agent picks an
operation, never writes arithmetic.

| `op` | Result | `base` |
| --- | --- | --- |
| `ratio` | `field / base` | required |
| `percentOf` | `field / base × 100` | required |
| `delta` | `field − base`, or `field` minus the previous row's | optional |
| `percentChange` | `(field − base) / abs(base) × 100`, or against the previous row | optional |
| `share` | `field / column total × 100` | refused |
| `cumulative` | running sum of `field` | refused |

A missing or non-numeric operand, or a zero divisor, gives `null`, which
renders as an em dash; nothing is guessed. "Previous row" means the order the
earlier stages left (dataset order, or first-seen group order), not the order
after `sort`. A derived name must be a new field key: overwriting a field is an
error at `.as`.

```yaml
- type: data-table
  dataRef: monthly
  transform:
    derive:
      - { as: growth, op: percentChange, field: revenue }
      - { as: margin, op: percentOf, field: profit, base: revenue }
    rollup: { fields: [revenue, profit] }
  columns:
    - { key: month, label: Month }
    - { key: revenue, label: Revenue, type: currency }
    - { key: growth, label: Growth, type: percent, signed: true }
    - { key: margin, label: Margin, type: percent }
```

### Rollup

`rollup` totals the rows the pipeline leaves (after `limit`) into one row that
`data-table` renders as its footer, outside the sortable and filterable body:
`fields` (1–12 numeric fields) are summed, or averaged with `aggregate: mean`;
every other field is empty except `labelField` (default: the first field that
is not totalled), which reads `label` (default `Total`); when the table does
not show that field, the label moves to its first shown column that is not
totalled. A total that overflows
is `null`. Only `data-table` takes it: on a chart, a widget or a `kpi` cite it
is an error at `.rollup`, because a total among the data rows would be drawn,
counted and sorted as one more row. Use a `groupBy` aggregate there.

## KPI citations

A `kpi` item may name the dataset its number comes from:

```yaml
- type: kpi
  items:
    - label: Q3 revenue
      cite: { dataRef: monthly, field: revenue, aggregate: sum, format: currency }
    - label: September growth
      cite:
        dataRef: monthly
        field: growth
        transform: { derive: [{ as: growth, op: percentChange, field: revenue }] }
        format: percent
        signed: true
```

`cite` takes `dataRef`, `field`, an optional `transform` (the same pipeline),
`aggregate` (`last`, the default, `first`, `sum`, `mean`, `min`, `max` or
`count`) and the value-format fields. With `value` omitted, the compiler fills
it with the cited value formatted once, so the card, the chart and the table
cannot drift apart; a filled value longer than a card's 40 characters is an
error at `.cite`. With `value` written too, the compiler reads every number in
the written text (with a currency symbol, `k`/`M`/`B`/`T` or
`thousand`/`million`/`billion`, and for `duration` and `bytes` their units; a
suffix equal to the cite's `unit` is a label) and the text agrees when any of
them equals the cited value to the precision the author wrote: `$1.2M` and
`FY24 $1.2M` agree with 1,234,000, `$1.3M` does not. Spacing around a unit
does not matter. A disagreement
is a warning at `.value` whose `details` carry `rule: kpi-cite`, the `cited`
number, the `expected` text and the `authored` text. The page still compiles
with the authored value; the compiler never rewrites a number it was given.

## Value formats

Every data-bound block formats values through one function,
[`formatValue`](../src/data/format-value.ts), so a number reads the same in a
table cell, a chart axis and a metric. Columns and encodings take `format`,
`unit`, `currency` and `decimals`.

- `percent` takes the human number: `87` renders `87%`, not `0.87`. This
  matches how `progress` and `stats` already read percentages.
- `duration` takes milliseconds and `date` takes `YYYY-MM-DD`.
- Grouping uses a fixed comma, months use fixed English names, and nothing
  reads `Intl`, the host locale or the clock. That is what keeps a compiled
  page byte-identical across machines.
- `null` renders as an em dash.
- `signed: true` prefixes a positive value with `+` (`+12.5%`), for deltas and
  changes. A value that rounds to zero carries no sign.

## State

`state` is a flat map of initial values, declared once at the top of the spec.
Values are scalars. Keys are lowercase kebab case (`show-details`, not
`showDetails`), because state paths share one pattern with action paths
(`STATE_PATH_PATTERN` in [`src/registry/actions.ts`](../src/registry/actions.ts)).

```yaml
state:
  metric: cost
  show-details: false
```

State changes only through the trusted runtime: a control's `bind`, or a
`set-value` action. A `set-value` without its own `value` stores the value of
the event that fired it, such as the selected option, the slider position or
the selected tab's id.

## visibleWhen

Any block may carry `visibleWhen`: one state path and exactly one operator,
`equals`, `notEquals`, `in`, `notIn`, `truthy` or `falsy`.

```yaml
- type: kpi
  visibleWhen: { path: state.metric, equals: cost }
  items:
    - { label: Cost per run, value: $0.42 }
```

The compiler evaluates every condition against the initial `state` and emits
that view. With scripts off, in print and in a screenshot, the page shows the
initial view completely, never a blank or every alternative at once. The runtime
re-evaluates the same conditions after each state change; the compile-time and
runtime evaluators live in [`src/spec/conditions.ts`](../src/spec/conditions.ts)
and the runtime state part, and must agree. A path whose first key is not
declared in `state` is a warning.

## Controls

`select`, `radio-group`, `checkbox`, `switch`, `text-input`, `number-input` and
`date-input` are native inputs with a visible label. Each one either writes a
state key or, inside a `filter-bar`, filters rows; `search` is the older
free-text filter.

```yaml
- type: select
  label: Metric
  bind: state.metric
  options:
    - { value: cost, label: Cost per run }
    - { value: latency, label: Latency }
```

- `bind` must be `state.<key>` and the key must be declared in `state`. A bound
  state value wins over the control's own `value`.
- Each control fires `change` with its value, so
  `on: { change: { action: set-value, path: state.x } }` works without a
  `value`.
- Without scripts a control renders disabled at its initial value with a short
  note that it needs JavaScript, and print hides it. Information never lives
  only behind a control.

## filter-bar

`filter-bar` filters one block whose definition is filterable: `data-table`,
`kanban` or `log-viewer`. Its children are 1–8 controls; each names a row
`field` and a `match` operator. All criteria are ANDed, and an empty control
adds none.

```yaml
- type: filter-bar
  target: runs-table
  blocks:
    - type: select
      label: Provider
      field: provider
      optionsFrom: provider     # list the target's distinct values, plus "All"
    - type: number-input
      label: Max cost
      field: cost
      match: max
```

The filter-bar owns the filtering of its `data-table` target. A table that a
bar targets emits no search box, row count or "no match" note of its own, so
put free-text search in the bar as a `search` child. `target` must be a
filterable block's `id`; anything else is an error at
`.target` that lists the ids that qualify. The bar adds an announced result
count and a Reset button. Without scripts every row stays visible and the count
shows the total; print shows every row, because a filtered printout would be
silently partial.

The match operators per control and the runtime are in
[`src/blocks/controls/`](../src/blocks/controls/).

## Determinism

Datasets, transforms and conditions are resolved once, at normalize time, so
the HTML depends only on the spec, the theme and the compiler version. Nothing
reads the clock, a locale or a random source: a calendar never marks "today",
an aggregate is plain IEEE arithmetic rounded only when formatted, and group
order is first-seen order. The same spec compiles to the same bytes.
