# Wave 0 — Foundation (sequential, blocks everything)

Two packages. **W0-B** (data library) consists of pure new files, so it can start immediately and merge first.
**W0-A** (plumbing) integrates W0-B. Both must merge before any wave 1 branch is cut.

Read first: `AGENTS.md`, `docs/adr/0001-page-spec-compiler-boundary.md`, `DESIGN.md`, and the plan's
[design decisions](./plan.md#design-decisions-locked).

## Verified current state (file:line)

- `src/spec/normalize.ts:362` `buildNode` splits `entry.blocks` out as the children slot, then calls
  `validateProps` (`:409`) and `validateBindingsDeep` (`:410`). Slot `accepts` is **not enforced**. Only
  min/max is checked (`:441`). `postChecks` (`:487`) holds per-type checks (chart series length, and bento alt at
  `:603`).
- `src/ir.ts:15` `IrNode` has `children` only. `IrDocument` (`:59`) has no datasets.
- `src/registry/roster.ts:19` `RuntimeFeature` is a closed union. `BlockDefinition` (`:58`) has no category or tags.
  `BLOCK_DEFINITIONS` (`:203`) is one array. tabs `:543`, accordion `:560`, carousel `:574`, chart `:627`,
  bento `:675`, gallery `:914`, stack `:237`, grid `:244`, split `:254`.
- `src/render/blocks.ts:190` `RENDERERS` map. stack `:223`, grid `:233`, split `:243`, tabs `:670`,
  accordion `:705`, carousel `:729`, chart `:798`, gallery `:892`. Bento is in `src/render/showcase-blocks.ts:80`
  and registered at `:489`. `VALUE_TONES`/`valueTone`/`toneBadge` are at `blocks.ts:87-118`.
- `src/render/render.ts:61` `FEATURE_ORDER`, `:86` `collectFeatures`, `:102` `collectOrigins` (scans
  `props.src`, `items[].src` and `before/after` only), `:134` `buildCss`, `:186` `renderChildren`.
- `src/render/runtime.ts:621` emits `var state = ${JSON.stringify(options.state)}`. This is **not** escaped for a
  script context, so a state string containing `</script>` breaks out. `escape.ts:73` `serializeJsonForScript`
  exists. In `FIRE` (`:79`), `fire()` walks every ancestor, so a nested block's event would trigger an outer
  block's binding. In `RUN` (`:135`), `set-value` assigns `action.value` only.
- `src/render/runtime.ts:401` TABS and `:454` CAROUSEL query descendants with `qa('[role="tab"]', container)`,
  which also catches nested tabs and slides. Tab panels and carousel slides other than the first are emitted with a
  static `hidden` attribute (`blocks.ts:689`, `:737`), so the content is unreadable with scripts off and in print.
- `src/render/verify.ts:29` `FEATURE_MARKERS` and `:54` `SCRIPTED_FEATURES` are closed maps.
- `src/registry/prop-schema.ts:376` `oneOf` reports only "does not match any allowed shape".
- `src/spec/bounds.ts:13` LIMITS. The walker counts every `blocks` key anywhere (`:95`), so nested lists already
  count toward `maxBlocks`.
- `src/spec/forbidden.ts:21` forbids keys such as `template`, `object`, `embed`, `style` and `handler` anywhere,
  including dataset rows. New prop names must avoid them.
- `tests/unit/fixtures.test.ts:16` hard-codes the exact fixture list, which would make parallel fixture additions
  conflict.

---

## W0-B — data library (new files only)

### Files (exclusive)

| Create | Purpose |
| --- | --- |
| `src/data/dataset-types.ts` | Types and limits |
| `src/data/validate-datasets.ts` | Envelope `datasets` validation |
| `src/data/transform-pipeline.ts` | Bounded transforms |
| `src/data/resolve-block-data.ts` | `dataRef`/`data`/`transform`, materialized per node |
| `src/data/format-value.ts` | Shared deterministic value formatting, plus prop-schema fragments |
| `src/data/data-json-schema.ts` | JSON Schema fragments for `datasets`, `data`, `transform` |
| `tests/unit/data-transform.test.ts`, `tests/unit/data-format.test.ts`, `tests/unit/data-datasets.test.ts` | Unit tests |

### Contracts (other WPs import these, so do not rename them)

```ts
// dataset-types.ts
export type DataScalar = string | number | boolean | null;
export type DataRow = Record<string, DataScalar>;
export const DATA_LIMITS = { maxDatasets: 20, maxRows: 200, maxFields: 32, maxStringLength: 400 } as const;
/** Field keys: `^[A-Za-z_][A-Za-z0-9_-]{0,63}$`. Dataset names: NODE_ID_PATTERN. */
export const FIELD_KEY_PATTERN: RegExp;
export interface MaterializedData {
  source: string | null;          // dataset name, or null for inline `data`
  fields: string[];               // union of row keys in first-seen order, after transform/select
  rows: DataRow[];
}

// validate-datasets.ts
export function validateDatasets(value: unknown, path: string, bag: DiagnosticBag): Record<string, DataRow[]>;

// transform-pipeline.ts
export interface TransformSpec {
  filter?: { field: string; equals?: DataScalar; notEquals?: DataScalar; in?: DataScalar[];
             gt?: number; gte?: number; lt?: number; lte?: number }[];         // ≤8, AND, exactly one operator each
  groupBy?: { field: string; aggregate: 'count' | 'sum' | 'mean' | 'min' | 'max'; value?: string; as?: string };
  sort?: { by: string; direction?: 'asc' | 'desc' } | { by: string; direction?: 'asc' | 'desc' }[]; // ≤3 keys
  select?: string[];               // ≤24
  limit?: number;                  // 1..200
}
export const TRANSFORM_PROP_SCHEMA: PropSchema;   // used for validation + JSON schema + describe
/** Fixed order: filter → groupBy → sort → select → limit. Pure, stable, no locale. */
export function applyTransform(rows: DataRow[], spec: TransformSpec): DataRow[];

// resolve-block-data.ts
export interface BlockDataInput { dataRef?: unknown; data?: unknown; transform?: unknown }
export function resolveBlockData(input: BlockDataInput, datasets: Record<string, DataRow[]>,
  path: string, bag: DiagnosticBag): MaterializedData | undefined;
/** Diagnostic for an unknown field reference; details.allowed = data.fields. */
export function reportUnknownField(field: string, data: MaterializedData, path: string,
  bag: DiagnosticBag, nodeId?: string): void;
export function fieldValue(row: DataRow, field: string): DataScalar;   // missing → null

// format-value.ts
export const VALUE_FORMATS = ['text','number','integer','compact','percent','currency','duration','bytes','date'] as const;
export type ValueFormat = (typeof VALUE_FORMATS)[number];
export const CURRENCIES = ['USD','EUR','GBP','JPY','CNY','INR','VND','AUD','CAD','CHF','SGD','KRW'] as const;
export interface FormatSpec { format?: ValueFormat; unit?: string; currency?: string; decimals?: number }
/** Prop-schema fields `format`, `unit` (≤12), `currency`, `decimals` (0–4), to spread into column/axis schemas. */
export const FORMAT_FIELDS: Record<string, PropSchema>;
export function formatValue(value: DataScalar, spec?: FormatSpec): string;
```

Rules:

- **Comparison.** Numbers compare numerically. Strings compare by UTF-16 code units (never `localeCompare`).
  Booleans order false before true. Across types the order is number < string < boolean, and `null` sorts last in
  both directions. Sort is stable, with the original index as the tiebreak.
- **Mean.** `sum / count` in IEEE arithmetic. Only formatting rounds.
- **Formats.** `percent` takes a percentage number (87 → `87%`). `compact` gives `33.7k`, `1.2M`. `duration`
  takes ms (`340 ms`, `1.2 s`, `2.5 min`). `bytes` is 1000-based (`70.2 kB`). `date` takes an ISO `YYYY-MM-DD`
  string and gives `Oct 6, 2026`, using fixed English month names and no `Intl`. Grouping reuses the
  `formatNumber` logic now in `src/render/charts.ts:70`; copy it into `format-value.ts`. Do not import
  `charts.ts`.
- **Diagnostics.** Every problem has a JSON path, such as `$.blocks[2].transform.sort[0].by`, with
  `details.allowed` holding the fields. When `dataRef` and `data` are both set, it is an error. A `dataRef` that
  names a missing dataset is an error whose `details.known` lists the dataset names.

### Tests

Stable sort with ties. Null ordering. Every filter operator. groupBy with each aggregate. A select that drops a
field. Limit. The pipeline order. A golden table for each format. Unknown field and unknown dataset paths. Bounds
(21 datasets, 201 rows, 33 fields, a non-scalar value). A forbidden-key row field (`style`) reports
POLICY_VIOLATION through the existing scan.

---

## W0-A — plumbing (modifies frozen core files)

### Files

| Action | File | Change |
| --- | --- | --- |
| create | `src/registry/define-helpers.ts` | Move `str/txt/num/bool/urlProp/list/obj/oneOf/enumStr/idProp/actionMap/onProp/anchorProps/itemsOf/TITLE/OPTIONAL_TITLE/LABEL/define/semantic` out of `roster.ts:84-201`, unchanged, and add `blocks()` |
| create | `src/registry/block-module.ts` | `BlockModule`, `FeatureModule`, `BlockGroup`, `CheckContext` (below) |
| create | `src/render/render-context.ts` | `RenderContext` moved from `blocks.ts:48`, plus `renderSlot` and `byId` |
| create | `src/render/tone.ts` | `VALUE_TONES`, `valueTone`, `toneBadge` moved from `blocks.ts:87-118` |
| create | `src/spec/conditions.ts` | `visibleWhen` validation, plus compile-time evaluation shared with the runtime contract |
| create | `src/theme/recipes.ts` | `THEME_RECIPE_SPECS` contract and `validateThemeRecipes()`. WP9 owns it afterwards |
| create | `src/render/recipe-styles.ts` | `recipeCss(recipes, features)`, assembled from a `RECIPE_CSS` table that is empty here. WP9 fills the table |
| create | `src/blocks/index.ts` | `BLOCK_GROUPS` in fixed order: composition, layout, data-table, chart, engineering, evidence, product, controls |
| create | `src/blocks/<group>/index.ts` ×8 | Each exports `const GROUP: BlockGroup`. Groups that receive moved blocks start with them; the rest start as `{ blocks: [], features: [] }` |
| move | tabs, accordion, carousel, bento → `src/blocks/composition/{tabs,accordion,carousel,bento}.ts` | Definition plus renderer, unchanged. Bento's alt check moves from `normalize.ts:603` into `bento.check` |
| move | CSS `tabs`/`accordion`/`carousel` (`feature-styles.ts:20-60`), `bento` (`showcase-styles.ts:38`) → `src/blocks/composition/composition-styles.ts` | `feature-styles.ts` and `showcase-styles.ts` import them back under the same keys |
| move | runtime `TABS`/`CAROUSEL` strings (`runtime.ts:401-512`) → `src/blocks/composition/composition-runtime.ts` | `runtime.ts` imports them, in the same position and order |
| move | grid, stack, split → `src/blocks/layout/{grid,stack,split}.ts` | Their CSS stays in `styles.ts`, which WP2 owns in wave 1 |
| move | chart → `src/blocks/chart/chart.ts` (definition, renderer, series-length check from `normalize.ts:575`); chart CSS (`feature-styles.ts:66`) → `src/blocks/chart/chart-styles.ts`; `CHART_KINDS` (`roster.ts:175`) → `src/blocks/chart/chart-kinds.ts` | `roster.ts` re-exports `CHART_KINDS`, so `tests/unit/catalog-coverage.test.ts:6` keeps working. `src/render/charts.ts` stays put. WP4 owns it in wave 1 |
| move | gallery → `src/blocks/product/gallery.ts` | Its CSS stays in `styles.ts` |
| modify | `roster.ts` | Drop the moved entries. Widen `RuntimeFeature`. Add `'state'` to the core union. Add `category/tags/useCases` to **every** remaining entry (table below). Re-export the definition helpers |
| modify | `registry.ts` | `BLOCK_DEFINITIONS` = roster core entries + `BLOCK_GROUPS` blocks. Validate registration at load (duplicate types or features, unknown features, a marker missing from css). JSON schema additions (below) |
| modify | `prop-schema.ts` | New `blocks` kind. `UrlPropSchema.asset?: 'images' \| 'media'`. Discriminating `oneOf` diagnostics |
| modify | `ir.ts` | `IrNode.slots?`, `when?`, `data?`. `IrDocument.datasets`. `IrTheme.recipes?` |
| modify | `normalize.ts` | Slot lists, `accepts`/`parents` enforcement, `visibleWhen`, `datasets`, block data, `theme.recipes`, module `check` hook |
| modify | `bounds.ts` | Add `maxDatasets`, `maxDatasetRows`, `maxDatasetFields` (mirroring `DATA_LIMITS`) |
| modify | `render.ts` | Module renderers and features, `renderSlot`, the `visibleWhen` wrapper, `'state'` feature collection, schema-driven `collectOrigins`, `recipeCss` hook in `buildCss` |
| modify | `blocks.ts`, `showcase-blocks.ts` | Remove the moved renderers. Spread module renderers into `RENDERERS`. Import tone helpers |
| modify | `runtime.ts` | `serializeJsonForScript(state)`. `fire()` stops at the nearest `[data-ak-id]`. `set-value` falls back to `detail.value`. Add a `STATE` part that evaluates `[data-ak-when]` in `syncBindings`. Append module scripts and boots in group order |
| modify | `verify.ts` | Merge module `FEATURE_MARKERS`/scripted features. Add `state: '.ak-when'` |
| modify | `index.ts` | Export `BlockCategory`, `BLOCK_CATEGORIES`, `THEME_RECIPE_SPECS`, `VALUE_FORMATS`, `MaterializedData` types |
| modify | existing roster entries (`url` props) | Set `asset: 'images'` on hero/showcase/bento/before-after/image/gallery srcs and on the video `poster`, and `asset: 'media'` on video/audio `src`. This must keep the current origin set identical (today: `render.ts:102-132` scans `src`, `poster`, `items[].src`, `before`, `after`). The validate-time gate in `src/spec/network-policy.ts` (`networkAllows`, `imageReferenceAllowed`) must use the same asset walk, so a nested remote image fails at validate with its nested path, not at compile with `$` |
| modify | `tests/unit/fixtures.test.ts` | Change `toEqual([...])` to `toEqual(expect.arrayContaining([...]))` so WPs can add fixtures without editing it |
| create | `tests/unit/nested-composition-normalize.test.ts`, `tests/unit/visible-when.test.ts`, `tests/unit/block-modules-registry.test.ts`, `tests/unit/backward-compat.test.ts`, `tests/unit/runtime-state-escape.test.ts` | |
| create | `fixtures/rejected/nested-raw-markup.yaml` | An `html:` key inside `items[0].blocks[0]`. Expects POLICY_VIOLATION |

### Contracts

```ts
// prop-schema.ts — new kind
export interface BlocksPropSchema extends PropSchemaBase {
  kind: 'blocks';
  minItems?: number;             // default 1
  maxItems?: number;             // default 40
  accepts?: readonly string[] | '*';
}
// validateProp('blocks'): checks array + count only and RETURNS undefined (the list never enters props).
// propSchemaToJsonSchema('blocks'): { type:'array', minItems, maxItems, items:{ $ref:'#/$defs/block' } }.
// Allowed positions: a top-level block prop, or a field of a `list(obj(...))` prop. Deeper nesting is rejected at registration.

// oneOf: if exactly one option matches the value's JSON shape (array/object/string/number/boolean),
// validate against it directly with full diagnostics. For objects, discriminate by a required `type`
// enum field when present. Only otherwise fall back to the generic message.

// block-module.ts
export type BlockCategory = 'layout'|'content'|'data'|'interaction'|'media'|'showcase'|'engineering'|'product';
export const BLOCK_CATEGORIES: readonly BlockCategory[];
// roster.ts BlockDefinition additions (required unless marked):
//   category: BlockCategory; tags: readonly string[] (≤6, kebab); useCases: readonly string[] (≤4, ≤40 chars)
//   parents?: readonly string[]      // allowed direct parent types (e.g. grid-item → ['grid'])
//   filterable?: boolean             // emits rows with data-ak-filter-item + data-ak-row JSON
//   data?: { required: boolean; description: string }  // accepts dataRef | data, + transform
export interface CheckContext {
  bag: DiagnosticBag;
  byId: ReadonlyMap<string, IrNode>;
  state: Record<string, JsonValue>;
  datasets: Record<string, DataRow[]>;
}
export interface BlockModule {
  definition: BlockDefinition;
  render(node: IrNode, context: RenderContext): string;
  check?(node: IrNode, context: CheckContext): void;   // runs in postChecks, in IR order
}
export interface FeatureModule {
  name: string;                 // kebab; unique across core + modules
  marker: string;               // substring that must appear in css (verify.ts, both directions)
  css: string;                  // token-driven; emitted only when used; animations gated on (prefers-reduced-motion:no-preference)
  script?: { code: string; boot?: string };   // ES5 style like runtime.ts; boot e.g. 'wireDataTables();'
  announces?: boolean;          // needs the live region
}
export interface BlockGroup { name: string; blocks: readonly BlockModule[]; features: readonly FeatureModule[] }

// render-context.ts
export interface RenderContext {
  ir: IrDocument; theme: ResolvedTheme; features: Set<RuntimeFeature>;
  diagramAdapter?: DiagramAdapter; warnings?: Diagnostic[];
  renderChildren(node: IrNode): string;
  /** Renders IrNode.slots[key]; '' when absent. Children are wrapped for visibleWhen like renderChildren. */
  renderSlot(node: IrNode, key: string): string;
  byId(id: string): IrNode | undefined;
}
export function slotKey(prop: string, index?: number, field?: string): string; // 'aside' | 'items[2].blocks'

// ir.ts additions
interface IrNode {
  slots?: Record<string, string[]>;   // set only when non-empty, so existing IR is unchanged
  when?: Condition;
  data?: MaterializedData;
}
interface IrDocument { datasets: Record<string, DataRow[]> }
interface IrTheme { recipes?: Record<string, string> }

// conditions.ts
export type Condition =
  | { path: string; op: 'equals' | 'notEquals'; value: DataScalar }
  | { path: string; op: 'in' | 'notIn'; value: DataScalar[] }      // ≤ 20 values
  | { path: string; op: 'truthy' | 'falsy' };
export function validateCondition(value: unknown, path: string, bag: DiagnosticBag,
  state: Record<string, JsonValue>): Condition | undefined;
export function evaluateCondition(condition: Condition, state: Record<string, JsonValue>): boolean;
// Author shape: visibleWhen: { path: state.metric, equals: cost }. Exactly one operator key.
// `path` must satisfy isSafeStatePath (actions.ts). If the path's first key is not declared in `state`,
// that is a WARNING, not an error.

// theme/recipes.ts
export const THEME_RECIPE_SPECS = {
  cards: ['raised','flat','outlined'], sections: ['ruled','divided','plain'],
  tables: ['default','ledger','minimal'], charts: ['default','minimal'], hero: ['default','compact'],
  metrics: ['default','headline'], media: ['default','framed'], callouts: ['tinted','outlined'],
} as const;   // first value = default
export function validateThemeRecipes(value: unknown, path: string, bag: DiagnosticBag): Record<string,string>;

// Filterable row contract (WP3, WP5 and WP8 rely on it)
// A filterable block marks each row with: data-ak-filter-item, and data-ak-row='{"field":"raw value",...}'.
// The value is JSON, escaped by renderAttributes. A helper lives in src/render/block-helpers.ts:
export function filterRowAttributes(row: DataRow): AttributeValue;
```

Normalize flow for one block, in order:

1. Extract `type`, `blocks`, `visibleWhen`, plus `dataRef`/`data`/`transform` when `definition.data` is set.
2. Validate props. `blocks`-kind fields are dropped from props.
3. Collect slot lists in schema-key order, then item index.
4. Build child nodes for `blocks` (→ `children`) and for each slot (→ `slots[key]`), with
   `parentId = node.id`, `depth + 1`, and the path `…items[1].blocks[0]`.
5. Enforce `accepts` (the child's type is in the list) and `parents` (the child's
   `definition.parents` includes the parent type). The diagnostic is `SPEC_VALIDATION_ERROR` at the child's
   `.type` path, with `details.allowed`.
6. Materialize `node.data`.
7. A node with `when` adds the feature `'state'`.

`postChecks` then calls `module.check` for every module node.

Render flow:

- `renderChild(child)`: when the child has `when`, wrap it as
  `<div class="ak-when" data-ak-when="{json}" [hidden when the initial state evaluates false]>…</div>`.
- `renderChildren` and `renderSlot` both use `renderChild`.
- CSS for the `state` feature: `.ak-when{display:contents}.ak-when[hidden]{display:none!important}`.
- The runtime's `syncConditions()` toggles `hidden` after every `setPath`.

JSON schema additions (`registry.ts`):

- top-level `datasets`;
- per-block `visibleWhen` on every block;
- `dataRef`/`data`/`transform` on blocks with `definition.data`;
- `theme.recipes`;
- the `blocks` kind.

Run `pnpm schema:generate` and commit the result. W0 is the only package that commits generated files.

Category table for the existing 54 blocks. Tags and useCases are W0-A's call: ≤6 tags, ≤4 useCases, terse.

| Category | Blocks |
| --- | --- |
| layout | page, section, stack, grid, split, spacer, divider, card |
| content | heading, text, rich-text, quote, code, badge, kbd, key-value, alert, callout, hero, steps, timeline, list, card-grid |
| data | stats, progress, table, comparison, risk-matrix, chart, kpi, checklist |
| interaction | tabs, accordion, carousel, toolbar, button, link, slider, search, dialog |
| media | image, gallery, video, audio, before-after |
| showcase | bento, marquee, showcase, cta |
| engineering | terminal, file-tree, diff-summary, code-review, diagram-panel |

### Steps

1. Merge W0-B, or rebase onto it.
2. Mechanical moves (helpers, modules, CSS and runtime strings, tone). Run `pnpm build && pnpm snapshots:check && pnpm gallery:check`. Both must pass **without regeneration**. Commit.
3. Add the metadata fields and categories, then the registration validation. Run the tests and commit.
4. Add the `blocks` kind, slots and the accepts/parents enforcement in IR and normalize, then `renderSlot`. Test this with a test-only `BlockGroup` passed to an exported `buildRegistry(groups)` factory (in `registry.ts`), and `normalizeSpec`/`compile` accept an optional registry. No production block changes in W0.
5. Add `visibleWhen`, the `state` feature, the runtime state part, the escape fix, `fire()` scoping and the `set-value` fallback.
6. Wire in datasets and block data from W0-B.
7. Add the `theme.recipes` envelope and the `recipeCss` hook.
8. Make `collectOrigins` schema-driven through `asset` flags, then the oneOf discrimination.
9. Regenerate the schema, snapshots and gallery. Only the runtime script body may differ; diff with `<script>…</script>` stripped and assert zero differences. Commit the artifacts.

### Acceptance

- [ ] With `<script>` bodies stripped, `fixtures/snapshots/*` and `docs/gallery/*.html` are byte-identical to the
  pre-W0 versions (`git diff` plus a strip script).
- [ ] `pnpm verify`, `schema:check`, `snapshots:check` and `gallery:check` are green.
- [ ] The test-only module proves: a nested list produces `IrNode.slots`, IDs are stable across 3 runs, an error
  in a nested prop gets a path like `$.blocks[0].items[1].blocks[0].title`, `accepts`/`parents` diagnostics fire,
  nested `runtimeFeatures` are collected, a nested remote image is gated by policy and its origin reaches the CSP,
  and nested blocks count toward `maxBlocks`.
- [ ] `visibleWhen`: each operator validates. A bad operator or a path like `window.x` is rejected with a path.
  Compile-time initial `hidden` is correct. Script-off markup shows the initial view.
- [ ] A state value of `"</script><b>x"` cannot close the script (unit test).
- [ ] Datasets: a `dataRef` on a test module materializes rows, and `transform` applies.
- [ ] Every fixture that predates W0 still validates with zero errors and zero new warnings (`backward-compat.test.ts`, run over `fixtures/pages`).
- [ ] Registration rejects a duplicate type, a duplicate feature, and a feature whose css lacks its marker.

## Risks

| Risk | L×I | Mitigation |
| --- | --- | --- |
| Moving blocks silently changes output | M×H | Byte-identical gate in step 2, before any behavior change |
| Slot children render twice, or never | M×H | `children` and `slots` are disjoint by construction; a unit test counts `data-ak-id` occurrences |
| `fire()` scoping breaks existing bindings | L×H | Existing `tests/browser/actions.spec.ts` and `interactions.spec.ts` must pass unchanged |
| Widening `RuntimeFeature` to string loses type safety | M×M | Validate at registration and in the registry unit test |
| W0 critical path delays everyone | H×M | W0-B in parallel; the step list is mechanical-first |
| Dataset row keys collide with forbidden keys | L×L | Document it; the existing scan reports a POLICY_VIOLATION with the path |

Rollback: W0 is two merges. Reverting it requires reverting every wave 1 merge first, then regenerating the
artifacts.

Report: `reports/w0-a-notes.md`, `reports/w0-b-notes.md` (changelog lines, DESIGN notes, deviations).
