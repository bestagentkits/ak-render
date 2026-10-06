---
title: "GH-10: composition, datasets/state, data widgets, controls, recipes, theme dialects"
description: "Deliver all 8 phases of issue #10 as an additive Page Spec v1 release, split into a sequential foundation wave and parallel work packages with strict file ownership."
status: pending
priority: P1
effort: 104h
branch: mrgoonie/handle-issues-03-11
tags: [gh-10, composition, datasets, state, data-table, chart, widgets, controls, recipes, themes, catalog]
created: 2026-10-06
---

# GH-10 delivery plan

Issue: https://github.com/bestagentkits/ak-render/issues/10. Every phase (1–8), plus catalog scalability, the
required fixtures, the benchmark fixtures and the browser checks, ships in this release.

## Outcome

An agent can author dashboards, evidence reports and mini-app pages with nested composition, shared datasets,
bounded transforms, safe state, typed tables, richer charts, semantic widgets, native controls, page recipes and
theme dialects. The Page Spec stays **v1** and is additive only: every currently valid spec stays valid. Output
stays deterministic, offline, CSP-clean, and readable with scripts off, in print and with reduced motion.

## Waves

| Wave | Runs | Packages | Merge gate |
| --- | --- | --- | --- |
| 0 | W0-B first (or in parallel), then W0-A integrates | [W0 foundation](./wave0-foundation.md): W0-A plumbing, W0-B data library | Existing fixtures are byte-identical apart from the runtime `<script>` body. All gates are green. The controller regenerates and commits the artifacts. |
| 1 | Up to 7 at a time, in separate worktrees | WP1–WP10 below | Per-WP acceptance passes, then the controller merges and regenerates |
| 2 | 3 in parallel | W2-A recipes, W2-B fixtures/browser/bench, W2-C docs | All gates, the REVIEW.md screenshots and the benchmark artifacts |

## Wave 1 work packages

| WP | File | Issue phase | Depends on | Est. |
| --- | --- | --- | --- | --- |
| WP1 Rich composition (tabs, accordion, carousel, bento) | [wp-1-rich-composition.md](./wp-1-rich-composition.md) | 1 | W0 | 7h |
| WP2 Responsive layout (grid-item, sidebar-layout, main-aside, rail-layout, grid/stack options) | [wp-2-responsive-layout.md](./wp-2-responsive-layout.md) | 2 | W0 | 6h |
| WP3 data-table | [wp-3-data-table.md](./wp-3-data-table.md) | 3–4 | W0 | 7h |
| WP4 Chart v2 | [wp-4-chart-v2.md](./wp-4-chart-v2.md) | 4 | W0 | 9h |
| WP5 Engineering widgets (kanban, roadmap, test-results, log-viewer, api-endpoint, schema-viewer) | [wp-5-engineering-widgets.md](./wp-5-engineering-widgets.md) | 5 P1 | W0 | 9h |
| WP6 Evidence widgets (benchmark-comparison, metric-breakdown, annotated-image, references) | [wp-6-evidence-widgets.md](./wp-6-evidence-widgets.md) | 5 P1 | W0 | 6h |
| WP7 Product widgets (pricing, feature-matrix, testimonial, logo-cloud, people, calendar, gallery lightbox) | [wp-7-product-widgets.md](./wp-7-product-widgets.md) | 5 P2 | W0 | 8h |
| WP8 Controls and filter-bar | [wp-8-controls-filter-bar.md](./wp-8-controls-filter-bar.md) | 3, 6 | W0 | 7h |
| WP9 Theme dialects and 4 presets | [wp-9-theme-dialects.md](./wp-9-theme-dialects.md) | 8 | W0 | 6h |
| WP10 Catalog scalability | [wp-10-catalog-scalability.md](./wp-10-catalog-scalability.md) | catalog | W0 | 4h |

Wave 2 lives in [wave2-integration.md](./wave2-integration.md): W2-A page recipes (phase 7, 5h), W2-B required
and benchmark fixtures, browser matrix and spec-compression benchmark (6h), and W2-C docs and release notes (4h).
Recipes wait for wave 2 because each recipe must validate against the final roster.

