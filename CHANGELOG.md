# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Release mechanics and the compatibility contract live in
[docs/release-policy.md](./docs/release-policy.md).

## [Unreleased]

### Changed

- The Claude Code and Codex plugin manifests link to https://render.agentkit.best, and the Codex plugin shows an icon, a logo and the brand colour in the plugin directory.
- The landing page shows what the compiler saves an agent (measured and estimated token figures, kept apart), each component crop beside the fixture YAML that produced it, and a gallery of every demo page. The README gains a token cost section.

### Added

- `benchmarks/agent-token-cost.mjs` estimates the tokens of a page task end to end: guidance read, output written and what returns into context, against a corpus of hand-written HTML passed with `--legacy-html`. Results are in `docs/artifacts/agent-token-cost.md`, with the corpus recorded by anonymous label.
- `scripts/capture-demo-media.mjs` captures five more page shots and four component crops (KPI, terminal, checklist, file tree), and `--only <names>` recaptures a subset without the walkthrough video.

### Fixed

- Diagram adapter `<style>` elements now receive the page style nonce, so styled adapter SVG renders as drawn instead of in default black. The policy stays nonce-only: inline `style` attributes are removed from adapter output with a warning, and adapter CSS that uses `@import` or a remote `url()` is rejected. `docs/diagram-adapter.md` explains how to style adapter output.
- A long unbroken token, such as a path or an env var list, no longer widens the page on a phone. Key-value values, list items, text and callouts break the token inside their own line, so the reported key-value page no longer scrolls sideways at 375px.
- A `diagram-panel` shows adapter SVG at its natural size. A wide diagram scrolls sideways inside its panel, a named region that scrolls from the keyboard, instead of shrinking its labels until they are unreadable. In print it is scaled to the page width.
- A `diagram-panel` whose adapter rendered no longer shows the structured description beside the drawing. The description stays in the document behind a closed "Text description" disclosure.
- A long `terminal` session no longer leaves its last lines blank in a capture. Lines now stagger 80ms apart instead of 340ms, lines past the twelfth share its delay, and the whole session is drawn about 1.4s after it arrives.
- A wide `table` or adapter diagram now shows a soft shade on each edge that has more content beyond it, so a frame that scrolls sideways no longer looks clipped. A frame that fits shows none.

## [0.2.0] - 2026-10-05

Every emitted page changes in this release: new styles, embedded fonts, and a
CSP that allows `font-src data:` on pages that carry a face.

### Changed

- Polished the emitted artifacts:
  - Heading sizes now follow the `font-scale` token.
  - Spacing is driven by density, with larger gaps at section breaks.
  - The hero carries an accent eyebrow rule, and the theme toggle is a right-aligned pill.
  - Callouts, badges and tables are tinted, buttons and tabs have hover and press states, and all transitions use the motion tokens.
  - Mobile touch targets are 44px.
- Charts now have clean axis ticks with gridlines, rounded bars centered under their labels, a series palette derived from the theme accent, legends, a donut total, and SVG heights sized to their content (sparkline and progress).
- Elevation shadows are layered. A table title no longer prints twice; its caption is kept for screen readers only.
- Artifacts now emit `og:title`, `og:type`, `og:description` and `twitter:card` from the spec meta.
- The gallery index is now one card per artifact.
- Redesigned the component system in the emitted stylesheet:
  - Top-level sections open on a hairline with a short accent tab, and nested block titles step down a size, so the heading hierarchy reads at a glance.
  - The hero title is larger, and the page carries a faint accent wash at the top.
  - Stats share one framed panel with hairline dividers. Steps use numbered rings on a connector, and timeline dots carry a halo.
  - Callouts and alerts carry a tone glyph instead of a side stripe. Quotes use a hanging quote mark.
  - Tabs are a segmented control, accordion items are separate panels with a plus/minus indicator, and the carousel slide is a framed stage with arrow controls.
  - Tables gain a caption bar, row headers, and a minimum width on small screens so cells scroll instead of breaking word by word. Comparisons, key-value lists, code blocks, badges, key caps, progress bars, sliders, search inputs and dialogs were refined to match.
  - In dark schemes, surfaces get a top-lit sheen, because the fixed elevation shadows are invisible on a dark page.
