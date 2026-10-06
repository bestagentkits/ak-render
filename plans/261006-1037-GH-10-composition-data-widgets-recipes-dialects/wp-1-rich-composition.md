# WP1 — Rich composition: tabs, accordion, carousel, bento

Issue phase 1. Depends on W0. Branch `gh10/wp1-composition`. Estimate 7h.

## Goal

Tab panels, accordion items, carousel slides and bento tiles can hold typed child blocks, such as a chart, a table,
a code block or a callout, through `items[i].blocks`. Existing text-only specs stay valid and render
byte-identically. Every panel and slide reads with JS off and in print.

## Context (verify before editing)

- After W0, the definitions and renderers live in `src/blocks/composition/{tabs,accordion,carousel,bento}.ts`,
  the CSS lives in `composition-styles.ts` and the runtime lives in `composition-runtime.ts`.
- Current bugs this WP fixes:
  - The renderer puts a static `hidden` on non-first panels and slides (pre-W0 `blocks.ts:689`, `:737`).
  - TABS and CAROUSEL use descendant queries (pre-W0 `runtime.ts:401-512`), which catch nested instances.
- Use `ctx.renderSlot(node, slotKey('items', i, 'blocks'))` from `src/render/render-context.ts`.

## Files

| Ownership | File |
| --- | --- |
| exclusive | `src/blocks/composition/*` (all files, including index.ts) |
| exclusive (edit) | `tests/unit/render-showcase-blocks.test.ts` (bento assertions only), `tests/browser/interactions.spec.ts` |
| create | `tests/unit/rich-composition.test.ts`, `fixtures/pages/rich-composition.yaml`, `fixtures/rejected/tab-panel-wrong-child.yaml` (if `accepts` is used) |
| notes | `reports/wp1-notes.md` |

## Contracts

```yaml
# tabs / accordion / carousel item
items:
  - label: Latency            # tabs: label; accordion: title; carousel: title (existing names kept)
    text: optional summary    # was required; now optional when blocks present
    blocks:                   # kind 'blocks', minItems 1, maxItems 12, accepts '*' except page/section/tabs-in-tabs depth guard below
      - { type: chart, kind: line, labels: [...], series: [...] }
# bento tile
items:
  - title: optional now (still required when no blocks)
    blocks: [ ... ]           # maxItems 6
```

- At least one of `text` and `blocks` is required per item. When both are missing, `check()` reports
  `SPEC_VALIDATION_ERROR` at `$.blocks[n].items[i]`.
- `accepts` excludes `page`, `section` and `hero`. Nesting tabs inside tabs is allowed (the existing depth limit
  of 24 bounds it), and the scoped runtime handles it.

## Steps

1. **Schemas.** Make `text` optional and add `blocks: blocks({maxItems: 12, accepts: NESTABLE})` to the items
   object. Define `NESTABLE` once in `composition/nestable-blocks.ts` as the registry types minus the excluded
   ones. Compute it lazily so blocks added by other groups are included.
2. **Tabs renderer.**
   - Panels no longer get `hidden`.
   - Each panel starts with a visually hidden-until-JS heading (`<p class="ak-tabs__panel-title">`), so the
     script-off and print views list every panel with its label.
   - The tablist stays, and gets `data-ak-tabs-ready` from the runtime.
   - CSS: `[data-ak-tabs-ready] > .ak-tabs__panel:not(.is-active){display:none}`. Before ready, and in `@media print`,
     every panel shows and `.ak-tabs__panel-title` is visible. When ready, the tablist shows and the titles hide.
     Without ready, the tablist is hidden, because buttons without JS do nothing.
3. **Carousel.** Use the same "ready" pattern: without JS, the slides form a horizontal scroll-snap strip that
   already works. With JS, the active slide toggles. Print stacks all slides.
4. **Accordion.** Native `<details>`. For print, add
   `@media print{.ak-accordion details>*{display:block}}` and an ES5 `beforeprint`/`afterprint` pair in the
   accordion feature script that opens all and then restores. Accordion currently has no script feature, so add
   one only if the `beforeprint` handler is kept. Alternatively use the CSS `details::details-content` print rule,
   with the beforeprint fallback.
5. **Runtime scoping.** Every query in TABS and CAROUSEL uses direct-child scoping. ES5 has no `:scope` in old
   engines, so filter `qa(...)` results by the `closest('[data-ak-tabs]') === container` check through a helper
   `own(container, selector, rootAttr)`. Keyboard handling (arrows, Home, End) is unchanged.
6. **Bento.** Render `title` only when present. Tile `blocks` go into the tile body. The existing alt check is
   kept in `bento.check`.
7. **Heading levels.** Nested blocks keep their own heading levels, and panels add none. Record this in the notes
   as an accepted limitation for DESIGN.md.
8. **Fixture.** `rich-composition.yaml`:
   - tabs of 3 panels: chart, table and code with callout
   - an accordion with a kpi and a checklist
   - a carousel with an image and quote
   - a bento with a nested stats block
   - one tabs nested inside an accordion item, which tests scoping

## Tests

- **Unit.**
  - A text-only fixture's HTML is unchanged (snapshot compare against the W0 output for `interactive-explainer`
    and the bento fixture).
  - Nested IDs follow the path `tabs.items[1].blocks[0]` deterministically.
  - The item-missing-both diagnostic.
  - Panels have no `hidden`.
  - A nested chart adds the `chart` feature.
  - A nested remote image is gated.
- **Browser (`interactions.spec.ts`).**
  - Keyboard tab switching on the nested fixture changes only the inner tabs.
  - With JS disabled (`javaScriptEnabled:false`), every panel's text is visible.
  - Print emulation (`page.emulateMedia({media:'print'})`) shows every panel and slide.
  - Reduced motion has no transition.

## Acceptance

- [ ] The issue's tabs example (a chart plus a table in panels) compiles with zero warnings.
- [ ] Existing fixtures that use tabs, accordion, carousel and bento produce the same HTML apart from the
  documented panel markup change. List the snapshot diffs in the notes so the controller can review them.
- [ ] No horizontal overflow at 320 and 375 for `rich-composition.yaml`.
- [ ] axe reports no critical issue. The tab and tabpanel ARIA linkage is intact.

## Risks

| Risk | Mitigation |
| --- | --- |
| Removing static `hidden` flashes all panels before JS runs | Inline runtime runs at end of body, and the ready attribute is set synchronously in boot. Accept the brief flash; there is no FOUC-hiding CSS that would break no-JS |
| Nested runtime cross-talk | The `own()` helper plus a nested fixture and a browser test |
| Snapshot churn | Expected. The controller regenerates the snapshots |

Rollback: revert the merge and regenerate. W0 still parses `items[].blocks` only when a module declares it, so
older specs are unaffected.
