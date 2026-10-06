# Wave 0 notes: data library and plumbing

Branch `gh10/w0`. Wave 1 agents: read "Contract summary" and "Deviations" before you start.

## Changelog lines

- feat(data): Datasets, bounded transforms (filter, groupBy, sort, select, limit), and locale-free value formatting.
- feat(spec): Blocks can nest other blocks in slots. Slots support `accepts` and `parents` rules, and diagnostics carry nested JSON paths.
- feat(spec): `visibleWhen` shows a block only while a state value matches. The compiler emits the initial view, so the page reads correctly without scripts.
- feat(spec): The spec now accepts:
  - top-level `datasets`;
  - per-block `dataRef`, `data` and `transform`, on blocks that take data;
  - `theme.recipes`;
  - `theme.dark`.
- feat(registry): The catalog carries a category, tags and use cases for every block. Block modules and feature modules are checked when they register.
- feat(registry): URL props now declare the network capability of the asset they load. The CSP origins and the validation gate both come from one schema walk.
- feat(registry): When a `oneOf` value fails, the diagnostics come from the option the author meant, chosen by JSON shape and then by `type`.
- fix(render): Tab panels and carousel slides are readable without scripts and in print.
- fix(render): The runtime escapes embedded state, so a value such as `</script>` cannot close the script element.
- fix(render): An event stops at the nearest block, so it no longer reaches an enclosing block's bindings.
- fix(render): A `set-value` action that has no `value` now takes the event's value, for example the slider's. Before, it set `undefined`.

## DESIGN notes (to fold into DESIGN.md)

### Tabs without scripts

- Every panel ships visible, and each starts with a `<p class="ak-tab-panel-title">`.
- The tablist stays hidden until the runtime sets `data-ak-tabs-ready`.
- Once the container is ready, the panel titles are hidden and the inactive panels get `hidden`.
- Print shows every panel with its title and hides the tablist.

### Carousel without scripts

- All slides sit in a horizontal scroll-snap strip, and the controls are hidden.
- The runtime sets `data-ak-carousel-ready`, then shows one slide at a time.
- Print stacks every slide and hides the controls.

### `visibleWhen` wrapper

- The wrapper is `<div class="ak-when" data-ak-when="{json}" [hidden]>`, styled with `display:contents`, so it does not affect grid or flex layout.
- `.ak-when[hidden]{display:none!important}` lives in `FEATURE_CSS.state`, never in `BASE_CSS`.

### CSS order

The order in `buildCss`:

1. base
2. core features, in `FEATURE_ORDER`
3. module features, in registry order
4. recipe CSS
5. theme tokens
6. inverse surface

Recipe sheets follow every feature sheet, because they restyle feature surfaces.

## Contract summary for wave 1

### Block modules

Types are in `src/registry/block-module.ts`.

- Export a `BlockModule` `{ definition, render, check? }` and add it to your group's `blocks` in `src/blocks/<group>/index.ts`.
- Group order is fixed by `src/blocks/index.ts`: composition, layout, data-table, chart, engineering, evidence, product, controls.
- `define()` (in `src/registry/define-helpers.ts`) now requires `category` (one of `BLOCK_CATEGORIES`), `tags` and `useCases`:
  - tags: at most 6, kebab-case;
  - useCases: at most 4, each at most 40 characters.
- Optional definition fields:
  - `parents` — allowed direct parent types;
  - `filterable`;
  - `data: { required, description }`.
- `check(node, { bag, byId, state, datasets })` runs after normalization, in IR order. Report at `node.path`-based paths and set `nodeId`.

### Feature modules

A feature module has the shape `{ name, marker, css, script?: { code, boot? }, announces? }`.

- The marker must appear in `css`.
- `buildRegistry` throws when:
  - a type or feature name is a duplicate, including a clash with a core feature;
  - a feature name is not kebab-case;
  - a marker is missing from its CSS;
  - a block declares an unknown `runtimeFeature`;
  - the metadata is invalid;
  - a `blocks` prop is in an illegal position;
  - `parents` or `accepts` names an unknown type.
