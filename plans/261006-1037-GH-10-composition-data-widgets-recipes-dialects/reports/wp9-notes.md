# Theme dialects notes

Branch `gh10/wp9-themes`. Component recipes now resolve through the preset chain and reach the page. Four new presets use them.

## Changelog lines

- feat(theme): Theme recipes restyle components through closed enums. The surfaces are cards, sections, tables, charts, hero, metrics, media and callouts. A preset, a preset file (`recipes:` key) or the spec's `theme.recipes` selects them. Resolution order: defaults, then the extends chain, then the preset, then the spec.
- feat(theme): Four new built-in presets ship: `data-console`, `executive-report`, `product-studio` and `research-notebook`. They reuse the bundled faces, so no font asset is added.
- feat(theme): `ResolvedTheme.recipes` lists every surface with its resolved value. `PresetEntry.recipes` is optional.
- test(theme): Every built-in preset is checked for WCAG 2.2 contrast in both schemes.

## DESIGN notes (to fold into DESIGN.md)

### Recipes

- Code lives in `src/render/recipe-styles.ts`, with the enums in `src/theme/recipes.ts`.
- Each non-default recipe becomes a `data-r-<surface>="<value>"` attribute on `<html>`, in surface order. Its rules are scoped under `html[data-r-…]`, which gives them enough specificity to beat the base and feature rules without `!important`.
- A default value emits neither the attribute nor any CSS, so pages with default recipes keep identical bytes.
- Recipe CSS comes after every feature sheet and before the theme tokens.
- A sheet tied to a feature (`chart`, `kpi`, `data-table`) is emitted only when the page uses that feature, which keeps the verify marker check intact.

Treatments:

| Surface | Value | Treatment |
| --- | --- | --- |
| cards | flat | `surface-raised` fill, transparent border, no shadow. Applies to `.ak-card`, `.ak-surface`, `.ak-stats` and `.ak-kpi-card`. |
| cards | outlined | Surface fill, a border at 22% text over the border colour, no shadow |
| sections | divided | Top-level section heads get a 2× border-width rule at 24% text, and the accent tab stays. Section breaks are 3.25× gap (2.5× at ≤768px). |
| sections | plain | No rule and no accent tab |
| tables | ledger | Even rows get a 4% text overlay. Lining tabular numbers. The header rule is 2× border width at 70% text. |
| tables | minimal | `.ak-table-wrap` loses its frame, fill and shadow. Cells have no side borders and are compact (.5em). The header is transparent. |
| charts | minimal | `.ak-chart-grid` is hidden and only the baseline (`.ak-chart-axis`) remains. Labels are 10px at weight 400, with the muted colour unchanged. |
| hero | compact | Left-aligned with reduced padding. h1 is scale⁴ (scale³ at ≤768px). The aurora is pinned to the right even when `align: center`. |
| metrics | headline | Stat values are scale^4.6 (2.2× at ≤480px). KPI values are scale^5.2. The KPI label is ordered first. |
| media | framed | `.ak-media` and `.ak-gallery figure` sit in an inset frame: surface fill, border, `radius-large` and card elevation. The image has no border, and the caption sits inside the frame. |
| callouts | outlined | `.ak-callout` only (alerts keep their tint). Transparent fill, the border at 60% tone, and the glyph drawn as a tone ring. |

Root classes the recipe selectors rely on:

- base: `.ak-card`, `.ak-surface`, `.ak-stats`, `.ak-stat`, `.ak-main`, `.ak-section`, `.ak-section-head`, `.ak-hero`, `.ak-eyebrow`, `.ak-table-wrap`, `.ak-media`, `.ak-gallery`, `.ak-callout`;
- feature: `.ak-chart`, `.ak-chart-grid`, `.ak-chart-axis` and `.ak-chart-label` (chart); `.ak-kpi-card`, `.ak-kpi-label` and `.ak-kpi-value` (kpi);
- data-table: `.ak-data-table`, plus plain `table`/`thead`/`tbody`/`th`/`td` descendants only.

### New presets

- Each new preset keeps body text at 7:1 or more on the background, surface and raised surface. Muted text, accent, info, success, warning, danger and accent-contrast on accent all reach 4.5:1 or more, in light and in dark.
- The six existing presets also pass every one of these thresholds, so the test enforces the thresholds for all ten presets and needs no recorded floor.
- `data-console` is "dark-first" in its palette design only. The page still follows `prefers-color-scheme`, as every preset does.

## Deviations

- **Frozen `render.ts`.** The controller approved the change.
  - `buildCss` now calls `recipeCss(theme.recipes, features)`, using the resolved theme instead of `ir.theme.recipes`.
  - `assembleDocument` receives `recipes: resolved.recipes`.
  - Without this change, preset recipes and `--theme` overrides could not reach the page.
- **`--theme` override.** `compile(spec, { theme })` replaces the spec's whole theme, so the spec's `theme.recipes` no longer applies when a theme option is given. Before, they were applied regardless. This is consistent with tokens, and it is documented in `docs/themes.md`.
- **Callouts outlined.** The plan said "left accent border". DESIGN.md says status blocks never use a side stripe, so `outlined` draws a full tone outline with a transparent fill instead.
- **Charts minimal.** "Lighter axis labels" is done through weight and size, not colour, so the labels keep AA contrast.
- **`RECIPE_CSS` shape.** It follows the W0 contract (`RecipeSheet { feature?, css }[]`), not the plan's `{ base, features }` sketch.
- **Module split.** The preset builder moved from `presets.ts` to `src/theme/preset-builder.ts`, and the new presets live in `src/theme/dialect-presets.ts`. The existing preset data is unchanged and byte-identical.
- **Test outside WP9's files.** The controller approved this edit: `tests/unit/theme-catalog.test.ts` (the built-in list now has 10 names).

## For the controller

- `scripts/generate-theme-snapshots.mjs` needs no change, because it iterates `themePresetNames()`. Regenerating after merge adds four snapshots, and the gallery gains `theme-dialects.html`.
- `tests/unit/theme-snapshot.test.ts` needs the four new snapshot files, and passes once they are regenerated.
- `tests/unit/backward-compat.test.ts` fails on this branch only because of `theme-dialects.yaml` (`theme.recipes`). It is fixed on the integration branch (06574e5).
- `fixtures/README.md` and the shared prose (README preset list, `SKILL.md`, `llms.txt`, landing) still list six presets. Wave 2 should update them.