Dependency graph: `W0-B → W0-A → {WP1..WP10} → {W2-A, W2-B, W2-C} → controller final gates`. No two WPs in a wave
own the same file. Each WP file has an ownership table.

Running with 7 agents:

- First batch: WP1, WP2, WP3, WP4, WP8, WP9, WP10.
- When the first agents finish: WP5, WP6, WP7.

The merge order is WP2, WP1, WP9, WP10, WP3, WP4, WP8, WP5, WP6, WP7. WP3 goes before WP8 because the filter-bar
fixture targets data-table. After each merge the controller runs `pnpm verify` and the catalog budget test, then
regenerates and commits the artifacts.

## Ownership rules (every WP)

- **Frozen after wave 0:** `src/registry/roster.ts`, `src/render/blocks.ts`, `src/render/showcase-blocks.ts`,
  `src/render/render.ts`, `src/render/verify.ts`, `src/render/runtime.ts`, `src/render/feature-styles.ts`,
  `src/render/showcase-styles.ts`, `src/spec/normalize.ts`, `src/ir.ts`, `src/registry/prop-schema.ts`,
  `src/registry/block-module.ts`, `src/blocks/index.ts`, `src/data/*`. A WP that needs one of these changed stops
  and reports `NEEDS_CONTEXT`. It does not edit the file.
- **Generated files are never committed by a WP:** `schema/page-spec.v1.json`, `fixtures/snapshots/*`,
  `docs/gallery/*`, `docs/artifacts/*`, `site/dist`. A WP may run `pnpm schema:generate`, `snapshots:generate` and
  `gallery:generate` locally to make `pnpm test` pass. It then runs
  `git checkout -- schema fixtures/snapshots docs/gallery docs/artifacts` before it commits. After each merge, the
  controller runs `pnpm build && pnpm schema:generate && pnpm snapshots:generate && pnpm gallery:generate` and
  commits the result.
- **Shared prose is integrated in wave 2:** `CHANGELOG.md`, `DESIGN.md`, `README.md`, `llms.txt`, `fixtures/README.md`,
  `docs/agent-guide.md`, `skills/ak-render/SKILL.md` and `site/landing.yaml`. Each WP writes its changelog lines
  and DESIGN notes into `reports/<wp>-notes.md`.
- **Tests:** a WP creates new test files. It edits an existing test only when the WP file lists that test as owned.
- **Branches:** `gh10/w0-a`, `gh10/w0-b`, `gh10/wp1-composition` … `gh10/wp10-catalog`, `gh10/w2-*`. All are cut
  from `mrgoonie/handle-issues-03-11` after wave 0 merges. Use conventional commits, with no plan or phase IDs in
  code, test names or commit messages.
- **Status protocol:** every WP report ends with `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`.

## Design decisions (locked)

