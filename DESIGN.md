# Design

**Essence:** striking, editorial documents that a person trusts at a glance and an agent can generate without thinking about presentation.

The product's interface is the HTML the compiler emits. Every rule below lives in `src/render/` (the base, feature, chart and recipe sheets), in a block group's `*-styles.ts` under `src/blocks/`, or in `src/theme/`, and applies to every artifact under every preset.

## Art direction

- **Modern and professional.** The layout is a single 1100px column with generous whitespace and one accent color per preset. Surfaces use hairline borders and soft layered shadows.
- **Trustworthy.** Numbers use tabular figures, charts always carry a data table, and motion only decorates: every page reads completely with motion reduced, in print and in a screenshot.
- **One period cue.** Mono uppercase eyebrows and labels act as the "catalog index card" voice. The hero eyebrow carries a short accent rule, which is the repeated brand motif. Every top-level section opens on a hairline that carries the same accent tab.
- **One depth strategy per surface.** Surfaces use a hairline border plus the `elevation-card` shadow. In dark schemes `--ak-fill` adds a faint top-lit sheen, because the fixed shadows are invisible there. Status blocks use a tinted fill and a tone glyph, never a side stripe.
- **Offline by contract.** Each preset embeds one SIL OFL display face as an inline `data:` WOFF2 (Latin, plus Vietnamese only when the text needs it) in front of a system stack. Nothing is fetched: no CDN, no remote font, no remote image in CSS. See `docs/themes.md#fonts`.

## Tokens

Themes are typed data (`src/theme/tokens.ts`); the stylesheet consumes these tokens only through `var(--ak-*)`.

| Group | Tokens | How the stylesheet uses them |
|---|---|---|
| Color | `color-*` (12) | Surfaces, text and status colors. Tints come from `color-mix()` over tokens, so presets never need extra colors. |
| Type | `font-heading`, `font-body`, `font-mono`, `font-size-base`, `font-scale`, `line-height`, `measure` | Hero h1 = base × scale⁵, other h1 = scale⁴, section h2 = scale², nested block titles = scale^1.2, h3 = scale¹. A fixed fallback covers engines without `pow()`. At ≤768px, h1 drops to scale³ (hero scale^3.5). |
| Spacing | `space-unit`, `density` | The block gap `--ak-gap` is 2, 3 or 4 units (compact, comfortable or spacious). Top-level section breaks use 2.5× (2× at ≤768px), and titled blocks inside a section use 1.75×. |
| Radius | `radius-small`, `radius-medium`, `radius-large` | Controls use small or medium, cards and charts use medium, and dialogs and carousel slides use large. |
| Elevation | `elevation-card`, `elevation-popover` | Each maps to fixed two-layer shadows (none, subtle, medium or strong). |
| Motion | `motion-duration`, `motion-easing`, `motion-policy` | Every transition uses these. Reduced motion and `motion-policy: none` set the duration to 0ms. |

## Charts

- Each SVG is sized to its content: 800×300 for cartesian charts, 240 for radial charts, 72 for a sparkline, and 32px per progress row.
- Cartesian charts sit in a `.ak-chart-canvas` with a 560px minimum width. On a phone the chart scrolls sideways instead of shrinking its labels.
- Give a chart a column of about 610px or more on wide screens (the canvas minimum plus card padding); narrower, it scrolls inside its card. In a narrow grid column pair the chart with a non-chart block such as `metric-breakdown`, as the `dashboard` page recipe does.
- A long category axis keeps about eight evenly spaced labels, always including the first and the last category.
- Area fills are a per-chart vertical gradient (`ak-grad-<node id>-<series>`) that fades to transparent.
- Every bar and point carries a value label that appears on hover or focus. Hovering a bar dims the other bars.
- Bars use a per-series vertical gradient, full strength at the cap and 62% at the baseline.
- Axes end on clean ticks (1, 2, 2.5 or 5 × 10ⁿ) with dashed gridlines and grouped numbers. A step finer than 0.01 gets the decimals it needs, so ticks never repeat.
- Series colors are classes `ak-chart-s0…s5`. s0 is the accent. Where `oklch(from …)` is supported, s1–s5 are hue rotations of the accent. Otherwise they fall back to the status tokens.
- A legend appears whenever color carries meaning: more than one series, or any pie or donut chart.
- Geometry is rounded to two decimals so output stays byte-deterministic.

