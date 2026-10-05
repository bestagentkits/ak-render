# Review checklist

Use this for any change to emitted output (`src/render/`, `src/theme/`) or the gallery.

## Gates

- `pnpm verify` (lint, typecheck, unit tests, build).
- `pnpm snapshots:check`, `pnpm gallery:check` and `pnpm schema:check`. Regenerate with the matching `:generate` script when the output changes on purpose.
- `pnpm test:browser`.

## Visual (UX)

Capture the changed gallery pages (`docs/gallery/*.html`, opened from `file://`) at 1440×900, 768×1024 and 375×812, in light and dark. Attach before and after screenshots to the PR. Check:

- There is no horizontal overflow (`scrollWidth === clientWidth`), clipped text, overlap or broken images.
- One clear hero and one heading hierarchy, with section breaks visibly larger than block gaps.
- Charts: the legend is present when color carries meaning, labels are unclipped, and there is no empty band.
- Focus is visible on every control, touch targets are at least 44px on mobile, and reduced motion yields 0ms transitions.
- Contrast stays at WCAG 2.2 AA in every preset, in both schemes.
- The change follows `DESIGN.md`: tokens only, no new colors, and no decorative motion.

## Agent readability (AX)

- Each artifact keeps `<title>`, a meta description when the spec has one, and `og:title`, `og:type`, `og:description` and `twitter:card` from spec meta. Never invent URLs.
- Each chart keeps its text summary and data table.
- If the gallery gets a public origin, add robots.txt, sitemap.xml, llms.txt, canonical and og:url, and run the discovery scan against it.