| Question | Decision |
| --- | --- |
| Rich items: a `tab-panel` child or a blocks prop? | A typed nested block list inside compound-item props (`items[i].blocks`). It uses the new `blocks` prop kind. The IR keeps one node per authored block and records explicit slot edges as `IrNode.slots['items[1].blocks'] = [ids]`. This is the issue's authoring shape, stable path-derived IDs and natural JSON paths, with no synthetic node types. Text items stay valid. |
| Page Spec version | Stays `version: 1`, with additive keys: top-level `datasets`; block keys `visibleWhen`, `dataRef`, `data`, `transform`; `theme.recipes`. Requiredness only relaxes (for example a bento tile `title`, a tab `text`, chart `labels`/`series` when data is bound). |
| grid-item fields | `span` 1–12, `tabletSpan` 1–12, `mobileSpan` 1–12, `rowSpan` 1–4, `start` 1–12, `align` start/center/end/stretch. No `order`: DOM order stays visual order (a11y). |
| Semantic layouts | `sidebar-layout` (`sidebar:` slot + main `blocks`), `main-aside` (`aside:` slot), `rail-layout` (`rail:` slot). |
| Widgets | All listed widgets ship, except two that existing blocks already cover. `faq` is covered by rich `accordion`. `quote-grid` is covered by `testimonial` (2+ items render a grid). `gantt` ships as `roadmap`. `profile`/`people` ships as `people`. `citations` ships as `references`. |
| Chart v2 kinds | `scatter`, `histogram`, `stacked-bar`, `stacked-bar-100`, `heatmap`, `waterfall`, `funnel`, `gauge`, `treemap`. Encodings `x`, `y`, `series`, `value`. Extras: `markers`, `annotations`, `sort`, and `y.min`/`y.max`. Legend placement stays compiler-owned. |
| Theme recipe enums | `cards: raised|flat|outlined`, `sections: ruled|divided|plain`, `tables: default|ledger|minimal`, `charts: default|minimal`, `hero: default|compact`, `metrics: default|headline`, `media: default|framed`, `callouts: tinted|outlined`. The first value is the default. Density stays the existing `density` token, with no duplicate axis. |
| New presets | `data-console`, `executive-report`, `product-studio`, `research-notebook`. They reuse the already-bundled faces, so there are no new font assets. |
| Recipe CLI | `ak-render recipes [--json]`, and `ak-render recipe <name> [--json]` (YAML by default). MCP tools `recipes` and `recipe`. Library `recipes()` and `recipe(name)`. |
| Catalog CLI | `ak-render catalog [--category <c>]`, `ak-render search-catalog <terms…>`, and `ak-render describe <type…> [--compact]`. MCP: `catalog{category}`, `search-catalog{query}`, `describe{type|types, compact}`. |
| State model | Controls bind with `bind: state.<key>`. `set-value` without `value` assigns the event's value. `visibleWhen` takes one operator from `equals|notEquals|in|notIn|truthy|falsy`. Script-off and print show the initial-state view, evaluated at compile time. |

## Acceptance (release)

- [ ] Every issue checklist item maps to a passing test or fixture. The mapping table is in `wave2-integration.md`.
- [ ] `pnpm verify`, `schema:check`, `snapshots:check`, `gallery:check`, `fonts:check`, `test:browser` and `test:package` are green.
- [ ] Six required fixtures, plus one fixture per WP, validate with zero errors, compile deterministically (same hash ×3) and have zero network requests.
- [ ] No horizontal overflow at 320, 375, 768 and 1440 on every fixture. All tab, carousel and conditional content reads with JS off and in print.
- [ ] Catalog text is ≤ 9,000 bytes, catalog JSON is ≤ 20,000 bytes, a `--category` listing is ≤ 3,000 bytes, and compact describe is ≤ 1,500 bytes per block.
- [ ] `docs/artifacts/spec-compression.md` shows `dataRef` saving bytes against inlined data, and gives the spec bytes per required fixture.
- [ ] A fixture that predates this release still validates with zero new errors (backward-compatibility test in W0).

## Top risks

See [wave0-foundation.md#risks](./wave0-foundation.md#risks) and each WP. The highest are slot plumbing
regressions (W0), nested runtime scoping (WP1), filter and state runtime correctness (WP8), and catalog token
growth (WP10). Rollback is one `git revert -m 1 <merge>` per WP followed by artifact regeneration. Reverting W0
requires reverting every wave 1 merge first.

## Unresolved questions

See the end of [wave2-integration.md](./wave2-integration.md#open-questions-for-the-maintainer).

## Controller decisions on open questions (2026-10-06)

1. `faq` → rich `accordion`; `quote-grid` → `testimonial` with 2+ items. Accepted.
2. `percent` format takes the human value: `87` renders `87%` (matches the issue's `reduction: 87` example).
3. Calendar weeks start Monday (ISO 8601) by default; optional `weekStart: monday|sunday` enum.
4. Release is `0.3.0` (additive, pre-1.0 minor).
5. Gallery lightbox is compiler-decided (no author flag), per "do not add a knob the compiler can decide".
6. `theme.dark` docs/normalize mismatch: fix in this release (W2-C owns the docs side; W0-A decides whether normalize should accept it or the doc is wrong — prefer making the doc match current behavior unless accepting is trivially safe).
7. `@axe-core/playwright` may be added as a devDependency by W2-B for the critical a11y check.