Kinds that bind data, use an overlay, or arrived after the first seven (code in `src/blocks/chart/` and `src/render/chart-*.ts`):

- They are labelled by their own `<title>` and `<desc>` through `aria-labelledby`; the original kinds keep `aria-label`. A bound chart builds its fallback table from the bound rows, formatted like the axes.
- Encoded cartesian charts reserve room for axis titles in mono uppercase: the y title above the value ticks, the x title centred under the categories, on an 800×300 frame with a 68px left margin.
- Author bounds (`y.min`/`y.max`) set the value ticks. Out-of-range marks clamp to the plot edge, and the check warns. Whole-number currency ticks drop their cents.
- Stacked bars use flat series fills, not the bar gradient, so segments do not band. `stacked-bar-100` shows each segment's share, with the raw value in its title.
- Histogram bins snap to a clean step whose count is closest to `bins`. Bins are [a, b) and the last is closed. Values that clean steps cannot separate fall into one bin.
- Waterfall colours carry meaning, so the legend always shows Increase (success), Decrease (danger) and Total (ink), and dashed connectors join the running totals.
- Heatmap intensity uses five quantized classes, `ak-chart-h0…h4`, which set `--ak-heat` as the accent's fill-opacity; there is no inline fill. Missing cells show the track colour, and the legend lists the five ranges.
- Treemap is squarified in category order (descending by default). Cells are tinted 22% with their series colour and stroked with it; labels use text tokens so contrast never depends on the hue. Cells under 64×34 show no text, and there is no legend because colour only separates neighbours.
- Funnel bars are centred, with the stage on the left and value · conversion on the right. Gauge is a 180° track with the value arc in the accent and the target tick in the text colour.
- Markers are dashed muted rules with a mono label. Annotations are accent dots numbered in `accent-contrast`, also listed in `ol.ak-chart-notes` under the legend.
- Labels drawn over filled marks carry `ak-chart-value--halo`, a surface-coloured paint-order stroke.
- Wide-plot kinds keep the 560px canvas minimum and scroll sideways on a phone.

## Diagrams without an adapter

- When the connections form one simple chain, the fallback draws a flow. Nodes become cards joined by arrows, and each connector carries its label in a pill.
  - The first node has an accent border, and the last is filled with the accent.
  - At ≤640px the flow turns vertical.
- Any other graph (branches, cycles, unknown ids) shows its nodes as cards plus an explicit `from → to` list. Arrows are never drawn between nodes the spec does not connect.
- The code lives in `src/render/diagram-fallback.ts`.

## Diagrams with an adapter

- The adapter's SVG sits in a card panel at its natural size. A wide drawing scrolls sideways inside the panel, with the same edge shades as a wide table, and prints scaled to the page width.
- The structured description folds behind a closed "Text description" disclosure, so it does not repeat the drawing. It prints open.
- Adapter styles apply only inside the diagram's canvas, and adapter motion stops under reduced motion and in print. See `docs/diagram-adapter.md`.

## Signature layer

The signature layer is `src/render/signature-styles.ts`, which ships on every page.

- **Display type.** At ≥769px the hero title is fluid, from `font-scale^5` to `font-scale^7.2` (capped at 6.2vw), with -0.045em tracking. Headings balance their lines and paragraphs use `text-wrap: pretty`.
- **Entrance.** There is one orchestrated entrance: hero children rise in sequence, timed from the motion token.
- **No scroll reveal.** Blocks never start hidden. A scroll-triggered reveal leaves full-page captures, PDFs and thumbnails blank. The terminal and KPI entrances (see the effects layer) play only after an observer marks the block as arriving; until then the block shows its final state.
- **Links in prose.** They draw a full-strength underline from left to right on hover, over a faint resting underline.
- **Cards that end in a link.** The link sits at the bottom with an arrow that nudges on hover. If the card has no other control, the whole card is the link target, lifts 3px, and shows the focus ring when the link is focused.
- **Hover uses `translate`.** Hover effects use the `translate` property, not `transform`, so they never fight an animation.

## Effects layer

`src/render/effects-styles.ts` ships on every page, after the signature layer. The runtime part `wireEffects()` ships whenever the page emits a script.

