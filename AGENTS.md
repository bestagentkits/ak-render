# Agent guide

## Product principles

AK Render is optimized to reduce the tokens and decisions AI agents spend authoring, iterating on, and maintaining high-quality HTML pages. The byte size of the emitted HTML is not the optimization target. Output must stay beautiful, high quality and deterministic.

Mandatory boundaries (only the author may change these, not even for better looks or speed):

- **Offline by default.** An emitted page opens from `file://` and makes zero network requests unless the spec opts in through `policy.network`. No CDN, remote font or remote asset.
- **Deterministic.** The same spec, compiler version and options produce identical bytes.
- **No escape hatch.** Spec input is untrusted. No raw CSS, HTML, JS or iframe, and no open-ended action. Themes are typed data.
- **Local is canonical.** Compiling never needs an account or the network. Cloud is opt-in convenience, never the source of truth.

Guiding priorities (a collaborator may choose differently within the boundaries but must explain the trade-off):

- **The compiler owns presentation.** The spec describes meaning; layout, color and motion derive from content and theme. Presentation props stay optional with good defaults. Do not add a knob the compiler can decide itself.
- **Striking, within limits.** Output may be expressive (motion, depth, atmosphere), but every page must read completely with reduced motion, in print, in a screenshot and without JavaScript. Motion decorates; it never carries information.
- **Agent tokens, not HTML bytes.** Optimize for what an agent spends on a page task, while keeping quality, readability, correctness, accessibility, determinism and offline output. Compact specs, smart defaults, high-level blocks, terse tool responses that can be queried deeper, and progressive discovery (`search-catalog`, `describe --compact`) are how that cost falls.

Implementation choices are open within these principles.

### Three different costs

| Cost | What it is | Status |
| --- | --- | --- |
| Agent token cost | Tokens to read guidance, write the spec, call the CLI or MCP tools, read diagnostics, repair, and maintain the page later. Includes the number of round-trips and manual decisions. | The primary optimization target. |
| Rendered HTML bytes | Size of the emitted file. It never passes through the model; the agent reads a one-line summary. | Not a product KPI. It may grow when inlining is what keeps the page polished and offline. |
| Runtime performance | Load, CPU, memory and interaction cost for the person who opens the page. | Must stay reasonable for UX. It is not the same thing as minifying or shrinking the file. |

These rules hold regardless of the trade-off clause above.

Inlining in the compiler is the point, not overhead: the theme stylesheet, embedded fonts, icon and diagram SVG, syntax-highlight token spans and the small interaction runtime ship inside the file so the agent never writes CSS, picks a CDN, draws an icon or hand-highlights code. Do not remove or externalize them to save kilobytes.

- Do not trade output semantics, visual quality, no-JS and print readability, accessibility, security or determinism for a few kilobytes of output.
- Do not add a minified-output or file-size target, budget or gate. Byte counts in benchmarks and render summaries are reported for transparency and determinism checks, not as goals.
- Judge a change by task-level agent cost: the median and p95 tokens per task (guidance read, spec written, tool round-trips and repairs), task completion rate, iterations to a valid page, and page quality. `benchmarks/agent-token-cost.mjs` and `benchmarks/spec-compression.mjs` measure the parts that do not need a live model. `benchmarks/agent-ab-harness.mjs` (`pnpm bench:agent`) runs identical tasks through a live model on the existing flow and, when the build exposes `compose` or `repair`, on the compose/repair flow, and records provider-reported tokens, round-trips, repairs, wall time and, with `--visual`, a viewport overflow check; its versioned baseline is `docs/artifacts/agent-ab-baseline.md`. Report a saving as measured only when it comes from that harness with both arms run; anything else is an estimate and is labelled so.

## Working rules

- Read `README.md` and `docs/adr/0001-page-spec-compiler-boundary.md` for the compiler boundary.
- Read `DESIGN.md` before changing anything in `src/render/styles.ts`, `src/render/charts.ts`, `src/render/document.ts` or `src/theme/`.
- Read `docs/adr/0002-motion-policy.md` before adding or changing any animation or transition; `src/render/motion.ts` owns the guard and its compile-time check. Per-block motion recipes live in `src/motion/recipes.ts`; discovery (`motion-catalog.ts`) and the audit (`motion-audit.ts`) project from it, so add a rule there rather than a second checker. The dev-only Motion Studio (`src/motion/studio/`) reads the same registry and writes only the spec. See `docs/motion.md`.
- Emitted CSS must stay token-driven. Feature CSS belongs in `FEATURE_CSS`, never in `BASE_CSS`.
- After an intentional output change, run `pnpm build`, `pnpm snapshots:generate` and `pnpm gallery:generate`, then commit the regenerated files.
- Verify with `REVIEW.md`: run the gates, then check the screenshots at 1440, 768 and 375 in light and dark.
- When gallery content or routes change, keep the discovery surfaces it advertises (meta and share tags) in sync.
- Do not commit to `main`. Use a branch and a PR with conventional commits.
- Claim an issue before working on it: assign yourself and keep one state label current (`in progress`, `blocked`, `in review` during agent review, `done` once the PR is open, `shipped` after merge to `main`). Check those labels first so parallel contributors and agents do not duplicate work. File unrelated gaps you find as new issues, and comment on related or duplicate issues with a reference.
