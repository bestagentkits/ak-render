# WP7 notes: product widgets

Branch `gh10/wp7-product`. Everything is in `src/blocks/product/`, one module per block. The group registers seven
module features: `pricing`, `feature-matrix`, `testimonial`, `logo-cloud`, `people`, `calendar` and `lightbox`.

## Changelog lines

- feat(blocks): `pricing` shows 1–4 plan cards with a price, a period, a summary, up to 12 features and a call to action.
  - A price is either text (`$0`, `Custom`) or a number formatted in `currency`.
  - At most one plan may set `highlight`. That plan says "Recommended" in text.
- feat(blocks): `feature-matrix` is a table of features against 2–5 plans.
  - `true` and `false` render as check and cross marks with the visually hidden words "Included" and "Not included".
  - A row whose number of values does not match the plans is an error at `rows[i].values`.
- feat(blocks): `testimonial` takes 1–9 quotes. One quote renders as a featured panel; two or more form a grid, which
  covers a quote grid.
- feat(blocks): `logo-cloud` shows 2–24 logos. The name is the alt text, and when the network policy blocks a remote
  logo the name is shown as a wordmark instead.
- feat(blocks): `people` shows up to 24 profiles with an avatar, a role, a bio of up to 280 characters and up to 3 links.
- feat(blocks): `calendar` shows one `YYYY-MM` month with up to 60 dated events.
  - Weeks start on Monday by default; `weekStart: sunday` changes that.
  - Below 560px the month becomes an agenda that lists only the days with events.
  - The layout is computed with integer date math, so no day is ever marked as today.
- feat(gallery): Every gallery thumbnail opens a full-size viewer.
  - Scripts upgrade it to a modal dialog with Previous/Next, the arrow keys and Escape, and focus returns to the thumbnail.
  - Without scripts, the thumbnail links open the same figure as a `:target` overlay.
  - Print shows only the grid.

## DESIGN notes (to fold into DESIGN.md, "Product blocks")

| Block | Feature | Notes |
|---|---|---|
| `pricing` | `pricing` | Auto-fit cards, min 15rem. The highlighted plan has an accent border, an accent glow and a popover shadow, with a mono pill badge over the top edge. Features are checked in the accent colour. The CTA sits at the bottom; it is a primary button on the highlighted plan. |
| `feature-matrix` | `feature-matrix` | Uses the shared `.ak-table-wrap`, so it scrolls inside its frame on a phone. The row header column is sticky. A check sits in a success-tinted disc; a cross is a muted mark. Cells are `position:relative` so the hidden words cannot widen the page. |
| `testimonial` | `testimonial` | One quote: a large-radius panel with a heading-face quote at scale², a faint oversized accent quote mark and an accent radial wash. Two or more: auto-fit cards, min 17rem, each opening on a small accent quote mark. |
| `logo-cloud` | `logo-cloud` | Hairline tiles in an auto-fit grid (min 9rem). Logos are grayscale at 75% and turn full colour on hover. A blocked logo shows its name as a muted heading-face wordmark. Print shows full colour. |
| `people` | `people` | Cards with a 56px avatar. Without an avatar, or when it is blocked, the card shows initials on an accent-tinted radial disc. The role is a mono uppercase label. Links reach 44px at ≤768px. |
| `calendar` | `calendar` | A 7-column grid of hairline cells. Weekends are tinted 2.5% and padding cells 5%. Events are tone-tinted chips with a tone dot, not a side stripe. At ≤560px it becomes an agenda: only days with events, each with the weekday and the date. Nothing depends on the current date. |
| `gallery` (lightbox) | `lightbox` | Thumbnails are links (`cursor: zoom-in`). The figure set after the grid is hidden. Without scripts, `:target` shows a figure as a fixed blurred overlay. With scripts, the set moves into a `<dialog>` with a large radius and a popover shadow, and it enters with `@starting-style` (gated on motion). Previous/Next/Close are pill links. The print sheet hides the set. |

The avatar CSS is shared by the `testimonial` and `people` sheets, so a page that uses both repeats the identical rules.

## Contract decisions and deviations

- **The lightbox has no author flag** (controller decision 5). The grid crops thumbnails to 16:9, so the compiler
  always offers the full image.
  - So the spec's test "Gallery without `lightbox` is byte-identical" no longer applies.
  - **Every existing gallery changes output on purpose:** `media`, `all-components` and any theme snapshot that has
    a gallery. Each one gains thumbnail links, the hidden figure set, and the `lightbox` CSS and runtime.
  - Regenerate the snapshots and the gallery after merging.
  - A gallery whose images are all blocked emits no viewer markup. The sheet is still emitted, because features are
    declared per block type.
- **The no-JS fallback is a `:target` overlay**, not visible duplicate figures after the grid. Without scripts the
  page shows each image once; print shows the grid only.
- **The viewer is created by the runtime.** A static closed `<dialog>` would hide the no-JS `:target` figures.
  - The runtime creates the dialog and moves the figure set into it.
  - Where `showModal` is missing, it does nothing, and the links keep working.
- **Escape is handled on the lightbox dialog itself, which stops the event there.** The shared document handler calls
  `closeDialog`, and that function exists only when the core `dialog` feature is on the page. Without the stop, Escape
  in the viewer would throw a ReferenceError.
- **A testimonial `logo` uses `rejectBlocked: true`.** It is decorative and has no text fallback, so a blocked remote
  logo would be silently dropped (the wave 0 rule).
  - Avatars in `testimonial` and `people` fall back to initials, so they are not rejected.
  - A blocked `logo-cloud` logo falls back to its name.
- **Calendar `month`, `date` and `time` formats are checked in `check()`,** because `StringPropSchema` has no
  `pattern`. Errors are reported at `month`, `events[i].date` and `events[i].time`.
- **Weekday and month names are fixed English,** like the month names in `format-value.ts`.
- **New fixture assets:** `fixtures/assets/logo-{northwind,lumen,orbit,harbor,quill,vertex}.svg`. They are neutral
  slate (`#64748b`) wordmarks for the logo-cloud fixture and are copied into the gallery by `gallery:generate`.

## Needs the controller

- `tests/unit/block-modules-registry.test.ts` ("accepts a valid group…") fails on this branch, because this group is
  the first built-in to register module features. It is fixed centrally on integration (a96aca3), so it was not
  edited here.
- The catalog grows by 6 blocks, so check the catalog budget test after merge (WP10).