- **Hero atmosphere.** A blurred aurora behind the hero is built from the accent, info and success tokens, so it follows the theme and the color scheme. It drifts slowly.
- **Title reveal.** The hero title is split into word wrappers (`.ak-word`) that rise in sequence. The spaces stay as text, so the heading's text content is unchanged.
- **Grain.** A 160px fractal-noise tile (an inline `data:` SVG, allowed by `img-src data:`) sits behind the content at 5% opacity. It covers the whole document, so full-page captures are uniform.
- **Spotlight.** On cards, bento tiles and KPI cards, a soft accent light follows the pointer. The runtime writes `--ak-mx`/`--ak-my` through CSSOM, which the CSP allows.
- **Count-up.** Stat and KPI values count up when they arrive, but only when the text is a plain number with an optional prefix and suffix (`342`, `70.2 kB`, `$1,284`). They always settle on the authored text. Values that start with letters, such as versions, are left alone.
- **Image settle.** Images in bento tiles scale from 1.12 to 1 as they enter, using `animation-timeline: view()`. Images in showcase frames drift ±3.5% (parallax) while they cross the viewport. Browsers without view timelines skip both.
- **Hero shot.** A hero with `src` frames the shot in browser chrome below the copy, over a blurred accent glow. The frame starts tilted back (`rotateX(16deg)`) and straightens as the page scrolls, on a view timeline. `align: center` centers the copy.
- **Theme reveal.** Where `document.startViewTransition` exists and motion is allowed, the new scheme is revealed as a circle growing from the toggle. The runtime writes the origin to `--ak-vt-x`/`--ak-vt-y`; the `theme` sheet owns the animation. Otherwise the scheme switches instantly.
- **Primary buttons** get a light sweep on hover.
- Shared pieces that more than one feature uses live here: window dots, the browser frame (`.ak-frame-bar`, `.ak-frame-view`), and the checklist.

## Night band

`src/render/surface-styles.ts`, emitted only on pages that use it: a section with `surface: inverse`, or a `cta`.

- Inside `[data-surface="inverse"]` every colour token is redeclared with the theme's own dark value, written as a literal (aliasing the root variables would be cyclic). `--ak-tint`, `--ak-ring` and `--ak-fill` are recomputed there, because an inherited custom property carries the root's light result.
- So nested blocks need no inverse variants: cards, KPIs and charts recolour from tokens, as in dark mode. `color-scheme: dark` covers native controls.
- The panel is a rounded dark gradient with an accent glow, a faint 48px grid masked to the top, and a deep shadow. In dark mode the same palette reads as a raised panel. It prints with its colours.

## Showcase blocks

The renderers are in `src/render/showcase-blocks.ts` and the feature sheets in `src/render/showcase-styles.ts`; `bento` moved to `src/blocks/composition/`.

| Block | Feature | Notes |
|---|---|---|
| `bento` | `bento` | Four-column dense grid. Tiles are `small`, `wide`, `tall` or `large`, and can hold an image, a gradient display figure, an eyebrow, a title and text. 2 columns at ≤900px, 1 at ≤560px. |
| `marquee` | `marquee` | The first track is the real list. A duplicate `aria-hidden` track makes the loop seamless and appears only while it moves. Even items are outlined. Hovering pauses it. Under reduced motion or in print it is a static wrapped list. |
| `terminal` | `terminal`, `copy` | An always-dark window (fixed palette, accent-tinted) with command, output, comment, success and error lines. Commands type in and other lines fade in, staggered 80ms apart; lines past the twelfth share its delay, so a session of any length is fully drawn about 1.4s after it arrives. The body grows to its last line. A caret blinks. Copy copies the text without the prompt glyphs. |
| `file-tree` | `tree` | Built from flat paths. Folders sort first; single-folder chains fold into `a/b/`. Uses native `<details>` folders, status pills in text, and a summary count. |
| `before-after` | `before-after` | Without script, two images side by side. With script, an overlay clipped at `--ak-split`, driven by a transparent native range input (keyboard, pointer drag, touch) and a decorative handle. |
| `kpi` | `kpi` | Value, signed delta, and a verdict from `trend` against `good` (green, red or neutral, also stated in text), plus an edge-to-edge sparkline that draws in. |
| `showcase` | `showcase` | Copy beside a capture in browser chrome, with an accent glow. It tilts slightly on hover. `align: media-left` flips the sides. It stacks at ≤900px. |
| `checklist` | (base) | A done count, a progress meter, and items with a drawn check. Each state is also stated in text. |
| `cta` | `cta` | A closing panel on the night band: eyebrow, an oversized gradient title (`clamp(2.5rem, …, 5.75rem)`), text, and up to three pill links. A slow accent orb drifts behind it. |

