# Wave 2 — Recipes, required fixtures, browser matrix, benchmark, docs

Starts after all of WP1–WP10 are merged and the controller has regenerated the artifacts. W2-A, W2-B and W2-C run
in parallel with disjoint files. The controller runs the final gates last.

## W2-A — Page recipes (issue phase 7, 5h, branch `gh10/w2-recipes`)

### Files

| Ownership | File |
| --- | --- |
| create | `src/recipes/index.ts` (`recipes()`, `recipe(name)`), `src/recipes/page-recipes/<name>.yaml` ×10, `src/recipes/recipe-loader.ts`, `tests/unit/page-recipes.test.ts` |
| edit (sequential after WP10) | `src/cli.ts`, `src/mcp-server.ts`, `src/index.ts`, `tests/unit/cli-stdin-and-mcp.test.ts`, `tests/unit/cli.test.ts`, `package.json` `files` (if the recipe YAML must ship; prefer embedding via a generated TS module, see below) |

### Contracts

```ts
export interface PageRecipe { name: string; summary: string; useCases: string[]; blocks: string[]; spec: string /* YAML */ }
export function recipes(): Omit<PageRecipe, 'spec'>[];   // sorted by name
export function recipe(name: string): PageRecipe;        // unknown → RenderError with allowed names
```

The recipes are dashboard, benchmark-report, architecture-review, incident-report, product-showcase, case-study,
release-recap, implementation-plan, research-report and decision-memo.

Rules:

- Each recipe is a complete, valid starter spec. It uses datasets where the content is tabular, placeholder text
  that is obviously replaceable (`Replace with …`), no remote assets, and a sensible preset (for example
  `data-console` for dashboard, `research-notebook` for research-report).
- Embed the YAML through a small generator `scripts/generate-recipes-module.mjs` that writes
  `src/recipes/recipes.generated.ts`, plus a `--check` mode. A runtime `readFileSync` of package files would break
  the bundling assumptions. Add `recipes:generate` and `recipes:check` scripts, and add `recipes:check` to
  `verify`.

CLI and MCP:

- `ak-render recipes [--json]`
- `ak-render recipe <name> [--json]`, which prints YAML by default
- MCP tools `recipes` and `recipe{name}`

### Tests

- Every recipe passes `validate()` with zero errors **and zero warnings**.
- Each one compiles deterministically ×3.
- Each one is ≤ 3,000 bytes of YAML.
- Each one uses at least 3 distinct block types.
- The list is sorted.
- An unknown name diagnostic.
- The CLI and MCP surface tests.

## W2-B — Required fixtures, browser matrix, spec-compression benchmark (6h, branch `gh10/w2-fixtures`)

### Files

| Ownership | File |
| --- | --- |
| create | `fixtures/pages/{complex-dashboard,benchmark-report,research-report,product-case-study,interactive-data-explorer,incident-report}.yaml` |
| create | `tests/browser/composition-matrix.spec.ts`, `benchmarks/spec-compression.mjs` |
| edit | `tests/unit/fixtures.test.ts` (add the 6 + the WP fixtures to the expected list and restore exact `toEqual` once the set is final), `package.json` (`bench:spec` script only), `tests/browser/benchmark.spec.ts` (only if the new fixtures need a width list change; keep `[375, 768, 1440]`) |

Fixture content requirements (each one validates with zero warnings):

| Fixture | Must exercise |
| --- | --- |
| complex-dashboard | data-console preset, 12-column grid with grid-items, kpi, chart v2 (stacked-bar, line with series.field) from a shared dataset, data-table, main-aside |
| benchmark-report | benchmark-comparison, chart (scatter or waterfall), data-table with sparkline and percent columns, references, tabs with chart and table panels |
| research-report | research-notebook preset, sidebar-layout, annotated-image, metric-breakdown, references, accordion with rich panels, callouts |
| product-case-study | product-studio preset, hero, testimonial, pricing, feature-matrix, gallery with lightbox, logo-cloud, people |
| interactive-data-explorer | state, filter-bar over a data-table (select, number-input, text-input), visibleWhen metric switcher, chart bound to the same dataset |
| incident-report | executive-report preset, timeline, log-viewer, test-results, api-endpoint, kanban for follow-ups, calendar or roadmap |

`composition-matrix.spec.ts` runs over every fixture in `fixtures/pages`:

- widths 320, 375, 768 and 1440, checking `scrollWidth <= clientWidth` on `html`;
- light and dark;
- reduced motion: no running animations (`getAnimations()` empty or finished);
- script disabled: all text from tabs, accordion, carousel and `visibleWhen` (initial view) is present in
  `innerText`;
- print emulation: every panel is visible;
- keyboard: every interactive control is reachable by Tab and has a visible focus ring;
- the network audit: zero requests, reusing `tests/browser/network-audit.ts`;
- axe: no critical violations, if axe is already a dev dependency. Otherwise use the existing a11y unit checks, and
  do not add a dependency without the maintainer.

`benchmarks/spec-compression.mjs`:

- For each required fixture, report the spec bytes, the spec bytes with every `dataRef` expanded inline (the
  savings), the compiled HTML bytes, the catalog text bytes, and the compact-describe bytes for the block types
  used.
- Write `docs/artifacts/spec-compression.{json,md}`. Output must be deterministic: no timestamps, and fixtures
  sorted.
- `bench:spec` runs it after `pnpm build`.

## W2-C — Docs and release notes (4h, branch `gh10/w2-docs`)

