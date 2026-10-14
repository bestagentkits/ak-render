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
type under `motion:`, and [discovery](#discovery-and-audit) searches and
describes them.

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

## Discovery and audit

Motion recipes are separate from the page recipes that `recipes` and `recipe`
return: a page recipe is a starting spec, a motion recipe is a value for one
block's `motion` field. Every answer below is projected from `MOTION_RECIPES`,
so discovery cannot disagree with validation, and no answer contains CSS.

### Finding a recipe

```bash
ak-render motions                                # one line per recipe
ak-render motions search smooth tabs             # ranked by word overlap
ak-render motions describe tabs-slide --compact  # blocks, triggers, fallback, example
ak-render motions describe tabs-slide --json     # the full descriptor
```

MCP clients call one tool, `motions`: no arguments for the list, `query` for a
search, `id` (with `compact: true` for the short form) for one recipe. The
remote server answers it without a bearer, like `catalog`. The library exports
`motionCatalog`, `searchMotions` and `describeMotion`.

Search is deterministic word overlap over the id, aliases, target blocks,
triggers and purpose, with no fuzzy matching. An unknown id fails with
`SPEC_VALIDATION_ERROR` and lists the closest ids.

What an agent reads to pick a recipe for "make the tabs switch smoothly",
measured with `node scripts/motion-token-cost.mjs` after `pnpm build`
(tokens estimated as characters / 4):

| Workflow | Reads | Characters | ~Tokens | vs. guide |
| --- | --- | ---: | ---: | ---: |
| Before: read the motion guide | `docs/motion.md` | 4404 | 1101 | 100% |
| Before: read the recipe registry source | `src/motion/recipes.ts` | 18485 | 4622 | 420% |
| After: search, then compact describe | `motions { query: "smooth tabs" }` + `motions { id: "tabs-slide", compact: true }` | 751 | 188 | 17% |
| After: list every recipe, then compact describe | `motions {}` + `motions { id: "tabs-slide", compact: true }` | 2725 | 682 | 62% |

Search plus a compact describe reads about a sixth of the guide and a
twenty-fifth of the registry source, and it names the exact field to write.

### Auditing motion

```bash
ak-render motion audit page.yaml                 # spec audit, authoritative
ak-render motion audit page.html --json          # compiled-page audit, best effort
ak-render motion audit page.yaml --fail-on warning --baseline motion-baseline.json
```

MCP clients call `audit-motion` with exactly one of `spec` or `html`. Remotely
it needs a bearer, like `validate`. The library exports `auditMotionSpec`,
`auditMotionHtml`, `motionAuditFails` and `compareMotionAudits`. The audit
reads its input and never rewrites it, runs no page script and fetches
nothing.

Each finding has a stable `rule`, a `severity` (`error`, `warning` or `info`),
a `message`, a JSON `path` (or `css`, `html`, `script`), the block id when
there is one, reproducible `evidence` and a `fix`. Findings are sorted, so the
same input always gives the same report. A report lists at most 25 findings per
rule, plus one that counts the rest; `counts` and the score cover every
finding. The audit takes linear time and quotes at most a short excerpt of
the input, so a hostile page cannot stall it or inflate the report.

**Spec audit (authoritative).** It runs on the normalized spec and the theme it
resolves:

| Rule | Severity | Finds |
| --- | --- | --- |
| `motion/unknown-recipe`, `motion/incompatible-recipe`, `motion/needs-visible-when`, `motion/raw-motion-field`, `motion/invalid-value` | error | The validation errors above, with the compatible recipes |
| `spec/invalid` | error | Any other validation error; the motion rules cannot run |
| `motion/nested-arrival` | warning | An arrival recipe inside a block that already arrives with one |
| `motion/state-never-changes` | warning | A `visibleWhen` recipe whose state no control or action ever writes |
| `motion/arrival-overuse` | warning | More than six blocks that arrive with motion |
| `motion/stagger-capped` | info | `stagger` on more than eight items; the rest arrive together |
| `motion/policy-off` | info | Recipes on a page whose theme `motion-policy` is `reduced` or `none`, where no recipe plays |

**Compiled-page audit (best effort).** It reads the emitted stylesheets and
runtime. A page AK Render did not compile is still scanned, with
`html/untrusted-source` noted, because a scan cannot prove arbitrary HTML is
accessible.

| Rule | Severity | Finds |
| --- | --- | --- |
| `html/unguarded-motion`, `html/duplicate-keyframes` | error | What `motionDiagnostics` rejects at compile time, including a stylesheet nested more than 32 blocks deep, which cannot be checked |
| `html/missing-recipe-css`, `html/missing-exit`, `html/missing-lifecycle` | error | A block names a recipe whose CSS, exit phase or runtime is missing |
| `html/missing-csp`, `html/unsafe-csp`, `html/remote-resource` | error | No CSP, a CSP that allows `unsafe-inline` or `unsafe-eval`, or a remote script, stylesheet, import or `url()` |
| `html/transition-all`, `html/layout-keyframes` | warning | `transition: all`, or keyframes that animate layout properties |
| `html/unknown-recipe` | warning | A `data-ak-motion` value the registry does not know |
| `html/unbounded-motion` | info | More than one infinite loop |
| `html/fixed-timing` | info | Guarded rules timed in fixed units instead of the motion tokens (one finding per page) |
| `html/untrusted-source` | info | The page has no AK Render generator mark |

A clean compiled page shows only the two notes the compiler's own ambient
loops and hero effects cause (`html/unbounded-motion`, `html/fixed-timing`).

**Gate and score.** `--fail-on` (default `error`; `none` never fails) sets the
exit code: 1 when a finding at that severity or above is present, 2 for a usage
error. `--baseline` takes an earlier `--json` report and gates only on new
findings, plus every current error: a baseline can forgive a known warning,
never a standing error. A finding on a block with an `id` is matched by that id,
so inserting or moving other blocks does not turn it into a new one. The score is advisory: 100 minus 25 per error, 8 per
warning and 2 per note, floored at 0. It never decides the gate.

## Adding a recipe

Add an entry to `MOTION_RECIPES` with its targets, triggers, scale step,
easing, the effective states it plays in and whether it is feedback or
decoration (`states`, `role`; every current recipe is decoration that plays
under `full` only), its `reduced` behaviour and an example. Put its animating CSS in `guarded`.
Add any new keyframes to `MOTION_KEYFRAMES` and `PAGE_KEYFRAMES_NAMES`. Then
extend [`fixtures/pages/motion-recipes.yaml`](../fixtures/pages/motion-recipes.yaml)
and the unit and browser specs (`tests/unit/motion-recipes.test.ts`,
`tests/browser/motion-recipes.spec.ts`).
