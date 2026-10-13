# ADR 0002 — Motion policy and accessibility

- **Status:** Accepted
- **Date:** 2026-10-13
- **Scope:** emitted CSS and runtime in `src/render/`, block and adapter
  stylesheets, the `motion-policy` theme token. Issue
  [#38](https://github.com/bestagentkits/ak-render/issues/38).

## Context

Pages may be expressive, but motion only decorates: every page must read
completely with reduced motion, in print, in a screenshot and without
JavaScript. Before this record the rules lived in several places that drifted:

- the `reduced` policy behaved exactly like `full` whenever the system allowed
  motion;
- the dialog entrance ran outside the reduced-motion guard, and its keyframes
  reused the name `ak-rise`, so on any page with a dialog one definition
  silently replaced the hero word reveal's (or the other way round);
- nothing checked that a new animation sat behind the guard, so a leak would
  only show up in a browser.

This is groundwork for a later motion recipe registry. It adds no Page Spec
field and no animation library.

## Decision

### Effective motion state

The theme token `motion-policy` and the reader's `prefers-reduced-motion` meet in
one matrix. The reader's setting always wins.

| `motion-policy` | system `no-preference` | system `reduce` |
| --- | --- | --- |
| `full` (default) | **full** | **still** |
| `reduced` | **restrained** | **still** |
| `none` | **still** | **still** |

| State | Keeps | Turns off |
| --- | --- | --- |
| full | Everything: state transitions, the hero entrance and aurora, block entrances, marquee, scroll-linked parallax, smooth scrolling, count-up, the pointer spotlight, the theme view transition and adapter animation. | Nothing. |
| restrained | State feedback that does not move: colour, border, shadow, outline and opacity transitions at the theme's `motion-duration`. | Every keyframe animation; any transition that moves something (hover lifts, image zoom, a turning chevron, the button sheen), which jumps to its end state; smooth scrolling; script-driven motion (count-up, spotlight tracking, the view transition) and adapter motion. |
| still | Nothing moves; `--ak-motion-duration` is `0ms`, so state changes are instant. | Everything above. |

In every state the two **scroll-position indicators** keep working: the
reading-progress rail and the edge shades on sideways scrollers. They run on a
scroll timeline, not on time; they report position the way a scrollbar does,
so they are feedback, not motion. They are the only animations allowed outside
the guard, and only on a scroll timeline.

**Print** settles everything: one rule turns every animation and transition
off, so nothing is printed mid-entrance.

**Without JavaScript** nothing waits on a script: entrances key off an
attribute only the runtime sets, and count-up figures are in the markup.

### One mechanism, one owner

`src/render/motion.ts` owns the matrix and every part of the mechanism:

1. **The guard.** Every animation, and every transition that moves something for
   decoration, sits inside `@media (prefers-reduced-motion:no-preference)`.
   `applyMotionPolicy` rewrites that condition so it can never match under
   `reduced` and `none`.
2. **The duration token.** The theme sheet sets `--ak-motion-duration:0ms` under
   `none` and under the system setting, repeating the scheme selectors so the
   dark scheme and inline theme overrides cannot outrank it.
3. **The root attribute.** `<html data-motion="reduced|none">` tells the runtime
   to skip script-driven motion, and adapter canvases stop their own animation
   and transitions under it. Under `reduced`, one rule (`RESTRAINED_CSS`)
   limits every transition to colour, border, shadow, outline and opacity, so
   nothing moves even when a feature sheet transitions `transform`, as WCAG
   2.3.3 asks of motion that interaction starts.
4. **Adapters.** Adapter stylesheets are scoped to their canvas, which stops
   them in every still or restrained state and in print. SMIL animation
   elements are refused at the adapter boundary, because no stylesheet can
   stop them.
5. **The check.** `motionDiagnostics` runs on the page stylesheet inside
   `verifyDocument` on every compile. It fails the compile when any animation
   layer outside the guard is not a scroll-position indicator on a scroll
   timeline, when an unguarded transition has a fixed duration or delay (only
   `var()` times count as token-driven), when a media query list holds the
   guard beside a query that matches without it, or when a keyframes name is
   defined twice.

### Compatibility

On screen, `full` and `none` are unchanged apart from the dialog fix. Print
now settles every animation under every policy. `reduced` now restrains motion
as its name promised; no built-in preset used it. Adapter markup with SMIL
animation is now refused and falls back to the diagram's text description.
Specs and themes need no change.

## Motion budget

Until the recipe registry exists, new motion must fit this budget:

- At most one orchestrated entrance per page (the hero) and one ambient loop
  (the hero aurora) visible at once. Block entrances play once, on arrival.
- Entrances and state transitions are timed from `--ak-motion-duration`. A
  fixed duration is allowed only inside the guard.
- Nothing starts hidden unless the runtime has seen it arrive; no information is
  carried only by motion.
- No new animation may run outside the guard unless it is a scroll-position
  indicator; add its keyframes name to `SCROLL_POSITION_KEYFRAMES` and explain
  why it is feedback.

## Guidance for the recipe registry

- A recipe declares which effective states it runs in (normally full only) and
  whether it is feedback (allowed in restrained) or decoration.
- Recipes emit through the same guard and pass the same `motionDiagnostics`;
  extend the check rather than adding a second gate.
- Keyframes names stay page-unique and are listed in
  `PAGE_KEYFRAMES_NAMES`, so adapters cannot redefine them.
- Do not copy or repackage third-party transition recipes; take engineering
  lessons only, and record the source and licence.

## Verification

- `tests/unit/motion-policy.test.ts`: the diagnostics, the policy rewrite and a
  sweep of every fixture page.
- `tests/browser/motion-policy.spec.ts`: all six cells of the matrix (attribute,
  duration, running time-based animations, smooth scrolling), state feedback
  under restrained, the dialog entrance and focus handling in every cell, the
  view transition, the scroll-position indicators, print and no-JavaScript.