Bento tiles with an image show it as a panel that bleeds off the tile's bottom-right edge, over an accent-tinted backdrop, so crops of different shapes all read as details of a real page. `scripts/capture-demo-media.mjs` records those crops at 2x (`crop-*.webp`).

Images in these blocks go through the same network gate as `image` and use the `images` capability. `collectOrigins` now treats only `video` and `audio` as `media`, and also scans `before`/`after`.

## Document chrome

- A page with three or more titled top-level sections gets an "On this page" outline (the `outline` feature).
  - At ≥1280px it sits in a sticky right column.
  - Below 1280px it is hidden.
  - A scroll-spy marks the current section with `aria-current`.
- A 3px reading-progress rail is driven by `animation-timeline: scroll(root)`. Browsers without scroll timelines do not show it.
- Every page ends with a colophon: the title, the generator version and "Back to top". It contains no dates, so output stays deterministic.
- Code blocks number their lines when there are two or more, show the language as a pill, and have a Copy button that shows a ✓ for 1.6s.
- Numeric table columns align right.
- A table wider than the column scrolls inside its frame, never the page. A soft shade marks each edge that has more beyond it, driven by a scroll timeline, so a table that fits shows none.
- Status values map to toned badges: diff status, risk level, and review kind. Diff line counts are signed and colored, and zero stays muted.

## Readable before the runtime

Interactive blocks ship in their readable form and never carry a static `hidden`. The runtime upgrades a block and then sets a ready attribute (`data-ak-tabs-ready`, `data-ak-carousel-ready`, `data-ak-table-ready`, `data-ak-lightbox-ready`, `data-ak-ready`); only CSS keyed to that attribute applies the interactive layout. A page without scripts, in print or in a screenshot taken before the runtime runs is therefore complete.

- **Tabs.** Every panel is visible and opens with a `.ak-tab-panel-title`. The tablist stays hidden until the container is ready; then the titles hide and inactive panels get `hidden`. Print shows every panel with its title and hides the tablist.
- **Carousel.** All slides sit in a horizontal scroll-snap strip with the controls hidden; when ready, one slide shows at a time. Print stacks every slide.
- **Accordion print.** Closed sections print open through `::details-content{content-visibility:visible}`, with no print script. Engines without `::details-content` print them closed.
- **`visibleWhen`.** The compiler evaluates conditions against the initial `state` and wraps the block in `<div class="ak-when" data-ak-when="{json}" [hidden]>`. The wrapper is `display:contents`, so it never affects grid or flex layout. `.ak-when[hidden]{display:none!important}` lives in `FEATURE_CSS.state`, never in `BASE_CSS`. Layout and controls CSS match the wrapper as `[data-ak-when]`, because `.ak-when` is the `state` feature's verify marker.
  - Because the wrapper is not a block, the base `.ak-block + .ak-block` gap skips it. `FEATURE_CSS.state` restores `--ak-gap`, and the 1.75× and 2.5× section breaks, for a block inside a wrapper and for a block after one whenever a visible block or wrapper comes earlier. The sibling part sits in `:where()`, so flex and grid container resets still win; the filter bar's control grid alone cancels the gap for a wrapped control.
  - The page outline lists only always-visible sections, never one behind `visibleWhen`.
- **Controls.** Without scripts a control renders `disabled` at its initial value with a muted note that it needs JavaScript; a filter bar carries one note for all its controls and shows the total count with Reset hidden. Print hides every control and filter bar, and the filter-bar runtime unhides every row on `beforeprint` and re-applies the filter on `afterprint`, so a printout is never silently partial.
- **Sortable headers** become buttons only at runtime, so a page without scripts never shows a dead control.

## Nested composition

Tabs, accordion sections, carousel slides and bento tiles hold blocks in `items[i].blocks` (`src/blocks/composition/`).

- The item's text, when present, comes first; the blocks follow in a `<div class="ak-nested">` with the usual `.ak-block + .ak-block` gap. A text-only item keeps its earlier markup byte for byte.
- A tab panel with blocks drops the `--ak-measure` cap so charts and tables use the full column; its paragraph keeps the cap. A carousel slide with blocks aligns to the top and caps nested images at `min(60vh, 420px)` with `object-fit: contain`.
- Accordion and carousel rules use child combinators (`.ak-accordion>details`, `.ak-carousel-slide>h3`), so a nested block, including another `<details>`, keeps its own look. Specificity is unchanged, so recipe sheets still win by cascade order.
- **Heading levels are an accepted limitation.** Nested blocks keep their own heading levels and items add none, so a nested block's `h3` sits at the same level as a carousel slide title.

