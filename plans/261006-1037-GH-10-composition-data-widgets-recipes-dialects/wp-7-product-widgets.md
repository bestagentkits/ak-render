# WP7 — Product widgets: pricing, feature-matrix, testimonial, logo-cloud, people, calendar, gallery lightbox

Issue phase 5 (P2). Depends on W0. Branch `gh10/wp7-product`. Estimate 8h.

## Files

| Ownership | File |
| --- | --- |
| exclusive | `src/blocks/product/*`: `gallery.ts` (moved there in W0), one file per new block, `product-styles.ts`, `product-runtime.ts` (lightbox), `index.ts` |
| create | `tests/unit/product-widgets.test.ts`, `fixtures/pages/product-widgets.yaml` |
| notes | `reports/wp7-notes.md` |

Gallery CSS stays in `src/render/styles.ts`, which WP2 owns. Lightbox CSS goes into `product-styles.ts` under the
new feature `lightbox`.

## Contracts (category `product` unless noted)

```yaml
- type: pricing
  plans: [{ name, price: "$0" | number+currency, period?: month|year|once, summary?, features: [≤12 text],
            cta?: { label, href }, highlight?: boolean }]          # 1..4, ≤1 highlight
- type: feature-matrix                                              # category data
  plans: [Free, Pro, Team]                                          # 2..5 column labels
  rows: [{ feature, values: [true, "10 GB", false] }]               # ≤40; values length == plans length
  # booleans render check/cross icons + visually-hidden "Included"/"Not included"
- type: testimonial                                                 # covers quote-grid
  items: [{ quote, name, role?, avatar?: url(asset images), logo?: url }]   # 1..9
  # 1 item → featured layout; 2+ → responsive grid. No carousel (compiler decides).
- type: logo-cloud                                                  # category media
  items: [{ name, src: url(images), href? }]                        # 2..24; name = alt
- type: people
  items: [{ name, role?, avatar?: url(images), bio?: text≤280, links?: [{label, href}] ≤3 }]   # ≤24
- type: calendar                                                    # category data
  month: 2026-10                                                    # YYYY-MM
  events: [{ date: 2026-10-14, title, tone?, time?: "14:00" }]      # ≤60, date must be in month
  # Monday-first month grid computed deterministically (Zeller/epoch math, no Date locale);
  # ≤560px → agenda list. Today is never highlighted (determinism).
- type: gallery  (existing) + optional `lightbox: true`
  # compiler emits each thumbnail as <a href="#ak-lb-<id>-<n>"> (no-JS: anchor jumps to full image figure
  # rendered after the grid, readable in print) and runtime upgrades to a native <dialog> viewer with
  # prev/next, Esc, focus return. Feature `lightbox` (scripted, announces).
```

`lightbox` is a boolean presentation option, but it is meaningful author intent (enlarging is optional UX), so
it stays as a flag. Ask the maintainer whether the compiler should decide it, for example always on for 4 or
more images. This is listed as an open question.

## Steps

1. Write the definitions and checks:
   - one highlight at most;
   - matrix row value counts;
   - calendar month format and event dates inside that month;
   - logo and avatar URLs flagged `asset: 'images'`.
2. Write the renderers and the CSS, with one feature per block so tree-shaking stays exact: `pricing`,
   `feature-matrix`, `testimonial`, `logo-cloud`, `people`, `calendar`, `lightbox`.
3. Write the lightbox runtime in ES5: a `dialog.showModal()` guard with a fallback to the anchor behavior when
   `showModal` is missing.
4. Write the fixture: 3 pricing plans, a 3-plan matrix, testimonials with 1 and with 3 items, a logo cloud,
   4 people, a calendar for 2026-10, and a gallery with a lightbox, all using local data URI or fixture images
   following the existing gallery fixture pattern.

## Tests

- **Unit.**
  - The calendar grid for 2026-10 starts with Thursday the 1st in column 4 (Monday first), and February 2028
    (a leap year) has 29 days.
  - The matrix length mismatch diagnostic has its path.
  - Featured versus grid testimonial.
  - Lightbox anchors with no JS.
  - Gallery without `lightbox` is byte-identical.
- **Browser.**
  - The lightbox opens and closes with the keyboard and focus returns.
  - Script-off anchor navigation works.
  - Pricing cards stack at 375 without overflow.

## Acceptance

- [ ] Every block has zero warnings in the fixture.
- [ ] axe reports no critical issue.
- [ ] Remote logos and avatars are gated by `policy.network`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Calendar date math off by one | Epoch-day arithmetic with UTC-free integer math, plus golden tests |
| `<dialog>` support | Anchor fallback, so it works with no JS too |

Rollback: revert and regenerate. The product-case-study fixture and the product-showcase recipe depend on this WP.
