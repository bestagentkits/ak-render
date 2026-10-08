# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Release mechanics and the compatibility contract live in
[docs/release-policy.md](./docs/release-policy.md).

## [Unreleased]

### Added

- `hero` takes optional `actions`: up to three link buttons (`label`, `href`,
  `variant`), the same shape as the `cta` band, rendered under the description.
- Prose text renders a `**double-asterisk**` pair as bold, alongside backtick
  inline code. Code spans keep their asterisks literal, a marker that is
  unpaired, empty, or padded with whitespace (`2 ** 8`) stays literal, and the
  content is escaped like any other text. A prose prop's description now reads
  "Plain text; `code` and **bold** spans render inline."
- `crimson-press` built-in preset: cream paper, black ink and a crimson
  accent, Fraunces display over Inter Tight body and JetBrains Mono labels,
  square corners, no card shadow, and the `cards: flat`, `tables: ledger`,
  `metrics: headline` and `callouts: outlined` recipes. Every built-in list
  now names eleven presets.
- Gallery theme preview at `docs/gallery/themes/` (live at
  `https://render.agentkit.best/gallery/themes/`): the theme-showcase spec
  compiled under every built-in preset, one standalone page each, plus a
  viewer whose dropdown switches the framed preset. The viewer keeps the
  choice in the address (`#crimson-press`), makes no network request, and
  falls back to a plain list of links without JavaScript. The landing and the
  gallery index link to it.
- The landing page at `https://render.agentkit.best/` carries search and
  social metadata: canonical URL, a 1200×630 social card for Open Graph and
  X, favicons and a web manifest, light and dark `theme-color`, and JSON-LD
  for the site, the software and AgentKit. The site root also serves
  `robots.txt`, `sitemap.xml` and an `llms.txt` summary for AI answer
  engines. The site build adds these to the landing head
  (`scripts/site-head-metadata.mjs`); compiled pages are unchanged.
  `scripts/generate-site-images.mjs` regenerates the icons and the card.
- The landing hero links to the GitHub repository, the demos and the MCP setup,
  and the landing prose marks URLs, commands and identifiers as inline code and
  key phrases as bold.
- The landing page explains how to connect the hosted MCP server from Claude,
  ChatGPT, Claude Code, Cursor, VS Code, Codex or any client with an API key,
  states that the hosted endpoint is for AgentKit customers, and points
  everyone else to the local MCP server or a self-hosted Cloudflare deploy.
- The hosted MCP server at `https://render.agentkit.best/mcp` supports OAuth.
  An MCP client added with only the URL signs in to agentkit.best in the
  browser and refreshes on its own: access tokens last an hour, and each
  refresh slides the grant to 365 days. The worker verifies the tokens locally
  against the issuer's JWKS and serves RFC 9728 protected-resource metadata.
  A personal AgentKit API key (`ck_live_…`) also works as a static bearer and
  lasts until revoked.

### Changed

- **Breaking for anonymous remote MCP use.** With OAuth enabled
  (`OAUTH_RESOURCE`, as on `render.agentkit.best`), a remote MCP request without a bearer
  gets HTTP 401 with a `resource_metadata` challenge, which is what starts
  a client's sign-in. Before, it was served, and only `validate` and `render`
  refused it. A deployment without OAuth keeps anonymous discovery.

## [0.3.0] - 2026-10-06

The Page Spec stays `version: 1`, and every spec that was valid in 0.2.0 stays
valid. These changes alter existing behaviour or output on purpose:

- `--theme` (and the `theme` render option) now replaces the spec's
  `theme.recipes` as well as its tokens. Before, spec recipes applied
  regardless.
- Every `gallery` thumbnail opens a full-size lightbox. There is no author
  flag, so every page with a gallery emits new markup, CSS and runtime.
- Tabs no longer fire `select` for the initial tab when the page loads, so page
  state keeps its declared initial values.
- A remote video `poster` that the network policy blocks is a `validate` error
  (`POLICY_VIOLATION` at the `poster` path), not a compile failure at `$`.
- Pages with tabs or a carousel change markup and CSS so every panel and slide
  reads without scripts and in print.
- `catalog` text is grouped by category, and `catalog --json` prints one block
  per line with new `category` and `tags` fields.