## Motion

- Durations come from the token (160ms by default). State changes transition color, background, border, shadow, transform and opacity.
- Press feedback is a 1px translate. The dialog enters with a 6px rise. Nothing blocks input.
- Only three things loop: the hero aurora (a slow 18s drift), the CTA orb (16s), and the marquee (pauses on hover). Everything else plays once or follows scroll.
- Every animation is gated on `prefers-reduced-motion: no-preference`. `wireEffects()` does nothing under reduced motion, and print turns every animation off.

## Responsive

- ≤768px: grids drop to 2 columns, splits and comparisons stack, and touch targets reach 44px.
- ≤480px: grids drop to 1 column, stats show 2 per row, and key-value lists stack.
- Grid columns 7–12 drop to 2 at ≤768px and 1 at ≤480px, like 1–6. `columns: auto` uses `repeat(auto-fit,minmax(min(100%,<width>),1fr))` at every width and one column at ≤480px.
- **Placement is attribute CSS, never inline style.** The CSP forbids inline styles, so spans, periods, percentages and pin positions are emitted as data attributes (`data-ak-span`, `data-ak-start`, `data-ak-pct`, `data-x`) and matched by static rules generated over fixed ranges.
- **Tracked grids.** A grid holding a `grid-item` gets `data-ak-tracks="12"`. Wide screens apply `span`, `start` and `rowSpan`. At ≤768px `tabletSpan` applies, `start` is dropped and plain children pair up. At ≤480px everything is full width unless `mobileSpan` is set, and `rowSpan` is dropped. The tracked grid keeps its 12 tracks through a more specific rule in its feature sheet, so the base single-column rule stays unchanged. DOM order is always visual order: there is no `order`.
- **Semantic layouts** (`sidebar-layout`, `main-aside`, `rail-layout`) are one column below 769px in DOM order: the sidebar first (last with `side: end`), the aside after the main column, and the rail first as a strip that scrolls inside itself. From 769px they are two columns; from 1024px wide and 640px tall, on screens only, the aside and the rail are sticky. Print shows them static and stacked.
- Scroll strips (`.ak-kanban`, `.ak-roadmap`) are `position:relative`, so a visually hidden `.ak-sr` inside them cannot resolve against the viewport and widen the page.
- A long unbroken token, such as a path or an env var list, breaks inside its line instead of widening the page. Key-value values may break anywhere in the token.
- Checked at 1440×900, 768×1024 and 375×812 with no horizontal overflow.

## Data blocks

**Data table** (`src/blocks/data-table/`, feature `data-table`) reuses the base table frame (`.ak-table-wrap`, edge shades, `.ak-num`).

- The column `type` picks the format and alignment; numeric types align to the end and typed cells do not wrap. The first column is the row header and the card title on phones.
- Badges take their tone from the authored `tones` map, then an outcome map (pass/fail/flaky/skipped), then the shared value tones. Progress is a native `<meter>` beside its value text. A sparkline is the KPI geometry over a 14% tint, with a visually hidden list of its values.
- Sorting compares raw values, numeric when every value is a number; ties keep their order and empty cells sort last. The sorted column carries `aria-sort` and an accent arrow, and every change is announced. The compiler marks a column already sorted when the emitted rows run one way on it.
- Search appears past 10 rows, unless a filter bar targets the table: then the bar owns filtering and the table emits no search box, row count or "no match" note, decided at compile time from the IR. A miss gets `data-ak-dt-miss`, not `hidden`, so a filter bar's `hidden` composes with it. The header sticks only above 560px, past 12 rows, and only when the table fits its frame.
- At ≤560px each row becomes a card labelled through `td::before{content:attr(data-label)}` (a `hidden` row stays hidden), and the header becomes a row of 44px sort chips once ready. Print hides search and arrows and shows every row.

**Controls and filter bar** (`src/blocks/controls/`, features `controls` and `filter-bar`).

