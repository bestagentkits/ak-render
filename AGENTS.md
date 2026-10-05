# Agent guide

- Read `README.md` and `docs/adr/0001-page-spec-compiler-boundary.md` for the compiler boundary.
- Read `DESIGN.md` before changing anything in `src/render/styles.ts`, `src/render/charts.ts`, `src/render/document.ts` or `src/theme/`.
- Emitted output must stay deterministic, offline and token-driven. Feature CSS belongs in `FEATURE_CSS`, never in `BASE_CSS`.
- After an intentional output change, run `pnpm build`, `pnpm snapshots:generate` and `pnpm gallery:generate`, then commit the regenerated files.
- Verify with `REVIEW.md`: run the gates, then check the screenshots at 1440, 768 and 375 in light and dark.
- When gallery content or routes change, keep the discovery surfaces it advertises (meta and share tags) in sync.
- Do not commit to `main`. Use a branch and a PR with conventional commits.