- The Claude Code and Codex plugin manifests link to https://render.agentkit.best, and the Codex plugin shows an icon, a logo and the brand colour in the plugin directory.
- The benchmarks are measured against AgentKit `9e322f928`. The legacy baseline no longer counts the slide guide for document tasks (AgentKit loads it for `--slides` only), so its per-task mean is ~25.0k tokens, not ~33.7k. `render-benchmark.mjs` measures the `ak-render` skill route per task: the AgentKit shared HTML contract, the skill, `catalog`, and `describe --json` for each block type the task's fixture compiles to. It fails when the AgentKit checkout is missing. Presentation context now drops 64–68% (previously reported as 87–88%). The typical-task estimate is 54% with full contracts and 66% with `describe --compact`, which counts the shared contract too (previously 65% and 75%). `agent-token-cost.mjs --reuse-legacy` reruns that estimate from recorded corpus measurements. The README and landing page use the new figures.
- The landing page shows what the compiler saves an agent (measured and estimated token figures, kept apart), each component crop beside the fixture YAML that produced it, and a gallery of every demo page. The README gains a token cost section.

### Added

- Rich composition: a tab panel, an accordion section, a carousel slide and a bento tile hold child blocks in `items[i].blocks` (up to 12, or 6 in a bento tile). Any block may nest except `page`, `section` and `hero`, and tabs may nest in tabs. An item's `text`, and a bento tile's `title`, are optional when the item has blocks; an item with neither is an error at its path.
- Nested slots with `accepts` and `parents` rules. Diagnostics carry the nested JSON path, and nested blocks count toward the block limit.
- `grid-item` places blocks on a 12-track grid with `span`, `tabletSpan`, `mobileSpan`, `rowSpan`, `start` and `align`. `grid.columns` takes 1–12 or `auto` (with `minItemWidth`), grids take `gap` and `align`, and `stack` takes `align`.
- Semantic page layouts: `sidebar-layout` (a `sidebar` beside the main `blocks`, on either `side`), `main-aside` (an `aside` that stays in view on wide screens) and `rail-layout` (a compact `rail`, a labelled `<nav>` when it holds only links or toolbars).
- Datasets: top-level `datasets`, and `dataRef`, inline `data` and a bounded `transform` (filter, groupBy, sort, select, limit) on blocks that take data. Values format through one locale-free formatter (`number`, `integer`, `compact`, `percent`, `currency`, `duration`, `bytes`, `date`); `percent` takes `87` for "87%". See [docs/data-and-state.md](./docs/data-and-state.md).
- `visibleWhen` shows a block only while a state value matches (`equals`, `notEquals`, `in`, `notIn`, `truthy`, `falsy`). The compiler emits the initial view, so the page reads correctly without scripts and in print.
- Native input controls `select`, `radio-group`, `checkbox`, `switch`, `text-input`, `number-input` and `date-input`. Each has a visible label, writes one value to `state.<key>` through `bind`, and fires `change` with its value.
- `filter-bar` filters a `data-table`, `kanban` or `log-viewer` with 1–8 controls, each naming a row `field` and a `match`. It adds an announced result count and a Reset button; `select` and `radio-group` can list the target's values with `optionsFrom`. A `data-table` that a filter-bar targets renders no search box, row count or "no match" note of its own, so two filters never fight over the same rows; put free-text search in the bar as a `search` child.
- `data-table`: a typed, sortable table bound to a dataset. Column types `text`, `number`, `percent` (alias `percentage`), `currency`, `date`, `badge`, `link`, `progress` and `sparkline`; search past 10 rows (unless a filter-bar targets the table), a sticky header past 12, labelled cards on phones, and the full table in authored order without scripts or in print.
- Chart kinds `scatter`, `histogram`, `stacked-bar`, `stacked-bar-100`, `heatmap`, `waterfall`, `funnel`, `gauge` and `treemap`. A chart can bind rows and read them through the `x`, `y`, `series: { field }` and `value` encodings, and takes `markers`, `annotations`, `sort` and a gauge `target`. A bound chart's fallback table comes from the bound rows. Charts that use `labels` and `series` render the same markup as before.
- Engineering widgets: `kanban`, `roadmap`, `test-results`, `log-viewer`, `api-endpoint` and `schema-viewer`.
- Evidence widgets: `benchmark-comparison` (computed delta, change and verdict; `currency` is set once for the whole block, not per metric), `metric-breakdown`, `annotated-image` and `references` (stable `#ref-<id>` anchors).
- Product widgets: `pricing`, `feature-matrix`, `testimonial` (two or more quotes form a grid), `logo-cloud`, `people` and `calendar` (weeks start on Monday; `weekStart: sunday` changes that).
- Theme recipes restyle components through closed enums for cards, sections, tables, charts, hero, metrics, media and callouts. A preset, a preset file or the spec's `theme.recipes` selects them. See [docs/themes.md](./docs/themes.md#recipes).
- Four built-in presets: `data-console`, `executive-report`, `product-studio` and `research-notebook`. They reuse the bundled faces. Every built-in preset is tested for WCAG 2.2 contrast in both schemes.
- An inline spec theme accepts `theme.dark`, dark-scheme token overrides.
- Catalog discovery: every block has a category and tags. `ak-render catalog --category <c>` lists one category, `ak-render search-catalog <terms...>` ranks block types by intent words, and `ak-render describe <type...> --compact` returns up to 12 contracts with one line per prop; a shape repeated within a contract reads `like <field>` and a repeated long enum `enum as <field>`. Row-filtering words rank `filter-bar` first. MCP gains `search-catalog`, `catalog{category}` and `describe{types, compact}`, on the stdio and the remote server; the remote `search-catalog` needs no token. The library exports `searchCatalog` and `describeMany`.
- Page recipes: `ak-render recipes [--json]` lists ten starter specs (`architecture-review`, `benchmark-report`, `case-study`, `dashboard`, `decision-memo`, `implementation-plan`, `incident-report`, `product-showcase`, `release-recap`, `research-report`), and `ak-render recipe <name>` prints one as YAML, or the full record with `--json`. An unknown name exits 1 and lists the allowed names; a missing name exits 2. Each recipe validates with no errors or warnings, compiles deterministically, stays within 3,000 bytes of YAML and loads nothing remote. MCP serves them as `recipes` and `recipe{name}` on the stdio and the remote server, and the library as `recipes()`, `recipe(name)` and the `PageRecipe` and `PageRecipeSummary` types; an unknown name throws `SPEC_VALIDATION_ERROR` at path `name` with `details.allowed`.
- `pnpm recipes:generate` embeds the recipe YAML in `src/recipes/recipes.generated.ts`, and `pnpm recipes:check`, part of `pnpm verify`, fails when that module is stale.
- The library exports `BLOCK_CATEGORIES`, `THEME_RECIPE_SPECS`, `VALUE_FORMATS` and the `MaterializedData`, `DataRow` and `DataScalar` types.
- Remote MCP over Streamable HTTP at `https://render.agentkit.best/mcp`, served by the cloud Worker. It lists the same tools as `ak-render mcp`: `catalog`, `search-catalog`, `describe`, `recipes`, `recipe`, `validate`, `render` and `themes`. A remote `render` takes no `out`: it compiles through the same path as `POST /v1/render` (byte-identical HTML), stores the page and returns the summary plus `artifactUrl` and `expiresAt`, never the HTML. The artifact lives one hour, or becomes an expiring share with `share: true` (needs the share scope). `catalog`, `search-catalog`, `describe`, `recipes`, `recipe` and `themes` answer without a token; `validate` and `render` need an AgentKit bearer and count against the same per-subject rate limits as REST.
- The MCP server is split into transport-independent modules under `src/mcp/`: protocol vocabulary, one set of tool contracts, JSON-RPC routing, the stdio transport, and a Fetch-API Streamable HTTP transport the Worker imports. `ak-render mcp` answers byte for byte as before.
- `GET /v1/artifact/:id` serves the short-lived artifact a remote MCP render stored.
- `scripts/cloud-smoke.mjs` smoke-tests a deployed renderer (MCP and REST, share lifecycle, exports) with `BASE_URL` and an optional `TOKEN`; the manual cloud deploy workflow runs it after deploying.
- `benchmarks/agent-token-cost.mjs` estimates the tokens of a page task end to end: guidance read, output written and what returns into context, against a corpus of hand-written HTML passed with `--legacy-html`. Results are in `docs/artifacts/agent-token-cost.md`, with the corpus recorded by anonymous label. `--legacy-from <artifact.json>` refreshes the artifact from the recorded legacy rows without the private corpus, and a second typical-task row measures the compact workflow (`describe <types...> --compact`). Block types are read from the compiler IR.
- `pnpm bench:spec` (`benchmarks/spec-compression.mjs`) records, per composition fixture, the spec bytes, the bytes with every `dataRef` inlined, the HTML bytes, and the catalog and compact-describe bytes an agent reads, in `docs/artifacts/spec-compression.{json,md}`. The output is deterministic.
- Six composition fixtures: `complex-dashboard`, `benchmark-report`, `research-report`, `product-case-study`, `interactive-data-explorer` and `incident-report`. Each validates with no warnings and compiles to identical bytes three times. `fixtures/rejected/validation/` holds well-formed but wrong specs that must fail validation at a located path, optionally pinned by a first line `# expect: CODE $.path`.
- `tests/browser/composition-matrix.spec.ts` checks every fixture page for horizontal overflow at 320, 375, 768 and 1440 in light and dark, running animation under reduced motion, script-off readability, print, keyboard focus, network requests and critical axe violations. `@axe-core/playwright` is a new devDependency.
- `scripts/capture-demo-media.mjs` captures five more page shots and four component crops (KPI, terminal, checklist, file tree), and `--only <names>` recaptures a subset without the walkthrough video.
- A pair of backticks in prose text renders as inline code, so `` `ak-render catalog` `` in a `text`, a step, a list item, a description or a caption reads as a command. The text is escaped before the span is wrapped, nothing else is parsed as markup, and an unpaired backtick stays literal. Titles, `code` blocks, `terminal` lines and the chart summary are unchanged, and `describe` and the JSON Schema say which props do this.