- A control is a `.ak-control` (a `<fieldset>` with a `<legend>` for a radio group) holding a visible `<label for>`, the native input and an optional hint. Fields use the surface, border and radius-medium tokens; focus uses `--ak-ring`; a switch is a restyled native checkbox with `role="switch"`. Targets are 40px, 44px at ≤768px.
- The filter bar is a card (`--ak-fill`, radius-large, card elevation) with an optional title, an `auto-fill` grid of controls (190px minimum) and a footer with the mono count and Reset. The count says "rows" for a `data-table` target and "items" otherwise, and is announced through the shared live region.

## Widgets

Each widget ships its own CSS-only feature sheet, so a page carries only the sheets it uses. Meaning never relies on colour alone: every verdict, status and tone is also text.

| Block | Code | Notes |
|---|---|---|
| `kanban` | `src/blocks/engineering/` | One scroll strip of `minmax(232px,1fr)` columns; at ≤768px each column is 85% wide and snaps. A labelled region holding a list of lists. |
| `roadmap` | `src/blocks/engineering/` | A period grid placed by attribute rules. Status is a tinted fill plus dot and text; planned items are dashed. At ≤560px and in print it becomes an agenda by period. No "today" marker. |
| `test-results` | `src/blocks/engineering/` | A tinted summary with a verdict glyph, a decorative SVG bar and counts in a `<dl>`. Failing suites come first, and suites with failing or flaky cases open. |
| `log-viewer` | `src/blocks/engineering/` | A monospace `subgrid`, so time, level and source align. A shared ISO date is stated once in the head. Error and warn rows get a faint wash. |
| `api-endpoint` | `src/blocks/engineering/` | Tinted method tones (GET info, POST success, PUT/PATCH warning, DELETE danger) and the core code block for bodies. |
| `schema-viewer` | `src/blocks/engineering/` | Nested lists on a hairline guide; branches are open `<details>`, implicit parents read as an italic muted `object`. |
| `benchmark-comparison` | `src/blocks/evidence/` | A captioned table with a signed delta (U+2212 minus) over the percentage, and a toned verdict badge that states the verdict. Rows become cards at ≤560px. |
| `metric-breakdown` | `src/blocks/evidence/` | A 14px pill bar sized by `[data-ak-pct]` rules, in accent hue rotations (parts 7–12 add a hatch). The list is authoritative; the bar is `aria-hidden`. |
| `annotated-image` | `src/blocks/evidence/` | Pins placed by `[data-x]`/`[data-y]` rules on a 5% grid. The numbered notes below repeat the pins and print. |
| `references` | `src/blocks/evidence/` | An `<ol>` of `<cite>` titles with stable `#ref-<id>` anchors; `:target` gets an accent tint, and print appends each external URL. |
| `pricing` | `src/blocks/product/` | Auto-fit cards. The highlighted plan has an accent border and glow, a mono "Recommended" pill and a primary CTA. |
| `feature-matrix` | `src/blocks/product/` | The shared table frame with a sticky row-header column. A check sits in a success-tinted disc; hidden words say "Included" or "Not included". |
| `testimonial` | `src/blocks/product/` | One quote is a featured panel at scale² with an oversized accent mark; two or more form auto-fit cards. |
| `logo-cloud` | `src/blocks/product/` | Hairline tiles, grayscale at 75% until hover. A blocked logo becomes its name as a wordmark. Print shows full colour. |
| `people` | `src/blocks/product/` | Cards with a 56px avatar, or initials on an accent disc when there is none or it is blocked. |
| `calendar` | `src/blocks/product/` | A 7-column hairline grid with tinted weekends and tone chips (no side stripe). An agenda at ≤560px. Integer date math; nothing depends on the current date. |
| `gallery` | `src/blocks/product/` | Every thumbnail links to its full-size figure; the compiler always offers it because the grid crops to 16:9. Without scripts a `:target` overlay shows it; with scripts the figures move into a `<dialog>` with Previous/Next and arrow keys, entering with `@starting-style` when motion is allowed. Print shows the grid only. |

## Review

`decision` and `feedback` (`src/blocks/review/`, feature `review`) let a reader answer a plan inside the page.

