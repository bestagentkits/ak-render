# WP9 — Theme component-recipe dialects and four new presets

Issue phase 8. Depends on W0. Branch `gh10/wp9-dialects`. Estimate 6h.

## Goal

Themes change component treatment through typed recipe enums, not just tokens. Four new presets show this.
Recipes are typed data; there is no CSS input.

## Context (verified)

- `src/theme/presets.ts`:
  - `PresetDefinition {name, description, light, dark}` at `:16`
  - the `preset()` builder at `:58`
  - `PRESETS` at `:80`: blueprint, editorial, paper-ink, terminal-mono, swiss-clean, warm-signal
  - `PresetEntry` at `:344`, `builtinPresetEntries` at `:358`
- Bundled faces (`presets.ts:85-294`) are Geist, Fraunces, Bricolage Grotesque, JetBrains Mono, Inter Tight and
  Plus Jakarta Sans. The new presets reuse them, so there are no new font assets and no `fonts:check` churn.
- `src/theme/theme-catalog.ts:23` `ALLOWED_PRESET_KEYS` = name, version, description, extends, tokens, dark.
- W0 provides:
  - `src/theme/recipes.ts` (`THEME_RECIPE_SPECS`, `validateThemeRecipes`)
  - `IrTheme.recipes`, accepted through `theme.recipes` in normalize
  - `src/render/recipe-styles.ts` with an empty `RECIPE_CSS` and the `recipeCss(recipes, features)` hook
    already called from `buildCss`
- `tests/unit/theme.test.ts:21` asserts the six presets.
- `scripts/generate-theme-snapshots.mjs` iterates `themePresetNames()`, so the new presets get snapshots
  automatically. The controller regenerates them.

## Files

| Ownership | File |
| --- | --- |
| exclusive | `src/theme/*` (presets, theme-catalog, load-theme, tokens, recipes), `src/render/recipe-styles.ts`, `src/render/document.ts`, `docs/themes.md` |
| exclusive (edit) | `tests/unit/theme.test.ts` |
| create | `tests/unit/theme-recipes.test.ts`, `tests/unit/theme-contrast.test.ts`, `fixtures/pages/theme-dialects.yaml` |
| notes | `reports/wp9-notes.md` |

`document.ts` is on DESIGN.md's read-first list. Read DESIGN.md first.

## Contracts

```ts
// presets.ts
export interface PresetDefinition { name; description; light; dark; recipes?: Partial<Record<RecipeAxis, string>> }
// PresetEntry gains recipes?: Record<string,string>; preset files accept a `recipes` key (ALLOWED_PRESET_KEYS).
// Resolution (load-theme.ts): defaults ← extends chain (base first) ← preset ← spec theme.recipes.
// ResolvedTheme gains recipes: Record<RecipeAxis, string> (all axes, defaults filled).

// recipe-styles.ts
export const RECIPE_CSS: Record<RecipeAxis, Record<string, { base?: string; features?: Record<string, string> }>>;
// recipeCss(recipes, features): for each axis whose value != default, emit `base` + the css of every used feature,
// selectors scoped as html[data-r-<axis>="<value>"] … ; deterministic axis order = THEME_RECIPE_SPECS key order.

// document.ts: <html … data-r-cards="flat" data-r-tables="ledger"> only for non-default values,
// so pages with default recipes are byte-identical.
```

Recipe treatments (token-driven only, using `var(--ak-*)`):

| Axis | Values | Treatment |
| --- | --- | --- |
| cards | raised / flat / outlined | shadow elevation / surface-only / border, no shadow |
| sections | ruled / divided / plain | top rule (current) / full-width divider and larger gap / no rule |
| tables | default / ledger / minimal | ledger: zebra rows, tabular numbers, strong header rule; minimal: no vertical lines, compact |
| charts | default / minimal | minimal: no gridlines except the baseline, lighter axis labels |
| hero | default / compact | compact: smaller display size, left-aligned, reduced padding |
| metrics | default / headline | headline: larger value, label above the value |
| media | default / framed | framed: inset border with padding and the caption on the surface |
| callouts | tinted / outlined | outlined: transparent background, left accent border |

Covered features: `table`, `data-table` (WP3 class names, matched through the stable `.ak-data-table` marker
only), `chart`, `kpi`, `stats` and the hero, card and section base classes. Selectors for blocks from other WPs
use only the root class contract stated in their WP file. Keep a list of the root class names you rely on in the
notes.

New presets:

| Preset | Faces | Palette intent | Recipes |
| --- | --- | --- | --- |
| data-console | Geist + JetBrains Mono for numbers | dark-first slate with a cyan accent | density compact (token), hero compact, tables ledger, charts minimal, cards flat, sections divided |
| executive-report | Inter Tight | white and ink with a navy accent | metrics headline, charts minimal, sections divided, cards outlined |
| product-studio | Plus Jakarta Sans | soft neutral with a violet accent | media framed, cards raised |
| research-notebook | Fraunces headings, system serif body | paper with an oxblood accent | callouts outlined, tables ledger, hero compact, cards flat |

## Steps

1. Add `recipes` to the preset definition, the entry and the file schema, plus `extends` merging and its
   validation (an unknown axis or value gives a diagnostic with `details.allowed`).
2. Fill `RECIPE_CSS`. Add the `document.ts` attributes.
3. Add the four presets. Every pair of body text and background, and of muted text and background, meets ≥ 7:1
   and ≥ 4.5:1 in both light and dark.
4. Write the contrast test: a WCAG relative luminance computation for every preset in light and dark, covering
   text, muted text, accent text on accent-contrast, and the tone colours on the surface (≥ 4.5:1).
5. Update `docs/themes.md`: the recipes section, the presets table, and the preset file `recipes` key.
6. Write the fixture `theme-dialects.yaml`: one page with a table, a chart, a kpi, a hero, cards and a callout,
   using `theme: { preset: data-console, recipes: { cards: raised } }` to show an override.

## Tests

- Ten presets are listed (update `theme.test.ts:21`).
- Recipe resolution order (spec over preset over extends over default).
- An invalid recipe value is rejected.
- A page using default recipes is byte-identical to the pre-WP output.
- A non-default recipe emits only the CSS for features in use.
- Contrast checks for all presets.
- Deterministic output.

## Acceptance

- [ ] `ak-render themes` lists 10 presets.
- [ ] The theme snapshots regenerate for 10 presets, and the controller checks the screenshots in light and dark.
- [ ] No raw CSS is reachable from the spec or from preset files.

## Risks

| Risk | Mitigation |
| --- | --- |
| Recipe selectors couple to other WPs' markup | Only root classes or markers; notes list them; W2-C writes them into DESIGN.md |
| Contrast regressions in existing presets surface through the new test | The test enforces the thresholds for the new presets. For the six existing presets it asserts their current measured ratios are not lowered (a recorded floor). Any existing failure is reported in the notes for the maintainer, and the existing palette is not changed |
| `data-r-*` attributes change bytes | Emitted only for non-default values |

Rollback: revert and regenerate the theme snapshots.
