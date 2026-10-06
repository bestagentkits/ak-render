# Design

**Essence:** striking, editorial documents that a person trusts at a glance and an agent can generate without thinking about presentation.

The product's interface is the HTML the compiler emits. Every rule below lives in `src/render/styles.ts`, `src/render/feature-styles.ts`, `src/render/charts.ts` or `src/theme/`, and applies to every artifact under every preset.

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
- Area fills are a per-chart vertical gradient (`ak-grad-<node id>-<series>`) that fades to transparent.
- Every bar and point carries a value label that appears on hover or focus. Hovering a bar dims the other bars.
- Bars use a per-series vertical gradient, full strength at the cap and 62% at the baseline.

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
- Axes end on clean ticks (1, 2, 2.5 or 5 × 10ⁿ) with dashed gridlines and grouped numbers.
- Series colors are classes `ak-chart-s0…s5`. s0 is the accent. Where `oklch(from …)` is supported, s1–s5 are hue rotations of the accent. Otherwise they fall back to the status tokens.
- A legend appears whenever color carries meaning: more than one series, or any pie or donut chart.
- Geometry is rounded to two decimals so output stays byte-deterministic.

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

The renderers are in `src/render/showcase-blocks.ts` and the feature sheets in `src/render/showcase-styles.ts`.

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

## Motion

- Durations come from the token (160ms by default). State changes transition color, background, border, shadow, transform and opacity.
- Press feedback is a 1px translate. The dialog enters with a 6px rise. Nothing blocks input.
- Only three things loop: the hero aurora (a slow 18s drift), the CTA orb (16s), and the marquee (pauses on hover). Everything else plays once or follows scroll.
- Every animation is gated on `prefers-reduced-motion: no-preference`. `wireEffects()` does nothing under reduced motion, and print turns every animation off.

## Responsive

- ≤768px: grids drop to 2 columns, splits and comparisons stack, and touch targets reach 44px.
- ≤480px: grids drop to 1 column, stats show 2 per row, and key-value lists stack.
- A long unbroken token, such as a path or an env var list, breaks inside its line instead of widening the page. Key-value values may break anywhere in the token.
- Checked at 1440×900, 768×1024 and 375×812 with no horizontal overflow.

## Voice

Plain, specific and dated. Lead with what the reader gets. Labels name things; they don't sell them.

## Do / don't

- Do add new visual treatment as CSS keyed to existing tokens. Don't add a token unless a preset genuinely needs to vary it.
- Do keep feature CSS in `FEATURE_CSS`. Don't put `.ak-chart`, `.ak-tabs` and similar selectors in `BASE_CSS`, because `verify.ts` fails the compile on that tree-shaking regression.
- Don't introduce colors outside tokens or remote assets. The one exception is the terminal's fixed dark palette, which is accent-tinted and lives in its feature sheet.
- Don't add motion that hides content before an observer has seen it arrive.
