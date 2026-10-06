# Controls and filter-bar notes

Branch `gh10/wp8-controls`.

## Changelog lines

- feat(blocks): Native input controls `select`, `radio-group`, `checkbox`, `switch`, `text-input`, `number-input` and `date-input`. Each has a visible label, writes one scalar to `state.<key>` through `bind`, and fires `change` with `{ value }`, so `on: { change: { action: set-value, path: state.x } }` works without a `value`.
- feat(blocks): `filter-bar` filters any filterable block (data-table, kanban, log-viewer) with 1-8 controls. Each control names a row `field` and one enumerated `match`. The compiler adds a result count, announced politely, and a Reset button.
- feat(blocks): Inside a filter-bar, `select` and `radio-group` can take `optionsFrom: <field>` to list the target's distinct values, and they get an "All" choice.

## DESIGN notes (to fold into DESIGN.md)

### Controls

- A control is `<div class="ak-control">`, or a `<fieldset>` with a `<legend>` for a radio group. It holds a visible `<label for>`, the native input, an optional hint (`aria-describedby`) and the no-script note.
- Fields use the surface, border and radius-medium tokens, focus uses `--ak-ring`, and a switch is a restyled native checkbox (`role="switch"`) drawn from the accent.
- Targets are 40px, and 44px at ≤768px. The `.ak-choice` row (input plus label) is the target for checkbox, switch and radio.
- Without scripts, inputs render `disabled` with the initial value, and a muted note says they need JavaScript. A standalone control carries its own note; a filter-bar carries one note for all its controls.
- Print hides every control and the filter bar.
- The `visibleWhen` wrapper (`display:contents`) breaks the base `.ak-block + .ak-block` gap. The controls sheet restores the gap for conditional views that follow a control, using `[data-ak-when]` (never `.ak-when`, which is the `state` feature marker).

### Filter bar

- A card (`--ak-fill`, radius-large, elevation-card) with an optional h3 title, a responsive grid of controls (`auto-fill`, 190px minimum), and a footer with the mono count and Reset.
- Without scripts, the count shows the total ("40 rows") and Reset is hidden. All rows stay visible.
- Print shows every row: the runtime unhides the rows on `beforeprint` and re-applies the filter on `afterprint`, because the bar is hidden in print and a filtered printout would be silently partial.
- The count noun is "rows" for a `data-table` target and "items" otherwise.

## Contracts

### Shared control props

`label` (required), `bind`, `value`, `field`, `match` (text, number and date only), `hint`, `on`, `id`.

- `bind` must be exactly `state.<key>`, with a lowercase kebab key, and the key must be declared in `state`. A malformed path is `POLICY_VIOLATION`; an undeclared key is `SPEC_VALIDATION_ERROR` with `details.known`.
- A bound, non-null state value wins over `value`. A differing `value` is a warning, and so is a state value of the wrong type.
- `field` and `match` outside a filter-bar are warnings. Inside a bar, `field` is required and checked against the target's `data.fields` (`details.allowed`).

### Match operators

| Control | Operators (first is the default) | Rule |
| --- | --- | --- |
| select, radio-group | equals | `String(row[field]) === value`; the empty "All" choice adds no criterion |
| checkbox, switch | (truthy, fixed) | checked → `row[field]` is truthy; unchecked adds no criterion |
| text-input | contains, equals | contains is case-insensitive with an ASCII-only fold |
| number-input | min, max, equals | numeric; an empty field adds no criterion |
| date-input | min, max, equals | compares the first 10 characters of the row value as an ISO string |
| search (core) | text | the row's text content, lower-cased, as the core filter does |

All criteria are ANDed.

### Per-control limits

- select: at most 50 options. radio-group: at most 8.
- Option values are unique and non-empty, because the empty value is the filter-bar's "All".
- text-input: `maxLength` at most 200 and `placeholder` at most 120 characters. number-input: `min ≤ max`, and `value` within them. date-input: `value` is a real `YYYY-MM-DD` date.

### filter-bar

- `target` (required) must be the id of a block whose definition has `filterable: true`. Otherwise the error is at `.target`, with `details.allowed` listing the filterable ids.
- Children use `blocks:` (`slots.children`). It accepts exactly the 7 controls plus `search`, 1-8 of them.
- A `search` child may omit its `on` binding. If it has one, its target must be the bar's target.

## Contract changes

- **`CheckContext.registry`** (controller-approved frozen-file change). `src/registry/block-module.ts` gains `registry: BlockRegistry` in `CheckContext`, and `src/spec/normalize.ts` passes `registry` to `postChecks`. One line each. It is needed because a filter-bar check must read the target's `definition.filterable`, which the IR does not carry.
- New feature modules: `controls` (marker `.ak-control{`) and `filter-bar` (marker `.ak-filter-bar{`, `announces: true`). `filter-bar` blocks declare both features, and `controls` must stay registered first because the filter-bar runtime reuses its readers.

## Deviations from the work package

- **Count announcement.** The count element is not itself `aria-live`. It is announced through the shared live region (`announce()`), so a `search` child does not produce two announcements: the core search announces its own count first, and the bar replaces it with the combined count.
- **Target lookup.** The runtime resolves the target with the core `byId()` (`[data-ak-id="<compiled id>"]`) instead of `getElementById`, because blocks emit `data-ak-id`, not `id`. The id is compiled and pattern-validated, so no spec string becomes a selector.
- **State sync.** A bound control has `data-ak-bind` with `data-ak-bind-target="state"` on its wrapper. One `MutationObserver` on `data-ak-state` re-syncs the native input whenever any action writes the key. This keeps the core `syncBindings` unchanged, which would otherwise overwrite a radio's or checkbox's `value` attribute. A field that has focus is never rewritten, so the caret does not jump.
- **Fixture state key.** The fixture uses `show-details` instead of the plan's `showDetails`, because state paths are lowercase kebab (`STATE_PATH_PATTERN`).
- **Rejected fixture.** It lives at `fixtures/rejected/validation/filter-bar-bad-target.yaml`, as the controller directed, and is asserted in `tests/unit/controls.test.ts`.
- **Test support.** There is a new test-only support file, `tests/unit/support/probe-filterable-group.ts`, holding a filterable `probe-rows` block. The browser spec uses it until data-table lands.

## Deferred to wave 2

- **Combined fixture.** The fixture combining filter-bar with `data-table` (the plan's `controls.yaml` filter section, and `interactive-data-explorer`) waits for WP3. `fixtures/pages/controls.yaml` covers the metric switcher, the switch with its details callout, and every control type bound to state. The filter-bar browser checks run against the test-only filterable block.
- **data-table search.** WP3's own search also toggles `hidden` on the same rows. When both are used, the last writer wins. Wave 2 should either hide the table's search when a filter-bar targets the table, or make both share one criteria pass.
- **axe.** The axe check is not added, since it is a wave 2 devDependency. The browser spec asserts accessible names, the radio group as a named group, the bar as a named region, a visible focus ring, and 44px targets at 375.
