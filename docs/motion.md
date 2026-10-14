# Motion recipes

A block can opt into one named, compiler-owned motion recipe:

```yaml
- type: card
  title: Revenue is up 12%
  motion: reveal-soft          # or: motion: { preset: reveal-soft }
```

The spec only names the recipe. It cannot supply CSS, keyframes, selectors,
timings or scripts, and an omitted `motion` keeps the block's existing
behaviour. The registry lives in [`src/motion/recipes.ts`](../src/motion/recipes.ts),
and the library exports it as `MOTION_RECIPES`, `getMotionRecipe` and
`motionPresetsFor`. `describe --compact` lists the recipes specific to a block
type under `motion:`.

## Recipes

| Recipe | Blocks | Plays | Under restrained, still, print and without JS |
| --- | --- | --- | --- |
| `reveal-soft` | section, card, callout, alert, quote, image, video, chart, table, code, comparison, key-value, diagram-panel, data-table, testimonial, pricing, metric-breakdown, story | Once, as the block scrolls into view: fades and rises | Shown in place |
| `stagger` | stats, steps, timeline, list, card-grid | Once, on arrival: items one after another, the delay capped after the eighth | Every item at once |
| `figure-roll` | stats, kpi | On arrival, and each time `visibleWhen` shows the block again: figures roll up | Figures in place |
| `fade-swap` | any block but `page`; needs `visibleWhen` | Each time a state change shows the block | Appears at once |
| `tabs-slide` | tabs | On selection: the marker slides to the new tab, the panel fades in | Marker and panel switch at once |
| `accordion-expand` | accordion | On open and close: the section height eases | Sections snap |
| `dialog-pop` | dialog | Scales in on open; fades out on close, then focus returns to the opener | Opens and closes at once |

Validation fails with a JSON path and the compatible recipe list for an unknown
recipe, a recipe on a block it does not target, `fade-swap` without
`visibleWhen`, and any `motion` field other than `preset`.

## Timing and precedence

Recipes time themselves from a semantic scale derived from the theme's
`motion-duration` (160ms by default):

| Step | Multiple |
| --- | --- |
| `micro` | 0.5 |
| `fast` | 0.75 |
| `normal` | 1 |
| `relaxed` | 1.5 |
| `emphasis` | 2.5 |

The scale is not a separate set of theme tokens. A theme that sets
`motion-duration: 0ms`, as the still state does, zeroes every step, so no
recipe can outlast the policy. Precedence is:

1. the reader's `prefers-reduced-motion: reduce`, which always wins;
2. the theme's `motion-policy` ([themes](./themes.md#tokens), [ADR 0002](./adr/0002-motion-policy.md));
3. the block's `motion` recipe, timed by the theme's `motion-duration` and `motion-easing`.

There is no page- or theme-level default recipe: motion is opt-in per block.

## How a recipe is built

- **CSS only when used.** A page that names no recipe emits no recipe CSS and
  no recipe runtime, so its bytes are unchanged. A used recipe's rules are keyed
  on `[data-ak-motion="<id>"]`, and each keyframes name (`ak-m-*`) is emitted at
  most once.
- **Everything that moves is guarded.** Every animation and transition sits
  behind `MOTION_ALLOWED` and passes `motionDiagnostics`, so it plays under the
  `full` state only.
- **Content is never hidden waiting for motion.** Arrival recipes reuse the
  runtime's existing arrival observer: a block shows its final state until the
  observer marks it in view, so captures, print and no-JS read it in full.
- **State changes settle deterministically.** `tabs-slide`, `fade-swap` and
  `dialog-pop` use a small lifecycle runtime
  ([`src/motion/motion-runtime.ts`](../src/motion/motion-runtime.ts)), emitted
  only on pages that use one of them. It sets a transient `data-ak-entering` or
  `data-ak-leaving` attribute for the guarded CSS to animate. A generation token
  lets a rapid second change supersede the first, and a timeout derived from
  the computed animation time clears the attribute if `animationend` never
  fires. When motion is off, the change completes at once.
- **Accessibility is unchanged.** Roving focus and `aria-selected` on tabs,
  native `<details>` on the accordion, and the dialog's focus return all work
  as before. Escape, the close button and an action share one dialog exit, and
  a reopen during the exit cancels it.

Recipes are original implementations from web-platform primitives. No
third-party transition recipe is copied or repackaged.

## Adding a recipe

Add an entry to `MOTION_RECIPES` with its targets, triggers, scale step,
easing, `reduced` behaviour and an example. Put its animating CSS in `guarded`.
Add any new keyframes to `MOTION_KEYFRAMES` and `PAGE_KEYFRAMES_NAMES`. Then
extend [`fixtures/pages/motion-recipes.yaml`](../fixtures/pages/motion-recipes.yaml)
and the unit and browser specs (`tests/unit/motion-recipes.test.ts`,
`tests/browser/motion-recipes.spec.ts`).