- Images on a page that allows `images` now add their origin to `img-src` for every image-bearing block. Before, only `image` and `gallery` did; only `video` and `audio` use the `media` capability.
- Feature stylesheets moved to `src/render/feature-styles.ts`; `styles.ts` re-exports them.
- **Embedded fonts (CSP change).** Every preset now leads its display stack with a bundled SIL OFL 1.1 variable face: Geist (blueprint), Fraunces (editorial), Bricolage Grotesque (paper-ink), Inter Tight (swiss-clean), JetBrains Mono (terminal-mono) and Plus Jakarta Sans (warm-signal).
  - The face is inlined as a `data:` WOFF2, so nothing is fetched. The Latin subset is always emitted; the Vietnamese subset only when the page text needs it.
  - Pages that carry a face emit `font-src data:` instead of `font-src 'none'`. Verification fails on any `@font-face` source that is not inlined, and on a CSP that does not match.
  - Artifacts grow by roughly 30–60 kB per page. A custom font stack that names no bundled `AK ` family embeds nothing.
  - The licences ship in `assets/fonts/<family>/OFL.txt` and in the npm package. Each `@font-face` carries a notice comment.
- Blueprint's light scheme is warmer and higher-contrast: a drafting-paper background (`#f4f2ed`), near-black text, and a cobalt accent (`#1d4fd7`).
- Bento tile images now sit as a panel bleeding off the tile edge over an accent-tinted backdrop. Showcase frame images drift with scroll (parallax) instead of settling.
- The browser frame styles moved to the base sheet, so the hero can use them.

### Added

- `ak-render mcp` serves the compiler as an MCP server over stdio, with `catalog`, `describe`, `validate`, `render` and `themes` tools. `render` writes the HTML to the `out` path, which must end in `.html` or `.htm`, and returns only a summary. `themes` returns the presets plus any preset file that failed to load. The server accepts JSON-RPC batches and answers an unknown tool or a null id with a protocol error. No new runtime dependency.
- An `ak-render` agent skill (`skills/ak-render/SKILL.md`), installable with `npx skills add bestagentkits/ak-render`, plus Claude Code and Codex plugin marketplaces that bundle the skill and register the MCP server, pinned to the matching package version.
- Pass `-` as the spec path to compile or validate a spec from standard input. Diagnostics name the source `<stdin>`.
- `llms.txt` (shipped in the package) and `docs/agent-guide.md`: the agent loop, a minimal spec, and the MCP client config.
- `section` gains `surface: plain | inverse`. An inverse section sits on a night band: a dark panel where every colour token takes the theme's dark value, so nested blocks recolour without variants.
- A `cta` block: eyebrow, an oversized gradient title, text, and up to three link actions, on the night band. It is the new `cta` runtime feature.
- `hero` gains optional `src`, `alt`, `address` and `align: start | center`. With `src`, a framed product shot sits below the copy and straightens from a tilt as the page scrolls. `alt` is required when `src` is set.
- The theme toggle reveals the new scheme as a circle growing from the button, through the View Transitions API, when motion is allowed. Otherwise it switches instantly, as before.
- `scripts/capture-demo-media.mjs` records element-level crops at 2x (`crop-chart`, `crop-donut`, `crop-compare`, `crop-timeline`, `crop-diagram`). The showcase bento uses them.
- `pnpm fonts:generate` and `pnpm fonts:check` regenerate and check the embedded font module.
- A page outline ("On this page") with scroll-spy appears when a page has three or more titled top-level sections. It is the new `outline` runtime feature, and sections now carry an `id` of the form `ak-sec-<node id>`.
- A reading-progress rail.
- A colophon footer with a back-to-top link.
- Code blocks have line numbers, a language pill, and a Copy button with a copied state. The `code` block now declares the `copy` runtime feature.
- Charts:
  - Area fills are gradients.
  - Bars and points reveal their values on hover or focus.
  - The cartesian viewBox is 800×300, and on narrow screens the chart scrolls sideways instead of shrinking its text.
- Tables:
  - Numeric columns align right.
  - Diff status, risk levels and review kinds render as toned badges.
  - Diff line counts are signed and colored.
- External links in prose carry a ↗ marker.
- Diagram fallbacks render a simple chain as a flow of node cards joined by labelled arrows, vertical on phones. Other graphs show node cards plus an explicit connection list.
- A signature style layer (`src/render/signature-styles.ts`):
  - a fluid display-size hero title and a staggered hero entrance;
  - balanced headings;
  - drawn link underlines;
  - cards that end in a link become a single lifted target with an arrow CTA;
  - larger stat figures and a subtle top light on primary buttons.
- Bar charts use per-series gradients.
- Eight showcase blocks:
  - `bento`, a mosaic of tiles with sizes, images and display figures;
  - `marquee`, an accessible looping ticker;
  - `terminal`, a typed session with a copy control;
  - `file-tree`, built from flat paths with status;
  - `before-after`, an image slider driven by a native range input, which adds the `before-after` runtime feature;
  - `kpi`, metrics with a delta, a good/bad verdict and a sparkline;
  - `showcase`, copy beside a capture in browser chrome;
  - `checklist`, with a done count and a progress meter.
  Each has its own tree-shaken feature sheet.
