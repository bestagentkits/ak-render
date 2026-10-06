# Evidence widget notes

Branch `gh10/wp6-evidence`. Files: `src/blocks/evidence/*`, `tests/unit/evidence-widgets.test.ts`,
`tests/browser/evidence-widgets.spec.ts`, `fixtures/pages/evidence-widgets.yaml`.

## Changelog lines

- feat(blocks): `benchmark-comparison` compares a baseline with a candidate across up to 20 metrics. The compiler computes:
  - the absolute delta and the percentage change ("new" when the baseline is zero);
  - a verdict: improved, regressed, or unchanged when the change is under 1%;
  - a summary line such as "3 improved, 1 regressed".

  Optional `method`, `limitations` and `source` notes are supported. Metrics can come from `dataRef`/`data` through `fields`.
- feat(blocks): `metric-breakdown` splits a total into 2–12 parts. It renders a stacked bar and a list of each part's value and share. Shares are whole percents that never exceed 100. The total is computed when omitted.
- feat(blocks): `annotated-image` shows numbered pins at x/y percent over an image, with the notes as a list. Coordinates snap to a 5% grid and a warning names the snapped value. A remote `src` that the network policy blocks is rejected at its path.
- feat(blocks): `references` lists up to 60 numbered sources. Each entry gets a stable `#ref-<id>` anchor that any link can target. Ids must be unique across the page. Links are never fetched, and print shows each external URL.

## DESIGN notes (to fold into DESIGN.md)

### Evidence widgets

The code is in `src/blocks/evidence/`. Features are `evidence` (marker `.ak-bench`), covering benchmark, breakdown and references, and `annotated-image` (marker `.ak-annotated`).

| Block | Notes |
| --- | --- |
| `benchmark-comparison` | A captioned table with a row header per metric and a "lower/higher is better" mono label. The change cell shows a signed delta (U+2212 minus) over the signed percentage. The verdict is a toned badge whose text states the verdict, so meaning never relies on colour. At ≤560px each row becomes a two-column card whose cells are labelled from `data-label`, so the verdict stays on screen instead of scrolling inside the table frame. Method, limitations and source are an auto-fit `<dl>` under a hairline. |
| `metric-breakdown` | A 14px pill bar of segments. Widths are static `[data-ak-pct="0…100"]{width:N%}` rules (101 rules), with no inline style. Segments are separated by a 2px transparent border. Colours use the chart's accent hue rotations (`--ak-c0…c5`); parts 7–12 repeat them with a hatch, and `tone` swaps in a status colour. The list (swatch, label, value, share %) is the authoritative form, and the bar is `aria-hidden`. |
| `annotated-image` | A stage wraps the image and sizes to it (`align-self:flex-start`). Pins are absolutely placed by `[data-x]`/`[data-y]` rules: 21 per axis, 42 in total. They are 26px accent discs (22px at ≤480px) and `aria-hidden`. The numbered notes list below repeats the same numbers and prints. |
| `references` | An `<ol>` of `<cite>` titles, with a meta line (authors · source · year) and a note. `:target` gets an accent tint. Print appends ` <url>` after external links. |

Formatting: these widgets hold numbers only, so the `text` format (the `FORMAT_FIELDS` default) reads as `number`. Item-level format fields override the block's.

## Contract details beyond the WP file

- `benchmark-comparison` adds the props `method`, `limitations` and `source: { label, href? }`. They cover the issue's "method note, evidence/source reference, limitation note". `source.href` accepts `#ref-<id>`.
- `better` is required per metric. Bound rows must carry a `better` field (default field name `better`, remapped through `fields.better`). There is no implicit direction, because a wrong default would produce a wrong verdict.
- `fields` mapping:
  - benchmark: `{metric, baseline, candidate, better, unit?}`;
  - breakdown: `{label, value}`.
- Block-level `FORMAT_FIELDS` are spread on both data blocks. Benchmark metrics accept item-level overrides with no defaults (`FORMAT_OVERRIDE_FIELDS`).
- Supplying both inline items and bound data is an error. So is supplying neither, unless the binding itself already failed.
- When an authored total is less than the parts' sum, a warning is reported and the shares use the sum.
- Reference `year` is an integer from 1 to 9999.

## Notes for the controller

- `tests/unit/block-modules-registry.test.ts` ("accepts a valid group…") fails on this base because the evidence group registers features; it is fixed on integration (`features.at(-1)`).
- `tests/unit/backward-compat.test.ts` on this base iterates every fixture. The new `evidence-widgets.yaml` may fail it until the integration fix that pins it to the 11 pre-release fixtures is merged. I did not edit that test.
- `docs/gallery/evidence-widgets.html` is new after `gallery:generate`, and the gallery index gains a card. Its discovery tags come from the fixture's meta.
- In the gallery fixture, the annotated image is `assets/shot-dashboard.webp`, which the gallery already copies.
