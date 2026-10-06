# Page recipe notes

Branch `gh10/w2-recipes`. Code is in `src/recipes/`, the generator is `scripts/generate-recipes-module.mjs`, and the
tests are `tests/unit/page-recipes.test.ts`.

## Changelog lines

- feat(recipes): Ten page recipes ship as complete starter specs: `architecture-review`, `benchmark-report`,
  `case-study`, `dashboard`, `decision-memo`, `implementation-plan`, `incident-report`, `product-showcase`,
  `release-recap` and `research-report`. Each one validates with no errors and no warnings, compiles
  deterministically, is at most 3,000 bytes of YAML, and loads nothing remote.
- feat(cli): `ak-render recipes [--json]` lists the recipes. `ak-render recipe <name> [--json]` prints one as YAML, or
  the full record with `--json`. An unknown name exits 1 and lists the allowed names. A missing name exits 2.
- feat(mcp): New `recipes` and `recipe{name}` tools on both the stdio server and the remote endpoint. `recipe` returns
  the YAML spec text. On the remote server both are anonymous and count against `anon-ip`, like `catalog`.
- feat: The library exports `recipes()`, `recipe(name)`, `PageRecipe` and `PageRecipeSummary`. `recipe()` throws a
  `RenderError` with code `SPEC_VALIDATION_ERROR`, path `name` and `details.allowed` for an unknown name. This is the
  same pattern as an unknown catalog category.
- build: `pnpm recipes:generate` embeds the recipe YAML in `src/recipes/recipes.generated.ts`, and `pnpm recipes:check`
  (now part of `pnpm verify`) fails when that module is stale.

## Recipe and preset map

| Recipe | Preset | Block types |
| --- | --- | --- |
| architecture-review | blueprint | hero, main-aside, data-table (dataset), steps, key-value, callout, comparison, risk-matrix, code-review |
| benchmark-report | data-console | hero, benchmark-comparison, tabs with a bound grouped bar chart and a data-table (one dataset), references |
| case-study | product-studio | hero, kpi, split, card, steps, bound area chart with a marker, testimonial, people |
| dashboard | data-console | hero, kpi, grid with grid-items (bound line chart and metric-breakdown), filter-bar (select, text-input), data-table |
| decision-memo | executive-report | hero, callout, key-value, data-table (dataset), comparison, risk-matrix, checklist |
| implementation-plan | swiss-clean | hero, comparison, roadmap, steps, kanban (dataset), risk-matrix, checklist |
| incident-report | executive-report | hero, stats, timeline, log-viewer, callout, test-results, kanban (dataset) |
| product-showcase | product-studio | hero, bento, feature-matrix, pricing, testimonial, cta |
| release-recap | editorial | hero, stats, card-grid, tabs with diff-summary and test-results, callout, list |
| research-report | research-notebook | hero, sidebar-layout, key-value, rich-text, callout, bound scatter chart, metric-breakdown, accordion, references |

## Doc notes for the docs owner

- Authoring workflow: `search-catalog` → `describe --compact` → `recipe <name>` → edit → `validate` → render.
- Source format: each `src/recipes/page-recipes/<name>.yaml` starts with two metadata comment lines,
  `# summary: …` and `# use-cases: a; b; c`. The generator strips them from the embedded spec. The `blocks` list is
  collected from the parsed spec, and a unit test checks it against the compiler's IR node types.
- No recipe uses an image block (`image`, `gallery`, `showcase`, `logo-cloud`, `annotated-image`, or avatars). A
  starter spec cannot ship a local asset file, and remote assets are off by default. Authors add these blocks once they
  have assets.
- Charts are never placed in a column narrower than about 610px. `.ak-chart-canvas svg` has `min-width: 560px`, so a
  narrower chart scrolls horizontally inside its card. This is why the dashboard pairs an 8-span chart with a 4-span
  `metric-breakdown`, not a second chart. It belongs in DESIGN.md (Charts).
- The MCP tool order is: catalog, search-catalog, describe, recipes, recipe, validate, render, themes.
- `LOCAL_INSTRUCTIONS` and `REMOTE_INSTRUCTIONS` now say "optionally start from a recipe (list them with recipes)".
- `scripts/cloud-smoke.mjs` was left unchanged. It checks the deployed endpoint, which does not have the new tools
  until the next deploy.

## Verification

- `pnpm verify` passes: lint, typecheck, fonts:check, recipes:check, 1,411 tests and build. `pnpm recipes:check`
  passes.
- Each recipe was compiled and checked in Chromium at 1440 light, 1440 dark and 375 light with reduced motion. Every
  view had zero horizontal overflow (`scrollWidth - clientWidth = 0`) and made zero network requests.