### Changed

- `catalog` text is grouped by category under `## <category>` headers, one `type — summary` line per block, without the kind column. `catalog --json` and the MCP `catalog` add `category` and `tags` to each entry and print one block and one action per line; the parsed value is otherwise unchanged. A single-type `describe <type>` is byte-identical.
- The MCP `describe` input no longer requires `type`: pass `type` or `types`, plus optional `compact`. Every local tool description is at most 200 characters.
- URL props declare the network capability of the asset they load, so the CSP origins and the validation gate come from one schema walk at any depth.
- When a `oneOf` value fails, diagnostics come from the option the author meant, chosen by JSON shape and then by `type`.
- A tab's `select` event passes the tab id as its value, so `set-value` without its own `value` stores the selected tab.
- Chart `labels` is optional in the schema; a chart without bound data still requires it, with the same message and path.
- The cloud Worker is routed at `render.agentkit.best/mcp` and `render.agentkit.best/v1/*`, beside the site's Custom Domain on the same hostname.
- The Claude Code and Codex plugin manifests link to https://render.agentkit.best, and the Codex plugin shows an icon, a logo and the brand colour in the plugin directory.
- The landing page shows what the compiler saves an agent (measured and estimated token figures, kept apart), each component crop beside the fixture YAML that produced it, and a gallery of every demo page. The README gains a token cost section.