- An effects layer (`src/render/effects-styles.ts`):
  - a theme-tinted hero aurora;
  - a word-by-word hero title reveal;
  - a film-grain texture;
  - a pointer spotlight on cards;
  - count-up for numeric stats and KPIs;
  - scroll-linked settling of framed images;
  - a sweep on primary buttons.
  All of it respects reduced motion and print. Count-up keeps the authored value in the DOM and draws the rolling figure on a hidden layer, so screen readers, copy and print always get the real number.
- Real demo media in `fixtures/assets`: screenshots and a 41s screen recording of the compiled gallery, captured by `scripts/capture-demo-media.mjs`.
- A `showcase` landing fixture. The media fixture plays the local recording, shows the real screenshots, and compares light and dark. The gallery index opens with a marquee and a showcase of the landing page.

### Fixed

- A non-colour token set under a theme's `tokens` (a font stack, spacing, or motion value) now applies to the dark scheme too. Before, dark mode fell back to the parent preset's value.
- `motion-policy: none` now stops every animation, not only the token-driven durations: the aurora, marquee, caret, word reveal, scroll-linked reveals, count-up, the primary-button sweep and the theme-toggle transition. The zeroed duration now also wins over the dark scheme, which used to restore it under reduced motion. The reading-progress rail still follows the scroll position, since it moves only when the reader scrolls. The page renders as it does under reduced motion, and the root carries `data-motion="none"`.
- `loadTheme` reports a non-object `tokens` or `dark` value as a `POLICY_VIOLATION` render error instead of throwing a `TypeError`.
- File trees order names by code point, so the order no longer depends on the runtime's collation.
- A blocked remote image keeps its alt text, and every blocked image, video, audio or embed names the real reason: the network is denied, the capability is not allowed, or the host is not on the provider allowlist. Before, the note always said the network was denied.
- A `bento` tile with `src` now requires `alt`; an explicit `alt: ""` marks a decorative image.
- The terminal's caption is a direct child of its figure, and the figure is named by the title alone.
- Checklist, browser-frame (hero shot and showcase) and bento image styles moved out of the base stylesheet into feature sheets, so pages without those blocks no longer carry them. `checklist` and `frame` are new runtime features.
- The night band now uses the same tint, focus ring and sheen as dark mode; it had drifted to stronger values.
- Font verification checks every source of every `@font-face`, and rejects `local()`, instead of only the first `url()`.
- The theme toggle names the scheme it switches to from the first paint, and follows a system scheme change while the page is open. Before, it read "Dark" on a page the system had already put in dark mode.
- A `split`, `grid` or `comparison` column no longer grows past a phone screen when a child holds a long code line; the line scrolls inside its frame.
- `ak-render <command> --help` prints that command's usage instead of trying to read a file named `--help`; `ak-render page.yaml --help` prints the compile usage instead of compiling.
- `--out` creates missing folders, and a file that cannot be written exits `2` with a one-line reason instead of a stack trace and exit `1`, which agents read as "fix the spec".
- `img-src` and `media-src` include `'self'`, so a page's relative assets load when it is served over HTTP(S) instead of opened from disk. Remote URLs are still gated by the network policy.

## [0.1.1-next.1] - 2026-09-22

Prerelease published to exercise the trusted-publishing release path end to end:
the tag run publishes over GitHub OIDC with provenance and no stored token. No
functional changes; the compiler behaves as `0.1.0`.

## [0.1.0] - 2026-09-22

First public release, published to npm as `@bestagentkits/render`.

### Added

- Repository baseline for the public AK Render package: MIT license,
  contribution guide, security policy, release policy, and CI covering lint,
  typecheck, unit tests, browser tests, build, and package smoke.
- TypeScript ESM package skeleton targeting Node >= 20.11, with a library entry
  point, an `ak-render` CLI bin, and a `pack`/install smoke test that exercises
  both surfaces from a throwaway consumer project.
- Architecture decision record
  ([ADR 0001](./docs/adr/0001-page-spec-compiler-boundary.md)) fixing the Page
  Spec versus internal IR split, catalog/registry separation, trusted
  interaction runtime, theme trust model, local/cloud boundary, and the
  optional AgentKit adapter model.
- Fixture corpus representing the plan, explain, recap, diff, dashboard, media,
  and interactive page classes.
- Reproducible baseline measurement of the legacy HTML presentation guidance
  currently carried in agent model context, with captured results under
  [docs/artifacts/](./docs/artifacts/).
