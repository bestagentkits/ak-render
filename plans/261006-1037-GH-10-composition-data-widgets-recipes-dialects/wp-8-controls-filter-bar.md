# WP8 — Input controls and filter-bar

Issue phases 3 (state) and 6 (controls). Depends on W0. Branch `gh10/wp8-controls`. Estimate 7h.

## Goal

Native, accessible controls that write safe state. A `filter-bar` filters any `filterable` block (data-table,
kanban, log-viewer) through the W0 row contract. Combined with `visibleWhen`, this gives mini-app behavior with
no open-ended logic.

## Context (after W0)

- State: `state` envelope with scalar values (`normalize.ts:273`).
- Runtime helpers: `setPath` and `syncBindings` (`runtime.ts:44`, `:64`), plus W0's `syncConditions`.
- `set-value` without `value` uses `detail.value`.
- `fire()` stops at the nearest `[data-ak-id]`.
- Filterable rows carry `data-ak-filter-item` and `data-ak-row='{json}'`.
- The definition flag `filterable: true` marks the target types.
- The existing `search` block (`roster.ts:1024` pre-W0) and the core `filter` runtime (`runtime.ts:526`) stay
  as they are. filter-bar accepts `search` as a child.

## Files

| Ownership | File |
| --- | --- |
| exclusive | `src/blocks/controls/*`: one file per control, `filter-bar.ts`, `controls-styles.ts`, `controls-runtime.ts`, `index.ts` |
| create | `tests/unit/controls.test.ts`, `tests/browser/controls.spec.ts`, `fixtures/pages/controls.yaml`, `fixtures/rejected/filter-bar-bad-target.yaml` |
| notes | `reports/wp8-notes.md` |

## Contracts (category `interaction`)

```yaml
# shared control props
label: Model            # required (visible <label>)
bind: state.model       # optional; isSafeStatePath; first key must be declared in `state` (error if not)
value: all              # initial; must match state value when both set (warning, state wins)
field: model            # only inside filter-bar: row field to filter
match: equals           # equals|contains|min|max (inside filter-bar; defaults by control type)
hint?: text
- type: select          # options: [{ value, label? }] 1..50   (or optionsFrom: field → distinct row values of target, sorted, ≤50)
- type: radio-group     # options as above, ≤8
- type: checkbox        # boolean; inside filter-bar: match truthy on field
- type: switch          # role="switch" checkbox
- type: text-input      # maxLength ≤200, placeholder?; match contains (case-insensitive ASCII fold)
- type: number-input    # min?, max?, step?; match min|max
- type: date-input      # ISO date; match min|max (string compare on ISO)
- type: filter-bar
  target: runs-table    # id of a block whose definition.filterable === true (check(), path, details.allowed = filterable ids)
  blocks: [select, checkbox, radio-group, switch, text-input, number-input, date-input, search]   # accepts exactly these, 1..8
  # compiler adds: live result count ("12 of 40 rows", aria-live polite), Reset button (type=button)
```

Runtime (`controls-runtime.ts`, ES5, feature `controls` plus `filter-bar`):

- On `input`/`change`, coerce the value (number for number-input, boolean for checkbox/switch). With `bind`,
  call `setPath`, which then triggers `syncBindings` and `syncConditions`. Fire `change` with `detail.value`,
  so `on: { change: [...] }` action maps work.
- filter-bar: collect the active criteria from its children, then for each `[data-ak-filter-item]` inside the
  target, `JSON.parse(data-ak-row)` once and cache the result. AND all criteria, toggle `hidden`, and update the
  count. Reset restores the initial values and shows everything.
- No `eval` and no dynamic selectors from spec strings. The target is resolved via
  `document.getElementById(<compiled id>)`.

No-JS behavior:

- Controls render disabled with the initial value and a `data-ak-requires-js` note, styled as a muted hint. This
  avoids implying that they work. The full dataset stays visible.
- Print hides the controls and the bar.

Native inputs get 44px minimum targets, visible focus through tokens, and `<fieldset><legend>` for radio-group.

## Steps

1. Write the shared prop fragment and the definitions. `check()`:
   - `bind` key declared;
   - options unique;
   - number min ≤ max;
   - `field` exists in the target's `node.data.fields` when the target has data (use `context.byId`);
   - controls with `field` outside a filter-bar get a warning.
2. Write the renderers. Each control is `<div class="ak-control"><label for>…<input|select …></div>`, and IDs
   are derived from the node ID.
3. Write the runtime and the CSS.
4. Write the fixture `controls.yaml`:
   - a state `{metric: cost, showDetails: false}`;
   - a select bound to `state.metric` with two `visibleWhen` sections;
   - a switch that toggles a details callout;
   - a filter-bar over an inline-data `data-table`.

   `data-table` comes from WP3, which merges before WP8. Develop against a test-only filterable module in the
   unit tests. Add `fixtures/pages/controls.yaml` and the browser spec last, after rebasing onto the branch with
   WP3 merged. If WP3 is late, report `DONE_WITH_CONCERNS` with the fixture uncommitted.

## Tests

- **Unit.**
  - An undeclared `bind` is rejected with its path.
  - A filter-bar target that is unknown or not filterable is rejected with `details.allowed`.
  - The `accepts` violation (a chart inside a filter-bar).
  - Rendered labels are associated with their inputs.
  - Deterministic output.
- **Browser (`controls.spec.ts`).**
  - The select changes the state and swaps the `visibleWhen` sections.
  - Filter by select plus number min narrows the rows and the count text.
  - Reset restores.
  - Keyboard-only operation works.
  - Script-off shows all rows and the initial section.
  - axe reports no critical issue.

## Acceptance

- [ ] The issue's "metric switcher" and "filter a table" examples work with zero warnings.
- [ ] No action or behavior can be expressed beyond the enumerated match operators.
- [ ] The `verify.ts` script/feature check passes, since `controls` and `filter-bar` are scripted features.

## Risks

| Risk | Mitigation |
| --- | --- |
| WP3 merge-order coupling | Recommended merge order puts WP3 before WP8; unit tests use a test-only filterable module |
| A large `data-ak-row` parse cost | At most 200 rows, parsed once, then cached |
| State drift between control and binding | Single `setPath` path; browser test |

Rollback: revert and regenerate. The interactive-data-explorer fixture depends on this WP.
