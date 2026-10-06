# WP5 — Engineering widgets: kanban, roadmap, test-results, log-viewer, api-endpoint, schema-viewer

Issue phase 5 (P1). Depends on W0. Branch `gh10/wp5-engineering`. Estimate 9h.

## Goal

Six semantic engineering widgets. Each one is complete without JS. Where it filters, it uses the shared filter
row contract.

## Files

| Ownership | File |
| --- | --- |
| exclusive | `src/blocks/engineering/*`: one file per block, plus `engineering-styles.ts`, `engineering-runtime.ts` (only if needed), `index.ts` |
| create | `tests/unit/engineering-widgets.test.ts`, `fixtures/pages/engineering-widgets.yaml` |
| notes | `reports/wp5-notes.md` |

The existing engineering blocks (terminal, file-tree, diff-summary, code-review, diagram-panel) stay in
`roster.ts`. Do not move them.

## Contracts (all `category: 'engineering'`)

```yaml
- type: kanban                     # filterable: true; data optional (dataRef rows → cards via fields)
  columns: [{ id: todo, title: To do }]          # 2..8
  cards:   [{ title, column, text?, owner?, tags?: [≤4], status?: tone }]  # ≤60; column must match
  # or dataRef + fields: { title, column, owner?, status? }
- type: roadmap
  periods: [2026-Q3, 2026-Q4, 2027-Q1]           # 2..24 labels, ordered
  lanes:   [{ id: core, title: Core }]           # ≤8, optional (single lane default)
  items:   [{ title, lane?, start: 2026-Q3, end?: 2026-Q4, status?: planned|active|done|at-risk }]  # ≤40; start/end ∈ periods
- type: test-results
  summary?: computed from suites                 # pass/fail/skip totals + duration (format duration)
  suites: [{ name, cases: [{ name, status: pass|fail|skip|flaky, duration?: ms, message?: text≤400 }] }]  # ≤20 suites, ≤200 cases total
- type: log-viewer                 # filterable: true
  lines: [{ time?: ISO, level: debug|info|warn|error, source?, message }]   # ≤200
  # or dataRef + fields: { time, level, source, message }
- type: api-endpoint
  method: GET|POST|PUT|PATCH|DELETE
  path: /v1/runs/{id}
  summary?: text
  params?: [{ name, in: path|query|header, type, required?, description? }]   # ≤20
  request?: { language: json, code }             # rendered via existing code block markup
  responses?: [{ status: 200, description, code? }]                           # ≤8
- type: schema-viewer
  fields: [{ path: user.email, type: string, required?, description? }]       # ≤120, dotted paths
```

Rendering decisions:

- **Kanban.** Columns are a CSS grid at ≥1024. At ≤768 they become a horizontal scroll-snap strip with each
  column at 85% width, and they are marked as a list of lists for screen readers. Card status uses `toneBadge`.
- **Roadmap.** The period grid uses static `data-ak-start`/`data-ak-end` index attributes, with CSS covering
  1–24. The mobile view (≤560) becomes a stacked agenda list grouped by period. Today markers are not used,
  because they would break determinism.
- **Test-results.** The summary bar is computed, failures are listed first, and each suite is a `<details>`
  that is open when it contains failures. There is no script.
- **Log-viewer.** A monospace list with level badges. It has a search over lines when there are more than 20 lines
  (it reuses the core `filter` feature and its existing search wiring if it is compatible; otherwise it
  marks rows filterable and relies on filter-bar). It is filterable by `level` through filter-bar.
- **Api-endpoint.** A method badge plus the path, with `{param}` segments highlighted. A copy button for the path
  uses the existing `copy` feature. The params table includes `th scope`.
- **Schema-viewer.** The tree is built from dotted paths with nested `<details>`. Missing parent paths become
  implicit object nodes. This is deterministic, in authored order.

## Steps

1. Write the definitions with tags, useCases and a ≤110-character summary.
2. Write each `check()`:
   - kanban card column exists;
   - roadmap start ≤ end and both are in `periods`;
   - test-results case count ≤ 200;
   - schema paths unique.

   Each check reports with its path.
3. Write the renderers, the CSS and the fixture: a sprint board, a quarterly roadmap with 2 lanes, a test run with
   failures, a 40-line log, a POST endpoint, and a 15-field schema.

## Tests

- **Unit.**
  - Every block renders and validates.
  - Each `check()` diagnostic has its path.
  - Kanban and log-viewer rows carry `data-ak-filter-item` and `data-ak-row`.
  - Deterministic output ×3.
  - The roadmap renders no inline `style`.
- **Browser.** No overflow at 320 for kanban and roadmap. The kanban strip scrolls with the keyboard
  (`tabindex=0` region with a label).

## Acceptance

- [ ] All six blocks are in the catalog with category `engineering`, and the fixture has zero warnings.
- [ ] Each block is fully readable in print and with scripts off.

## Risks

| Risk | Mitigation |
| --- | --- |
| Roadmap CSS matrix size | 24×2 rules, emitted only when used |
| Log-viewer search duplicating filter-bar | Use the core search only; the filter-bar adds the level filter |

Rollback: revert and regenerate. The W2 incident-report fixture and recipe use log-viewer and test-results, so
they would have to drop them.
