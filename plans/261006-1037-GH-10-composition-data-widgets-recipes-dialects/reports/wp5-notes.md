# Engineering widgets notes

Branch `gh10/wp5-engineering`. Files: `src/blocks/engineering/*`, `fixtures/pages/engineering-widgets.yaml`,
`tests/unit/engineering-widgets.test.ts`, `tests/browser/engineering-widgets.spec.ts`.

## Changelog lines

- feat(blocks): `kanban` groups cards into 2–8 columns. Cards come from `cards` or from dataset rows through `fields`, and each card carries the filter row contract.
- feat(blocks): `roadmap` places items on 2–24 ordered periods in up to 8 lanes. On phones and in print it becomes an agenda grouped by period.
- feat(blocks): `test-results` computes pass, fail, flaky and skip counts, total duration and optional coverage from its suites. Failing suites come first and open.
- feat(blocks): `log-viewer` shows up to 200 leveled lines from `lines` or a dataset. A log longer than 20 lines gets the core search, and every line carries the filter row contract, so a filter bar can narrow it by `level`.
- feat(blocks): `api-endpoint` shows a method badge, a path with highlighted `{param}` segments and a Copy button, a parameters table, a request body and status responses.
- feat(blocks): `schema-viewer` draws typed fields from dotted paths as a tree. Parents that are not listed become implicit object nodes.

## DESIGN notes (to fold into DESIGN.md)

### Engineering widgets

The renderers live in `src/blocks/engineering/` and the feature sheets in `engineering-styles.ts`. There is one
CSS-only feature per block (`kanban`, `roadmap`, `test-results`, `log-viewer`, `api-endpoint`, `schema-viewer`),
so a page ships only the sheets it uses.

| Block | Notes |
|---|---|
| `kanban` | Columns sit in one scroll strip, a grid with `minmax(232px,1fr)` columns: up to four fit 1100px, and more scroll. At ≤768px each column is 85% wide and snaps. The strip is a focusable, labelled `role="region"`, and it is a list of lists. Card status is a `toneBadge`. |
| `roadmap` | Periods form a grid. `data-ak-cols` sets `--ak-rm-cols`, and `data-ak-start`/`data-ak-end` map to grid columns through 24×2 attribute rules, so there is no inline style. Columns are at least 88px wide and the region scrolls sideways. Status is a tinted fill plus a dot and text, and planned items use a dashed border. At ≤560px and in print, an agenda grouped by start period replaces the grid. There is no "today" marker. |
| `test-results` | A tinted summary with a verdict glyph, an SVG bar of rect widths (decorative, `aria-hidden`), and counts in a `<dl>`. Suites are `<details>`, open when they hold failing or flaky cases. Print opens every suite through `::details-content`. |
| `log-viewer` | A monospace grid. Rows use `subgrid`, so time, level and source align across lines. When every timestamp shares one ISO date, lines show the clock and the head states the date once. Error and warn rows get a faint tone wash. At ≤560px the message wraps under the meta. The search box is hidden in print. |
| `api-endpoint` | Method tones: GET info, POST success, PUT and PATCH warning, DELETE danger, all tinted rather than solid. Bodies use the core `.ak-code` markup. Copy targets are `<node id>.path`, `.request` and `.response-<n>`; a dot cannot appear in a node id, so these never collide. |
| `schema-viewer` | Nested lists with a hairline guide. Branches are `<details open>` with the shared chevron, and leaves get a dot. Implicit parents show an italic muted `object`. |

The scroll strips (`.ak-kanban`, `.ak-roadmap`) are `position:relative`. Without it, an absolutely positioned
`.ak-sr` inside them resolves against the viewport and widens the page.

## Decisions and deviations

- **Kanban `status`.** The contract said `status?: tone`. Status is a short word (≤40 characters) rendered with `toneBadge`, as the rendering note says, so a known word such as `bug`, `new` or `good` gets a tone and every status is text.
- **Data binding.** `kanban` and `log-viewer` take `data: { required: false }`. A check requires exactly one source: the inline list or a binding. A binding that fails to resolve is reported once, at the binding, and is not reported again as missing items. `fields` maps each part to a dataset field. An unmapped part reads the field of the same name. Required parts (kanban `title`/`column`, log `level`/`message`) must exist. A bound row whose column is unknown is an error at `.data`/`.dataRef`. A bound level outside debug/info/warn/error is a warning.
- **Additions from the issue text.** These come from the issue's suggested shape for test-results and are not in the plan contract:
  - `test-results.coverage` (0–100, percent);
  - a per-case `file` reference.
- **Other additions.** These are optional and default to safe behavior:
  - a `language` on `api-endpoint` responses, defaulting to `json`;
  - `title` on kanban, roadmap, test-results, log-viewer and schema-viewer.
- **Roadmap lanes.** When lanes are declared, every item needs a valid `lane`. An item that sets `lane` without declared lanes is an error. Period labels and lane ids must be unique.
- **Api-endpoint warnings.** The block warns when a `{param}` in the path has no `in: path` parameter, and when an `in: path` parameter does not appear in the path.
- **Log-viewer runtime features.** `log-viewer` declares `['log-viewer', 'filter']` statically, because node runtime features come from the definition. So the core search CSS and runtime ship with every log-viewer, even one with 20 lines or fewer. The search box renders only past 20 lines.
- **Schema-viewer paths.** A path with an empty segment (`a..b`) is an error.

## Known test interactions (resolve at merge)

- `tests/unit/backward-compat.test.ts` fails for `engineering-widgets.yaml`, because the fixture uses `datasets`. Integration pins that test to the 11 fixtures that predate this release.
- `tests/unit/block-modules-registry.test.ts` ("accepts a valid group…") fails once a built-in group registers a feature module. This is fixed on integration (a96aca3).
- Full `describe <type> --json` is 2.1–3.7 kB for these blocks. The compact describe (≤1,500 bytes) is owned by the catalog package; it may need to trim prop descriptions if the budget test fails.
