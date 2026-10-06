# WP6 — Evidence widgets: benchmark-comparison, metric-breakdown, annotated-image, references

Issue phase 5 (P1). Depends on W0. Branch `gh10/wp6-evidence`. Estimate 6h.

## Files

| Ownership | File |
| --- | --- |
| exclusive | `src/blocks/evidence/*`: one file per block, plus `evidence-styles.ts`, `index.ts` |
| create | `tests/unit/evidence-widgets.test.ts`, `fixtures/pages/evidence-widgets.yaml` |
| notes | `reports/wp6-notes.md` |

## Contracts (category `data` for the first two, `media` for annotated-image, `content` for references)

```yaml
- type: benchmark-comparison
  baseline: { label: v0.2 }
  candidate: { label: v0.3 }
  metrics:                          # 1..20; or dataRef + fields {metric, baseline, candidate}
    - { label: p95 latency, baseline: 420, candidate: 310, unit: ms, better: lower, format: number }
  # compiler computes delta (absolute + %), verdict improved|regressed|unchanged (|Δ%| < 1 → unchanged),
  # tone success/danger/neutral, and a summary line "3 improved, 1 regressed".
- type: metric-breakdown
  total?: { label, value }          # computed sum when omitted
  parts: [{ label, value, tone? }]  # 2..12; or dataRef + fields {label, value}
  format?: FORMAT_FIELDS
  # renders stacked horizontal bar (static data-ak-pct quantized to 1%, CSS rules 0..100) + list with share %
- type: annotated-image
  src, alt (required), caption?
  notes: [{ x: 35, y: 60, label: Cache miss, text? }]   # ≤12; x/y in percent, quantized to 5 (0..100)
  # numbered pins via [data-x="35"][data-y="60"] static CSS (21×21 = 42 rules: left/top separately);
  # list of notes below the image is the accessible + print form.
- type: references
  items: [{ id: smith-2024, title, href?, authors?, source?, year?, note? }]   # ≤60, id NODE_ID_PATTERN
  # renders <ol> with id="ref-<id>"; other text can link via "#ref-<id>" using existing link/anchor support.
```

## Steps

1. Write the definitions, then `check()`:
   - `better` must be `lower` or `higher`;
   - annotated-image `x`/`y` in 0–100, rounded to the nearest 5 with a warning when rounding changed the value;
   - references ids unique;
   - metric-breakdown parts non-negative.
2. Write the renderers. The `annotated-image` `src` uses `urlProp` with `asset: 'images'`, so W0's
   schema-driven `collectOrigins` handles remote policy and CSP automatically.
3. Write the CSS (features `evidence`, `annotated-image`), then the fixture.

## Tests

- **Unit.**
  - The delta and verdict table: lower/higher, zero baseline (Δ% omitted, shown as "new"), and the unchanged
    threshold.
  - Percentage quantization.
  - The pin attributes.
  - Reference anchors are unique.
  - A remote annotated-image without a policy is rejected.
- **Browser.** Pins align within ±4px at 375 and 1440. No overflow.

## Acceptance

- [ ] The issue's benchmark example compiles with zero warnings.
- [ ] The verdict text never relies on colour alone.
- [ ] Print shows the notes list.

## Risks

Pin overlap on small images. Mitigation: pins are numbers and the list is authoritative, so overlap is cosmetic.

Rollback: revert and regenerate. The W2 benchmark-report fixture and recipe depend on these blocks.
