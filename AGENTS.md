# Agent guide

## Product principles

AK Render exists so coding agents get polished HTML from a compact structured spec, instead of spending tokens writing raw HTML. Output must stay beautiful, high quality and deterministic.

Mandatory boundaries (only the author may change these, not even for better looks or speed):

- **Offline by default.** An emitted page opens from `file://` and makes zero network requests unless the spec opts in through `policy.network`. No CDN, remote font or remote asset.
- **Deterministic.** The same spec, compiler version and options produce identical bytes.
- **No escape hatch.** Spec input is untrusted. No raw CSS, HTML, JS or iframe, and no open-ended action. Themes are typed data.
- **Local is canonical.** Compiling never needs an account or the network. Cloud is opt-in convenience, never the source of truth.

Guiding priorities (a collaborator may choose differently within the boundaries but must explain the trade-off):

- **The compiler owns presentation.** The spec describes meaning; layout, color and motion derive from content and theme. Presentation props stay optional with good defaults. Do not add a knob the compiler can decide itself.
- **Striking, within limits.** Output may be expressive (motion, depth, atmosphere), but every page must read completely with reduced motion, in print, in a screenshot and without JavaScript. Motion decorates; it never carries information.

Page size is not a product criterion. Implementation choices are open within these principles.

## Working rules

- Read `README.md` and `docs/adr/0001-page-spec-compiler-boundary.md` for the compiler boundary.
- Read `DESIGN.md` before changing anything in `src/render/styles.ts`, `src/render/charts.ts`, `src/render/document.ts` or `src/theme/`.
- Emitted CSS must stay token-driven. Feature CSS belongs in `FEATURE_CSS`, never in `BASE_CSS`.
- After an intentional output change, run `pnpm build`, `pnpm snapshots:generate` and `pnpm gallery:generate`, then commit the regenerated files.
- Verify with `REVIEW.md`: run the gates, then check the screenshots at 1440, 768 and 375 in light and dark.
- When gallery content or routes change, keep the discovery surfaces it advertises (meta and share tags) in sync.
- Do not commit to `main`. Use a branch and a PR with conventional commits.