| Ownership | File |
| --- | --- |
| edit | `README.md` (block count, new sections: datasets/state, recipes, catalog search), `docs/agent-guide.md` (authoring workflow: search-catalog → describe --compact → recipe → validate), `DESIGN.md` (from all `reports/*-notes.md`: slots, ready-attribute pattern, data-attribute placement CSS, recipe selectors and root class contract, heading-level limitation), `CHANGELOG.md` (Unreleased), `llms.txt`, `skills/ak-render/SKILL.md`, `site/landing.yaml` (block count and catalog bytes measured after wave 2: replace the "54 block types… 5,164 bytes" and "Page Spec v1 — 54 blocks" strings), `fixtures/README.md` |
| create | `docs/data-and-state.md` (datasets, transforms, formats, state, bindings, visibleWhen, controls, filter-bar, determinism notes) |

Numbers in the docs are measured with the built CLI (`node dist/cli.js catalog | wc -c`). They are not estimated.
Plugin manifests and meta tags must stay in sync with the landing counts (AGENTS.md).

## Controller final gates

1. Run `pnpm build && pnpm schema:generate && pnpm snapshots:generate && pnpm gallery:generate && pnpm recipes:generate`, then commit.
2. Run `pnpm verify`, then `schema:check`, `snapshots:check`, `gallery:check`, `fonts:check`, `recipes:check`,
   `test:browser`, `test:package`, `bench:spec` and `bench`.
3. Determinism: compile every fixture 3 times, and the hashes must be equal. This is already covered by
   `render-determinism.test.ts` when it iterates the fixtures; otherwise add the new fixtures there.
4. Work through the REVIEW.md screenshot checklist: 1440, 768 and 375, light and dark, for the 6 required fixtures
   and the 10 theme snapshots.
5. Open the PR into `dev` from `mrgoonie/handle-issues-03-11`, using conventional commits, with the issue
   checklist ticked from the table below.

## Issue checklist → evidence

W2-B re-reads `gh issue view 10` and adds any checklist line that is missing below before the PR.

| Issue item | Evidence |
| --- | --- |
| Rich children in tabs, accordion, carousel and bento | `tests/unit/rich-composition.test.ts`, `fixtures/pages/rich-composition.yaml`, `interactions.spec.ts` (nested keyboard, script-off, print) |
| Nested validation paths and stable IDs | `tests/unit/nested-composition-normalize.test.ts` |
| grid-item spans and semantic layouts | `tests/unit/responsive-layout.test.ts`, `fixtures/pages/responsive-layouts.yaml`, `composition-matrix.spec.ts` (320 and 375 overflow) |
| Datasets, dataRef and transforms | `tests/unit/data-*.test.ts`, `complex-dashboard.yaml` |
| Safe state, bindings and visibleWhen | `tests/unit/visible-when.test.ts`, `tests/unit/runtime-state-escape.test.ts`, `controls.spec.ts` |
| data-table | `tests/unit/data-table.test.ts`, `fixtures/pages/data-tables.yaml` |
| Chart v2 kinds and encodings | `tests/unit/chart-v2.test.ts`, `fixtures/pages/charts-v2.yaml` |
| P1 widgets | `tests/unit/engineering-widgets.test.ts`, `tests/unit/evidence-widgets.test.ts` and their fixtures |
| P2 widgets | `tests/unit/product-widgets.test.ts`, `fixtures/pages/product-widgets.yaml` |
| Input controls and filter-bar | `tests/unit/controls.test.ts`, `tests/browser/controls.spec.ts`, `interactive-data-explorer.yaml` |
| Page recipes (CLI and MCP) | `tests/unit/page-recipes.test.ts`, CLI and MCP tests |
| Theme dialects and 4 presets | `tests/unit/theme-recipes.test.ts`, `theme-contrast.test.ts`, the theme snapshots |
| Catalog category, tags, search and describe-many | `tests/unit/catalog-search.test.ts`, `catalog-budget.test.ts` |
| Required and benchmark fixtures | The 6 fixtures, plus `docs/artifacts/spec-compression.md` |
| Browser checks | `composition-matrix.spec.ts`, `network-audit.spec.ts` |
| Backward compatibility | `tests/unit/backward-compat.test.ts` |

## Risks

| Risk | Mitigation |
| --- | --- |
| Recipe drift as blocks change | The recipes are validated in unit tests with zero warnings |
| The browser matrix is slow (about 17 fixtures × 4 widths × 2 schemes) | Shard by fixture. Reuse one compiled file per fixture |
| Docs counts going stale | Measure after the final regeneration; W2-C merges last |

Rollback: each W2 branch reverts independently. Reverting recipes also removes the CLI and MCP tools.

## Open questions for the maintainer

1. Is coverage by existing blocks acceptable for two widgets: `faq` through rich `accordion`, and `quote-grid`
   through `testimonial` with 2 or more items? Or do you want explicit aliases or blocks?
2. Should the `percent` format take percentage numbers (87 → "87%"), which matches the current `progress` and
   `stats` conventions, or fractions (0.87)?
3. The calendar starts weeks on Monday. Is that right, or should it be Sunday, or should it be a spec option?
4. Release version: is a minor bump to `0.3.0` intended, given that the spec stays v1 and the changes are
   additive?
5. Gallery `lightbox`: keep it as an author flag, or let the compiler decide (for example on for 4 or more
   images) per the "no knob the compiler can decide" principle?
6. This is pre-existing and out of scope here; should it be fixed separately? `docs/themes.md:59` shows an
   inline spec `theme.dark`, but `src/spec/normalize.ts:159` rejects it (allowed keys are preset, extends and
   tokens).
7. axe-core is not a dev dependency (`package.json` has no axe entry). Can W2-B add `@axe-core/playwright` for the
   critical a11y check, or should the check stay on the existing unit-level a11y assertions?