### Fixed

- Tab panels and carousel slides are readable without scripts and in print: every panel ships visible with its title until the runtime marks the container ready.
- Accordion sections print open, nested blocks included.
- Accordion and carousel styles apply only to their own sections and slides, so a nested block keeps its own look.
- The runtime escapes embedded state, so a value such as `</script>` cannot close the script element.
- An event stops at the nearest block, so it no longer reaches an enclosing block's bindings.
- A `set-value` action without `value` takes the event's value, for example a slider's. With no event value it does nothing; before, it set `undefined`.
- The cloud Worker validates bearers against the canonical AgentKit endpoint, `GET https://agentkit.best/api/agentkit/entitlements`, instead of an unreachable host, so authenticated render, share and export can succeed. It fails closed on a rejected token (401), an inactive account (403), and an upstream error, redirect, timeout or malformed body (502). An active app or kit entitlement grants the `render` and `share` scopes, which stay separate checks.
- Screenshot and PDF export call the Browser Run binding's Quick Actions with the compiled HTML inline and caching off, and `wrangler.jsonc` attaches the `BROWSER` binding.
- Remote MCP bounds its anonymous surface: a JSON-RPC batch carries at most 16 members, never `initialize`, and is refused (400) under protocol revision 2025-06-18 or later, which removed batching. `catalog`, `search-catalog`, `describe`, `recipes`, `recipe` and `themes` stay anonymous but count per client IP (`anon-ip`, 120/min).
- A remote MCP request that presents a rejected bearer answers HTTP 401 with `WWW-Authenticate: Bearer`, whatever the method, instead of a tool error; REST 401s carry the same challenge. A request without a bearer is still served, and `validate`/`render` still answer a tool error with `UNAUTHENTICATED`.
- Cloud rate limits use the Workers Rate Limiting binding, one per route class, instead of KV counters that could fail on rapid writes; a limiter fault refuses the call with `RATE_LIMITED`. An MCP `render` with `share: true` counts against `share` only, as `POST /v1/share` does, and a call refused by authorization consumes nothing.
- The cloud Worker caches entitlements answers in memory under a SHA-256 digest of the bearer (60 s accepted, 10 s rejected), and limits uncached bearer checks per client IP (30/min) before contacting the entitlements endpoint.
- Remote MCP reports a storage or runtime fault as a generic `INTERNAL_ERROR` tool error, and the REST routes answer such a fault with a generic 500, so no internal message reaches a caller.
- Hosted shares and artifacts are served with `content-security-policy: sandbox …; frame-ancestors 'none'`: they run in an opaque origin and cannot be framed.
- The expiry sweep pages through every listed object with the cursor, reads expiry from listing metadata instead of downloading bodies, and deletes in batches; R2 lifecycle rules (`apps/cloud/r2-lifecycle.json`, applied on deploy) delete artifacts after 1 day and shares after the retention period plus a day.
- A remote video `poster` that the network policy blocks now fails `validate` with a `POLICY_VIOLATION` at the block's `poster` path, naming the reason. Before, validate passed and compile failed at `$` with "emitted a remote resource reference". A poster is gated by the `images` capability, an allowed remote poster's origin joins the CSP, and the renderer drops a blocked poster even for an IR that skipped validation.
- Diagram adapter `<style>` elements now receive the page style nonce, so styled adapter SVG renders as drawn instead of in default black. The policy stays nonce-only: inline `style` attributes are removed from adapter output with a warning. Adapter CSS is scoped with `@scope` to its own diagram canvas, so it cannot restyle the page, and it cannot load anything: escapes, character references, `url()` other than a fragment reference such as `url(#grad)`, `image-set()`, every at-rule except `@media`, `@keyframes` and `@supports`, and `@keyframes` that redefine the page's own reject the output to the structured fallback. Comments and `!important` are removed. Adapter markup that writes a `nonce` or any `data-ak-*` attribute, or an `href`, `xlink:href`, `src`, `srcset`, `poster`, `action`, `formaction`, `background`, `data`, `codebase` or `ping` that is not a same-document `#fragment`, or SVG animation whose `attributeName` is one of those, is rejected too, and so is markup that is not a self-contained fragment: a stray or missing end tag, a raw-text element such as `plaintext` or `textarea`, an element that merges into the page document such as `body` or `meta`, an HTML element inside SVG, or a comment. Output from the `ak:diagram` compiler passes these checks. Adapter animation stops under reduced motion, `motion-policy: none` and print. `docs/diagram-adapter.md` lists what adapter CSS may use.
- Checking adapter markup is linear in its size. An unterminated tag repeated to the 256 KB bound took minutes; it now takes milliseconds.
- A long unbroken token, such as a path or an env var list, no longer widens the page on a phone. Key-value values, list items, text and callouts break the token inside their own line, so the reported key-value page no longer scrolls sideways at 375px.
- A `diagram-panel` shows adapter SVG at its natural size. A wide diagram scrolls sideways inside its panel, a named region that scrolls from the keyboard, instead of shrinking its labels until they are unreadable. In print it is scaled to the page width.
- A `diagram-panel` whose adapter rendered no longer shows the structured description beside the drawing. The description stays in the document behind a closed "Text description" disclosure, which opens in print, with or without script.
- A long `terminal` session no longer leaves its last lines blank in a capture. Lines now stagger 80ms apart instead of 340ms, lines past the twelfth share its delay, and the whole session is drawn about 1.4s after it arrives.
- A wide `table` or adapter diagram now shows a soft shade on each edge that has more content beyond it, so a frame that scrolls sideways no longer looks clipped. A frame that fits shows none.
- A `data-table` row that a filter hides stays hidden at phone widths, where rows become cards.
- Blocks inside or after a `visibleWhen` view keep the normal block gap and the section-break gaps.
- A thinned category axis always labels the last category, so a series never reads as ending early.
- Chart ticks finer than 0.01 keep the decimals the step needs instead of all printing the same value, and only floating-point noise is removed before a value is formatted.
- A histogram over huge, close values (such as 1e16 and 1e16 + 4) keeps finite, increasing bin edges: when clean steps cannot separate the values it draws one bin.
- The page outline skips a section behind `visibleWhen`, so it never links to a hidden section.
- Dataset field names `__proto__`, `constructor` and `prototype` are refused at validation, and a `log-viewer` level named like an object property gets the neutral tone.
- `date-input` accepts ISO dates in the years 0001–0099.

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
