# ADR 0003 — Motion recipes

- **Status:** Accepted
- **Date:** 2026-10-14
- **Scope:** `motion` on Page Spec blocks, `src/render/motion-recipes.ts`,
  `src/render/motion-runtime.ts`, the recipe sheet and runtime parts. Issue
  [#39](https://github.com/bestagentkits/ak-render/issues/39); builds on
  [ADR 0002](./0002-motion-policy.md).

## Context

Blocks already had built-in motion: the hero word reveal, KPI and terminal
entrances, count-up figures, the dialog entrance. An agent could not ask for
more than that, nor turn it off for one block, and interactive state changes
(a tab, a slide, a dialog closing) replaced old content instantly. The
compiler owns presentation, so the answer cannot be author CSS, keyframes or
script. It has to be a closed set of named intents the compiler implements.

The recipes are new work on web-platform primitives (opacity, transforms,
`::details-content`, `interpolate-size`). No upstream recipe source is copied.

## Decision

### Authoring

A block that accepts motion takes one optional key:

```yaml
- type: stats
  motion: { preset: stagger }
  items:
    - { label: Revenue, value: "$120K" }
```

`motion` is `{ preset }` and nothing else. The preset must be a recipe that
lists the block type as a target, or `none`. Anything else is a
`SPEC_VALIDATION_ERROR` at its JSON path, each with the accepted presets in
`details.known`: an unknown or incompatible preset at `…motion.preset`, any
other key (a duration, raw CSS) at `…motion.<key>`, a non-object at
`…motion`. A block type with no compatible recipe has no `motion` key in the
JSON Schema, so `motion` there is an unknown property. Omitting `motion`
changes nothing: old specs compile byte for byte as before, apart from the
shared runtime fixes below.

### The registry

`MOTION_RECIPES` in `src/render/motion-recipes.ts` is the single source. Each
recipe declares its id, version, summary, target block types, triggers
(`on-enter`, `state-change`), phases (`enter`, `exit`, `change`), default
semantic duration and easing, what the reduced or still reader sees, whether
it needs the runtime, and its CSS. `motionRecipeDescriptors()` returns the
same metadata without CSS, as plain JSON, for catalog and discovery surfaces.
Motion recipes are separate from the theme's style recipes (`theme.recipes`),
which change how a surface looks at rest.

| Preset | Targets | Trigger | Runtime | Reduced, still, print, no script |
| --- | --- | --- | --- | --- |
| `reveal-soft` | content blocks (hero, section, card, stats, chart, table, …) | on-enter | observer | shown in place |
| `stagger` | stats, card-grid, kpi, list, steps, timeline, checklist | on-enter | observer | every item at once |
| `number-tick` | stats, kpi | on-enter, state-change | observer | final value |
| `crossfade` | tabs, carousel, content blocks under `visibleWhen` | state-change | marks revealed content | instant swap |
| `tab-indicator` | tabs | state-change | measures the selected tab | pill moves instantly; the selected tab keeps its surface until measured |
| `accordion-expand` | accordion | state-change | none | instant open and close |
| `dialog-rise` | dialog | open and close | exit lifecycle | instant open and close; focus returns either way |
| `none` | any block that accepts a preset | — | — | turns that block's built-in entrance, keyframe motion and count-up off; hover transitions stay |

`motionPresetsFor(type)` lists a type's presets. `code` is not a target: its
id sits on the inner `<pre>`, not the block root. `crossfade` on a content
block fades it only when its own `visibleWhen` reveals it, so without one the
compiler warns at `…motion.preset`.

### Semantic timing

Recipes never use a fixed time. The recipe sheet defines a scale on the root,
derived from the theme's `motion-duration` (the `normal` step):

| Step | Factor | Default at 160ms |
| --- | --- | --- |
| `--ak-motion-micro` | 0.4 | 64ms |
| `--ak-motion-fast` | 0.7 | 112ms |
| `--ak-motion-normal` | 1 | 160ms |
| `--ak-motion-relaxed` | 1.6 | 256ms |
| `--ak-motion-emphasis` | 2.2 | 352ms |

Easings are `--ak-motion-ease-standard` (the theme's `motion-easing`),
`--ak-motion-ease-enter` (decelerate) and `--ak-motion-ease-exit`
(accelerate); none overshoots. The factors are design hypotheses: every
preset derives its steps from its own duration, and `newspaper` (0ms, policy
`none`) runs every recipe still. `motion-duration` and `motion-easing` keep
their meaning, so a theme sets the tempo with one token. The still state zeroes
the base, which zeroes every step; `motionDiagnostics` accepts the scale
variables as token-timed.

### Emission

- The compiler collects the presets a page uses, in IR order, and emits the
  scale plus each used recipe's CSS once, in registry order, after the feature
  sheets and before the theme sheet. A page without `motion` gets none of it.
- Every keyframes name starts with `ak-m-` and belongs to one recipe; the
  adapter filter reserves them, and the duplicate-keyframes check covers them.
- Recipe selectors are attributes and structure (`[data-ak-motion="…"]`,
  `[role="tabpanel"]`, `:is(ul,ol,dl)>:is(li,div)`), never a feature's class,
  so a recipe cannot pull in or fake a feature's stylesheet.
- The renderer puts `data-ak-motion` on the block's root element, the one that
  carries `data-ak-id`. A block without such a root fails the compile with
  `INTERNAL_ERROR` rather than emitting a dead preset; a unit test applies
  every target to every fixture.
- The runtime gains a part only for a preset that needs it. A page with only
  `accordion-expand` adds no script; a page with no other runtime and an
  on-enter preset gets the runtime for the observer alone.

### Lifecycle

- **On enter.** As ADR 0002 requires, nothing starts hidden: a block shows its
  final state until the runtime sees it arrive and marks it
  `data-ak-entered`, and the animation's backwards fill supplies its first
  frame. A full-page capture, print, no script, no IntersectionObserver,
  reduced motion or a policy of `reduced`/`none` all read the block complete.
  So that a reader never sees a block shown, blanked, then faded in, blocks
  already on screen are marked while the page boots, before its first paint,
  and the rest are observed with a 12% lead below the viewport, so they are
  marked just before they scroll in. The attribute is the recipe's own, and a
  block's preset replaces its built-in entrance (the KPI entrance observer
  skips it), so the two cannot race.
- **Crossfade.** A MutationObserver, wired after every other part, marks a
  tab panel, slide or `visibleWhen` block `data-ak-entering` when a change
  reveals it. The authored first view is never marked, the old content leaves
  at once (so focus, ARIA and layout always follow one panel), and a repeated
  change restarts the fade on the same element. There is no timer or end
  event to wait for.
- **Tab indicator.** The pill reads the selection from `aria-selected`, so a
  click, the keyboard and a `select-tab` action all move it. It measures in a
  frame, so rapid changes collapse into one move and the transition retargets
  from wherever the pill is. A ResizeObserver (or `resize`) keeps it on the
  tab when the layout changes.
- **Dialog exit.** Closing ends in one function that closes, restores focus to
  the opener and fires `close` exactly once. It runs at once when motion is
  off, the document is hidden, or the exit animation is not running; on
  `animationend`; or after a timeout bounded at 1.5s when that event never
  comes. Escape and the native `cancel` request go through the same exit.
  Opening mid-exit cancels it; a second close mid-exit is ignored.

  Reopening mid-exit does not fire `open` again, since the dialog never
  closed.
- **Accordion expand.** The size transition applies on screen only, so print
  shows every section at full height.
- **`none`.** Stops the block's keyframe animations and count-up, its
  pseudo-elements' included (the hero aurora, a dialog backdrop), down
  through its nested content. A nested block with a preset of its own keeps
  it: a preset belongs to its block. Hover and focus transitions are feedback,
  not motion, and stay. Scroll-position shades on the tables, diagrams and
  roadmaps the page styles keep following the scroll, as ADR 0002 requires;
  the sheet names only shaded boxes the page already styles.

A `toggle` action on an open dialog now closes it (it used to call open
again), and on a closing dialog reopens it. A scripted page without the theme
toggle no longer calls the missing `restoreTheme` on load. These runtime
changes apply to every page.

### Precedence

Strongest first: the reader's `prefers-reduced-motion`, the theme
`motion-policy`, the block's `motion.preset`, the block's built-in motion.
There is no theme-level default preset in this phase: a preset is a per-block
opt-in, and a theme sets only the tempo and the policy.

## Consequences

- Agents get a short, validated vocabulary for motion and never author CSS.
- Every recipe obeys ADR 0002 by construction: its keyframes sit behind the
  guard, its transitions use the token scale, and its script checks
  `motionAllowed()` and settles without waiting on an event.
- Discovery surfaces (catalog, describe, MCP) can list recipes from
  `motionRecipeDescriptors()`, exported from the package root with
  `motionPresetsFor`, without reading CSS.
- Not done: direction-aware carousel slides and theme-level default presets.
  Both can be added as new recipe versions without changing the spec shape.