- `verify.ts` checks module markers in both directions and requires a script when `script` is set.
- Runtime code is ES5-style. It is appended after the core parts, in registry order, and before `EFFECTS`.
  - Each `boot` runs before `wireEffects();`.
  - Available helpers: `q`, `qa`, `byId`, `announce`, `readJson`, `setPath`, `readPath`, `fire(source, event, detail)` and `run`.
- `announces: true` adds the live region.
- The compile result's `features` lists the module feature names after the core ones.

### Nested slots

- Use `blocks({ accepts?, minItems?, maxItems? })` (defaults: minItems 1, maxItems 40).
- Allowed positions: a top-level prop not named `blocks`, or a field of `itemsOf(...)` / `list(obj(...))`.
- Render a slot with `context.renderSlot(node, slotKey('aside'))` or `context.renderSlot(node, slotKey('items', index, 'blocks'))`. `slotKey` is in `src/render/render-context.ts`.
- Slot lists never enter `props`. They live in `node.slots[key]` as node ids, in schema-key order and then item order.
- `RenderContext` also has `renderChildren`, `byId` and `registry`.
- Nested blocks count toward `LIMITS.maxBlocks`.

### Data

Data lives in `src/data/`.

- When a definition sets `data`, the block accepts `dataRef` or `data` (never both), plus an optional `transform`.
- `node.data` is a `MaterializedData` `{ source, fields, rows }`, resolved once at normalize time. Renderers and checks read only `node.data`.
- Formatting:
  - Use `formatValue(value, spec)` with `FORMAT_FIELDS` spread into the column or axis schema.
  - Null renders as `—`.
  - A unit is joined with a non-breaking space.
- Use `reportUnknownField(field, data, path, bag, nodeId)` for field references, which gives `details.allowed`.
- Filterable rows use `filterRowAttributes(row)` from `src/render/block-helpers.ts`, which emits `data-ak-filter-item` and `data-ak-row` JSON. No runtime reads `data-ak-row` yet; the filter-bar package owns that.
- Limits:
  - `DATA_LIMITS`: 20 datasets, 200 rows, 32 fields, 400-character strings.
  - `TRANSFORM_LIMITS`: 8 filters, 3 sort keys, 24 selected fields.
  - `LIMITS.maxDatasets`, `maxDatasetRows` and `maxDatasetFields` mirror `DATA_LIMITS`. Enforcement stays in `validateDatasets`, at the dataset's path.
- A row key that equals a forbidden key (`html`, `css`, and so on) is rejected by the forbidden-key scan as `POLICY_VIOLATION`, with its path.

### State and conditions

- Any block may carry `visibleWhen: { path: state.x, <op>: value }`. The operators are `equals`, `notEquals`, `in`, `notIn`, `truthy: true` and `falsy: true`.
- Conditions are evaluated with own keys and strict equality, and `evaluateCondition` and the runtime's `evalCondition` agree.
- A condition adds the `state` feature.
- A first key not declared in `state` is a warning.
- Condition paths use the same rule as action paths: `STATE_PATH_PATTERN` in `src/registry/actions.ts`, lowercase kebab keys.

### Recipes (WP9)

- `THEME_RECIPE_SPECS` in `src/theme/recipes.ts`; the first value of each surface is the default.
- Fill `RECIPE_CSS[surface][value]` in `src/render/recipe-styles.ts` with `RecipeSheet { feature?, css }`. A sheet that names a feature is emitted only when the page uses that feature.
- `ir.theme.recipes` is set only when it is non-empty.

### Assets

- Any URL that the page loads must use `urlProp({ asset: 'images' | 'media' })`.
- Origins reach the CSP from that flag alone, at any depth.
- When a blocked remote reference would be silently dropped, add `rejectBlocked: true`; validation then fails at its own path.
- Renderers still apply the network gate through the `block-helpers` media helpers.

