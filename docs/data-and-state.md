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
- The number of datasets, rows, fields and string length is bounded
  (`DATA_LIMITS` in [`src/data/dataset-types.ts`](../src/data/dataset-types.ts)).
  A bound is an error at the dataset's path, not a silent truncation.
- A field a block names that the rows do not have is a `SPEC_VALIDATION_ERROR`
  at the path the author wrote, with `details.allowed` listing the fields that
  exist. This is the repair loop agents rely on.
- `dataRef` is the cheaper spec: the benchmark artifact
  `docs/artifacts/spec-compression.md` compares bound specs against the same
  data inlined.

## Transforms

`transform` reshapes a block's rows before it renders. It is a fixed pipeline,
not an expression: the stages always run in the order filter → groupBy → sort →
select → limit, whatever order the spec writes them in.

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

The filter-bar owns the filtering of its `data-table` target: put free-text
search in the bar as a `search` child rather than relying on the table's own
search. `target` must be a filterable block's `id`; anything else is an error at
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