- A decision is a card (`--ak-fill`, radius-large, card elevation) with the question as its `<legend>`, optional context, and one bordered row per option. The whole row is the click target. The checked row takes the accent border and `--ak-tint`. The recommended option starts checked and carries an info badge, so the choice is also text.
- The feedback panel is the same card: title, intro, the saved comments, a "General notes" field, and **Copy feedback** (primary) with a two-click **Clear** (ghost). Clear never opens a browser dialog.
- With scripts on, the runtime adds a mono uppercase pill **Comment** button at the right of every top-level section head, a primary **Comment** button under a text selection inside `main`, and a pill at the bottom right that counts comments and scrolls to the panel. It hides while the panel is on screen.
- The comment editor is a popover card at `elevation-popover` under its anchor. At ≤768px it is a sheet fixed to the bottom of the viewport. Escape cancels and returns focus; Ctrl or Cmd+Enter saves.
- Commented text is marked with `::highlight(ak-review)`, a 22% accent wash, where the CSS Custom Highlight API exists. The DOM is never changed to mark it. After a reload the runtime finds the quote again inside its block. Clicking marked text opens its comment.
- A section with a comment shows **Edit comment** in the accent with `--ak-tint`, and the button opens that comment. A section has at most one comment of its own.
- In the panel, each comment's location is a link with an accent ↑. It scrolls to the commented text (a 45% accent wash for 1.6s) or to the block (an accent outline for 1.6s) and moves focus there.
- A comment points at the top-level section, the block's own title, and code line numbers. The copied text is plain Markdown-like prose with numbered decisions and comments.
- Without scripts every input is disabled at its initial value with a muted note, and no Comment button exists. Print hides every control and keeps the questions, the answers and the saved comments; unchosen options print at 60% opacity.
- Comments, notes and answers are kept in `localStorage` under a key hashed from the page's IR, so a reload keeps them and changed content starts empty.

## Recipes

Recipes are the component dialects a preset or spec selects (`src/theme/recipes.ts` for the enums, `src/render/recipe-styles.ts` for the sheets, [docs/themes.md](./docs/themes.md#recipes) for the author view).

- Each non-default recipe becomes a `data-r-<surface>="<value>"` attribute on `<html>`, and its rules are scoped under `html[data-r-…]`. That specificity beats the base and feature rules without `!important`.
- A default value emits neither the attribute nor any CSS, so a page with default recipes keeps identical bytes.
- Stylesheet order is base, core features, module features, recipes, theme tokens, then the night band. Recipes follow every feature sheet because they restyle feature surfaces. A recipe sheet tied to a feature (`chart`, `kpi`, `data-table`) is emitted only when the page uses that feature, which keeps the verify marker check intact.
- Recipe selectors rely on these root classes, so renaming one is a recipe change: `.ak-card`, `.ak-surface`, `.ak-stats`, `.ak-stat`, `.ak-main`, `.ak-section`, `.ak-section-head`, `.ak-hero`, `.ak-eyebrow`, `.ak-table-wrap`, `.ak-media`, `.ak-gallery`, `.ak-callout`; `.ak-chart`, `.ak-chart-grid`, `.ak-chart-axis`, `.ak-chart-label`; `.ak-kpi-card`, `.ak-kpi-label`, `.ak-kpi-value`; and `.ak-data-table` with plain table descendants.
- `callouts: outlined` draws a full tone outline, never a side stripe. `charts: minimal` lightens labels through size and weight, not colour, so they keep AA contrast.
- Every built-in preset keeps body text at 7:1 or more on the background and both surfaces, and muted text, accent, tones and text on the accent at 4.5:1 or more, in both schemes (`tests/unit/theme-contrast.test.ts`). `data-console` is dark-first in palette only; the page still follows `prefers-color-scheme`.

## Voice

Plain, specific and dated. Lead with what the reader gets. Labels name things; they don't sell them.

## Do / don't

- Do add new visual treatment as CSS keyed to existing tokens. Don't add a token unless a preset genuinely needs to vary it.
- Do keep feature CSS in `FEATURE_CSS`. Don't put `.ak-chart`, `.ak-tabs` and similar selectors in `BASE_CSS`, because `verify.ts` fails the compile on that tree-shaking regression.
- Don't introduce colors outside tokens or remote assets. The one exception is the terminal's fixed dark palette, which is accent-tinted and lives in its feature sheet.
- Don't add motion that hides content before an observer has seen it arrive.
- Don't emit inline `style` for placement or sizing. Use a data attribute matched by static rules over a fixed range, or a CSSOM write from the runtime.
- Don't ship an interactive block with static `hidden`. Ship it readable and key the interactive layout to its ready attribute.
