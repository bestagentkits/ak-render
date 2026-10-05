# Design

**Essence:** quiet, editorial documents that a person trusts at a glance and an agent can generate without thinking about presentation.

The product's interface is the HTML the compiler emits. Every rule below lives in `src/render/styles.ts`, `src/render/charts.ts` or `src/theme/`, and applies to every artifact under every preset.

## Art direction

- **Modern and professional.** The layout is a single 1100px column with generous whitespace and one accent color per preset. Surfaces use hairline borders and soft layered shadows.
- **Trustworthy.** Numbers use tabular figures, charts always carry a data table, and nothing moves unless it explains a state change.
- **One period cue.** Mono uppercase eyebrows and labels act as the "catalog index card" voice. The hero eyebrow carries a short accent rule, which is the repeated brand motif.
- **Offline by contract.** Fonts are system stacks only. No webfonts, no CDN, and no images in CSS.

## Tokens

Themes are typed data (`src/theme/tokens.ts`); the stylesheet consumes these tokens only through `var(--ak-*)`.

| Group | Tokens | How the stylesheet uses them |
|---|---|---|
| Color | `color-*` (12) | Surfaces, text and status colors. Tints come from `color-mix()` over tokens, so presets never need extra colors. |
| Type | `font-heading`, `font-body`, `font-mono`, `font-size-base`, `font-scale`, `line-height`, `measure` | h1 = base × scale⁴, h2 = scale², h3 = scale¹. A fixed fallback covers engines without `pow()`. At ≤768px, h1 drops to scale³. |
| Spacing | `space-unit`, `density` | The block gap `--ak-gap` is 2, 3 or 4 units (compact, comfortable or spacious). Section breaks double it. |
| Radius | `radius-small`, `radius-medium`, `radius-large` | Controls use small or medium, cards and charts use medium, and dialogs and carousel slides use large. |
| Elevation | `elevation-card`, `elevation-popover` | Each maps to fixed two-layer shadows (none, subtle, medium or strong). |
| Motion | `motion-duration`, `motion-easing`, `motion-policy` | Every transition uses these. Reduced motion and `motion-policy: none` set the duration to 0ms. |

## Charts

- Each SVG is sized to its content: 640×260 for cartesian charts, 240 for radial charts, 72 for a sparkline, and 32px per progress row.
- Axes end on clean ticks (1, 2, 2.5 or 5 × 10ⁿ) with dashed gridlines and grouped numbers.
- Series colors are classes `ak-chart-s0…s5`. s0 is the accent. Where `oklch(from …)` is supported, s1–s5 are hue rotations of the accent. Otherwise they fall back to the status tokens.
- A legend appears whenever color carries meaning: more than one series, or any pie or donut chart.
- Geometry is rounded to two decimals so output stays byte-deterministic.

## Motion

- Durations come from the token (160ms by default). Only color, background, border, shadow, transform and opacity transition.
- Press feedback is a 1px translate. The dialog enters with a 6px rise. Nothing loops, and nothing blocks input.

## Responsive

- ≤768px: grids drop to 2 columns, splits and comparisons stack, and touch targets reach 44px.
- ≤480px: grids drop to 1 column, stats show 2 per row, and key-value lists stack.
- Checked at 1440×900, 768×1024 and 375×812 with no horizontal overflow.

## Voice

Plain, specific and dated. Lead with what the reader gets. Labels name things; they don't sell them.

## Do / don't

- Do add new visual treatment as CSS keyed to existing tokens. Don't add a token unless a preset genuinely needs to vary it.
- Do keep feature CSS in `FEATURE_CSS`. Don't put `.ak-chart`, `.ak-tabs` and similar selectors in `BASE_CSS`, because `verify.ts` fails the compile on that tree-shaking regression.
- Don't introduce colors outside tokens, remote assets, or decorative motion.
