# Rich composition notes (tabs, accordion, carousel, bento)

Branch `gh10/wp1-composition`. These notes are for wave 2 (CHANGELOG, DESIGN.md) and for the controller's merge review.

## Changelog lines

- feat(spec): A tab panel, an accordion section, a carousel slide and a bento tile can hold child blocks in `items[i].blocks`. Tabs, accordion and carousel items take up to 12 blocks, and a bento tile takes up to 6. Any block type may nest except `page`, `section` and `hero`. Tabs may nest inside tabs.
- feat(spec): An item's `text` is optional when the item has blocks, and so is a bento tile's `title`. An item with neither reports `SPEC_VALIDATION_ERROR` at `$.blocks[n].items[i]`.
- feat(render): A tab's `select` event passes the tab id as its value, so `set-value` without its own `value` stores the selected tab.
- fix(render): Tabs no longer fire `select` for the initial selection on load, so page state keeps its declared initial values.
- fix(render): Accordion sections print open, nested blocks included.
- fix(render): Accordion and carousel styles apply only to their own sections and slides, so nested blocks, including another block's `<details>`, keep their own look.

## DESIGN notes

- **Nested item content.** The item's text, when present, comes first as a paragraph. The blocks follow in a `<div class="ak-nested">` wrapper, and sibling blocks space apart with the usual `.ak-block + .ak-block` gap. A text-only item keeps its pre-existing markup byte for byte.
- **Tabs.** A panel that holds blocks drops the `--ak-measure` cap, so charts and tables use the full column. Its text paragraph keeps the cap.
- **Carousel.** A slide that holds blocks aligns its content to the top. Nested images are capped at `min(60vh, 420px)` with `object-fit: contain`, so one image cannot make a slide a full screen tall.
- **Bento.** Tile blocks sit in the tile body after the text. A tile with blocks may omit its title.
- **Accordion print.** `@media print` opens closed sections through `.ak-accordion>details::details-content{content-visibility:visible;display:block}`, the same technique the diagram description uses. No print script was added, so accordion pages gain no runtime. Engines without `::details-content` print closed sections closed; current Chromium, Firefox and Safari all support it.
- **Heading levels (accepted limitation).** Nested blocks keep their own heading levels, and items add none. A carousel slide title is an `h3`, so a nested block's `h3` sits at the same level as its slide title.
- **Selector scoping.** Accordion rules are now `.ak-accordion>details…`, and the carousel title and text rules are `.ak-carousel-slide>h3` and `>p`. Specificity is unchanged, so recipe sheets that target these surfaces still win when they come later in the cascade.

## Contract notes and deviations from the package spec

- **Exclusion is enforced in `check()`, not through `accepts`.** The slot has no `accepts` list, so any type is accepted. Each composition block's `check` rejects `page`, `section` and `hero` at the child's `.type` path, with `details: { type, excluded }`.
  - Why: a computed `accepts` list of about 80 types would appear in `describe` four times and in every diagnostic's `allowed` list, and the issue asks for a token-cheap `describe`. It would also create an import cycle with the registry.
  - Blocks that other groups register are nestable automatically.
  - Because of this, there is no `fixtures/rejected/tab-panel-wrong-child.yaml`. Rejected fixtures must fail with `POLICY_VIOLATION`, and a wrong child is a `SPEC_VALIDATION_ERROR`. Unit tests cover the wrong-child case instead.
- **Field names.** The existing item field names stay: tabs use `title`, not `label`.
- **Empty text.** An explicit `text: ""` stays valid, as it was when `text` was required. The check tests whether the field is present, not whether it is empty.
- **Work W0 had already done.** No static `hidden`, the no-JS/print CSS for tabs and carousel, and the `own…()` runtime scoping were already in place from W0. This package added browser coverage for them on nested content.

## Snapshot and gallery diffs for controller review

Every existing gallery page and theme snapshot differs only in emitted CSS, the runtime `<script>` body, nonces and hash headers. With `<style>` and `<script>` removed, the body markup is byte-identical for every page. `docs/gallery/index.html` also differs because of the new `rich-composition` entry and page-size captions.

- **CSS only:** `all-components`, `explain`, `interactive`, `media`, `plan`, `showcase`, `theme-showcase`, and all 6 theme snapshots. The changes are:
  - the added nested-content rules;
  - the accordion selectors rescoped from descendant to child;
  - the carousel `h3`/`p` selectors rescoped from descendant to child;
  - the accordion print rule.
- **Runtime:** pages with tabs (`interactive`, `all-components`, `explain`, `theme-showcase`) carry the changed `TABS` script.
- **New:** `docs/gallery/rich-composition.html`.

## Verification

- `tests/unit/rich-composition.test.ts` has 22 tests. They check that text-only tabs, carousel, accordion and bento fragments match the committed W0 gallery fragments.
- The `rich composition` block in `tests/browser/interactions.spec.ts` has 8 tests.
- Screenshots of the fixture at 1440, 768 and 375, in light and dark, show no horizontal overflow. It was also checked without scripts and in print.