### `oneOf`

- When a value matches no option, the option is picked by JSON shape. Among object options, a required `type` string enum decides.
- Give object variants a required `type` enum to get precise errors.

### Registry

- Tests pass `registry: buildRegistry([...BLOCK_GROUPS, MY_GROUP])` through `compile` or `normalizeSpec` options. This is internal and not exported from the package.
- `tests/unit/support/probe-block-group.ts` shows nested slots, `parents` and a data block with a `check`.

### Tests

`tests/unit/fixtures.test.ts` uses `arrayContaining`. A wave 1 package may add a fixture without editing the list.

## Deviations from `wave0-foundation.md`

- **Notes file.** One file, `reports/w0-notes.md`, replaces `w0-a-notes.md` and `w0-b-notes.md`, at the controller's request.
- **Merge gate result.** With script bodies and nonces stripped, only tabs and carousel pages differ:
  - in the gallery: `interactive`, `all-components`, `media`, `explain` and `theme-showcase`;
  - all 6 theme snapshots, which contain a carousel.

  Each diff is the intended no-JS fix, exactly:
  - added tab and carousel CSS rules;
  - panel titles in the tabs markup;
  - no static `hidden` or `aria-hidden` on panels and slides.

  `docs/gallery/index.html` also differs, but only in its page-size captions (for example 116.9 kB to 117.2 kB), because the runtime grew. Hash comments in the snapshot headers change with the bytes.
- **Catalog and schema order.** `BLOCK_DEFINITIONS` is now the core roster followed by the groups' blocks. The moved blocks (stack, grid, split, tabs, accordion, carousel, bento, chart, gallery) are therefore listed after the core entries in `catalog()`, `describe` ordering and the schema's `block.oneOf` and `$defs`. Contents are unchanged; only the order moved.
- **`rejectBlocked`.** `UrlPropSchema.rejectBlocked?: boolean` is new, alongside the frozen `asset` flag.
  - It is needed because most assets render a visible fallback when blocked, while the video poster used to have a dedicated validate-time error.
  - The poster is now `asset: 'images', rejectBlocked: true`, with the same message and path as before. A nested poster reports its nested path.
  - Blocked images keep their rendered fallback; this is unchanged behavior.
- **`theme.dark`.** It is now accepted in the spec envelope and the schema, as a plain object of token overrides that the existing theme resolver already reads. It was previously rejected as an unknown theme field.
- **Module renderers.** They are not spread into `RENDERERS`. `renderNode` consults `context.registry.modules` first, and the result is the same.
- **`set-value`.** A `set-value` with no own `value` and no `detail.value` is now a no-op. Before, it wrote `undefined`.
  - Tabs fire `{ index }` and carousels fire `{ index }`, so a tabs `select` set-value without `value` stays a no-op; `interactive.yaml` binds one this way.
  - Adding `value: <tab id>` to the tabs detail was left out as a behavior change outside wave 0.
- **Separate runtime test.** `runtime-state-escape.test.ts` exists as a separate file, as planned. The browser checks are in `tests/browser/state-and-no-script.spec.ts`:
  - `visibleWhen` toggling;
  - the no-JS initial view;
  - no-JS tabs and carousel;
  - print.
- **Bounds.** The bounds walker counts only arrays under keys named `blocks`. Slots under other names (for example `aside`, or items' `blocks` already counted) are covered by a normalize check: when the built node count exceeds `LIMITS.maxBlocks`, it reports `SPEC_BOUNDS_ERROR` at `$.blocks`.
- **Package exports.** The package index gains these exports:
  - `BlockCategory` and `BLOCK_CATEGORIES`;
  - `THEME_RECIPE_SPECS` and `ThemeRecipeSurface`;
  - `VALUE_FORMATS` and `ValueFormat`;
  - `MaterializedData`, `DataRow` and `DataScalar`.

  `buildRegistry` and `BlockRegistry` stay internal.
